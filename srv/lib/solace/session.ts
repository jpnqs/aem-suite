import solace from 'solclientjs'
import { randomUUID } from 'node:crypto'
import { DEFAULT_ACK_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS } from '../core/defaults'
import { errMsg } from '../core/errors'
import { parseBool, parseInt64, PropertyType } from '../testcases/property-types'

let initialized = false

/** Returns the solclientjs module, initializing the factory once per process. */
export function sol(): typeof solace {
  if (!initialized) {
    const props = new solace.SolclientFactoryProperties()
    props.profile = solace.SolclientFactoryProfiles.version10_5
    solace.SolclientFactory.init(props)
    solace.SolclientFactory.setLogLevel(solace.LogLevel.WARN)
    initialized = true
  }
  return solace
}

export interface ConnectionConfig {
  url: string
  vpnName: string
  userName: string
  password: string
  clientName?: string
  connectTimeoutMs?: number
}

export type { DeliveryMode } from '#cds-models/aem/suite'
import type { DeliveryMode, ReceivedDeliveryMode } from '#cds-models/aem/suite'

export interface UserProperty {
  name: string
  type?: PropertyType | null
  value?: string | null
}

export interface PublishSpec {
  topic: string
  payload: string
  contentType?: string | null
  deliveryMode: DeliveryMode
  timeToLiveMs?: number | null
  dmqEligible?: boolean | null
  priority?: number | null
  correlationId?: string | null
  userProperties?: UserProperty[]
  ackTimeoutMs?: number | null
}

export interface PublishResult {
  latencyMs: number
}

/** Minimal publishing contract, so the test runner can be tested with a stub. */
export interface Publisher {
  publish(spec: PublishSpec): Promise<PublishResult>
  close(): Promise<void>
}

export interface ReceivedMessage {
  topic: string
  payload: string
  contentType: string | null
  userProperties: Record<string, unknown>
  correlationId: string | null
  deliveryMode: ReceivedDeliveryMode
  receivedAt: Date
}

interface PendingAck {
  resolve: (r: PublishResult) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
  sentAt: number
}

/**
 * Promise-based wrapper around a solclientjs session.
 * One instance = one SMF connection to one message VPN.
 */
export class SolaceSession implements Publisher {
  private readonly pending = new Map<string, PendingAck>()
  private readonly messageListeners = new Set<(msg: solace.Message) => void>()
  private readonly pendingSubscriptions = new Map<string, { resolve: () => void; reject: (e: Error) => void }>()
  private readonly closeListeners = new Set<(reason: string) => void>()
  /** no longer usable: closed by us or dropped by the broker */
  private closed = false
  /** the library session was disposed - separate from closed, so a session the broker dropped is still disposed */
  private disposed = false

  private constructor(readonly session: solace.Session, readonly config: ConnectionConfig) {}

  /** Connects and resolves once the session is UP. */
  static connect(config: ConnectionConfig): Promise<SolaceSession> {
    const s = sol()
    const timeout = config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    const session = s.SolclientFactory.createSession({
      url: config.url,
      vpnName: config.vpnName,
      userName: config.userName,
      password: config.password,
      clientName: config.clientName ? `${config.clientName}-${randomUUID().slice(0, 8)}` : undefined,
      connectTimeoutInMsecs: timeout,
      connectRetries: 0,
      reconnectRetries: 0,
      generateSendTimestamps: true,
      generateReceiveTimestamps: true,
      // window 1: the broker acknowledges every message immediately instead of batching ACKs
      // (otherwise the measured ACK latency includes the broker's ACK timer of ~1 s)
      publisherProperties: { acknowledgeMode: s.MessagePublisherAcknowledgeMode.PER_MESSAGE, windowSize: 1 }
    })
    const wrapper = new SolaceSession(session, config)

    return new Promise<SolaceSession>((resolve, reject) => {
      let settled = false
      const fail = (msg: string) => {
        if (settled) return
        settled = true
        try {
          session.dispose()
        } catch {
          /* ignore */
        }
        reject(new Error(msg))
      }
      // guard in case the library never reports back (e.g. DNS hangs)
      const guard = setTimeout(() => fail(`Connect timeout after ${timeout} ms`), timeout + 2000)

      session.on(s.SessionEventCode.UP_NOTICE, () => {
        if (settled) return
        settled = true
        clearTimeout(guard)
        resolve(wrapper)
      })
      session.on(s.SessionEventCode.CONNECT_FAILED_ERROR, (e: solace.SessionEvent) => {
        clearTimeout(guard)
        fail(`Connect failed: ${e.infoStr || e.reason || 'unknown error'}`)
      })
      session.on(s.SessionEventCode.DISCONNECTED, () => wrapper.onDisconnected())
      session.on(s.SessionEventCode.DOWN_ERROR, () => wrapper.onDisconnected())
      session.on(s.SessionEventCode.ACKNOWLEDGED_MESSAGE, (e: solace.SessionEvent) => wrapper.onAck(e, true))
      session.on(s.SessionEventCode.REJECTED_MESSAGE_ERROR, (e: solace.SessionEvent) => wrapper.onAck(e, false))
      session.on(s.SessionEventCode.SUBSCRIPTION_OK, (e: solace.SessionEvent) => wrapper.onSubscription(e, true))
      session.on(s.SessionEventCode.SUBSCRIPTION_ERROR, (e: solace.SessionEvent) => wrapper.onSubscription(e, false))
      session.on(s.SessionEventCode.MESSAGE, (m: solace.Message) => wrapper.messageListeners.forEach((l) => l(m)))

      try {
        session.connect()
      } catch (e) {
        clearTimeout(guard)
        fail(`Connect failed: ${errMsg(e)}`)
      }
    })
  }

  get isClosed(): boolean {
    return this.closed
  }

  /** Publishes a message. PERSISTENT resolves on broker ACK, DIRECT right after send(). */
  publish(spec: PublishSpec): Promise<PublishResult> {
    if (this.closed) return Promise.reject(new Error('Session is closed'))
    let msg: solace.Message
    try {
      msg = buildMessage(spec)
    } catch (e) {
      return Promise.reject(e)
    }
    const started = Date.now()

    if (spec.deliveryMode !== 'PERSISTENT') {
      try {
        this.session.send(msg)
      } catch (e) {
        return Promise.reject(new Error(`Send failed: ${errMsg(e)}`))
      }
      return Promise.resolve({ latencyMs: Date.now() - started })
    }

    const key = randomUUID()
    msg.setCorrelationKey(key)
    const ackTimeout = spec.ackTimeoutMs || DEFAULT_ACK_TIMEOUT_MS
    return new Promise<PublishResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key)
        reject(new Error(`No broker acknowledgement within ${ackTimeout} ms`))
      }, ackTimeout)
      this.pending.set(key, { resolve, reject, timer, sentAt: started })
      try {
        this.session.send(msg)
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(key)
        reject(new Error(`Send failed: ${errMsg(e)}`))
      }
    })
  }

  /** Adds a topic subscription and resolves when the broker confirmed it. */
  subscribe(topic: string, timeoutMs = 10000): Promise<void> {
    const s = sol()
    const key = randomUUID()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSubscriptions.delete(key)
        reject(new Error(`Subscription to "${topic}" not confirmed within ${timeoutMs} ms`))
      }, timeoutMs + 1000)
      this.pendingSubscriptions.set(key, {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      try {
        this.session.subscribe(s.SolclientFactory.createTopicDestination(topic), true, key, timeoutMs)
      } catch (e) {
        clearTimeout(timer)
        this.pendingSubscriptions.delete(key)
        reject(new Error(`Subscribe failed: ${errMsg(e)}`))
      }
    })
  }

  /** Registers a listener for direct messages (topic subscriptions). Returns an unregister function. */
  onMessage(listener: (msg: solace.Message) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  /** Binds to a queue. CLIENT ack mode - the caller acknowledges. */
  createQueueConsumer(queue: string): Promise<solace.MessageConsumer> {
    const s = sol()
    const consumer = this.session.createMessageConsumer({
      queueDescriptor: { name: queue, type: s.QueueType.QUEUE },
      acknowledgeMode: s.MessageConsumerAcknowledgeMode.CLIENT,
      createIfMissing: false
    })
    return bindFlow(consumer, s.MessageConsumerEventName, `queue "${queue}"`, this.bindTimeoutMs)
  }

  /** Opens a queue browser (messages stay on the queue). */
  createQueueBrowser(queue: string): Promise<solace.QueueBrowser> {
    const s = sol()
    const browser = this.session.createQueueBrowser({
      queueDescriptor: { name: queue, type: s.QueueType.QUEUE }
    })
    return bindFlow(browser, s.QueueBrowserEventName, `queue browser "${queue}"`, this.bindTimeoutMs)
  }

  /** like the connect guard: the broker's connect timeout plus a margin */
  private get bindTimeoutMs(): number {
    return (this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS) + 2000
  }

  /** Disconnects (unless the broker already dropped the session) and disposes the session, exactly once. */
  async close(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (!this.closed) {
      this.closed = true
      const s = sol()
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3000)
        this.session.on(s.SessionEventCode.DISCONNECTED, () => {
          clearTimeout(timer)
          resolve()
        })
        try {
          this.session.disconnect()
        } catch {
          clearTimeout(timer)
          resolve()
        }
      })
    }
    try {
      this.session.dispose()
    } catch {
      /* ignore */
    }
    this.failPending(new Error('Session closed'))
  }

  private onAck(e: solace.SessionEvent, ok: boolean) {
    const key = String(e.correlationKey)
    const p = this.pending.get(key)
    if (!p) return
    this.pending.delete(key)
    clearTimeout(p.timer)
    if (ok) p.resolve({ latencyMs: Date.now() - p.sentAt })
    else p.reject(new Error(`Rejected by broker: ${e.infoStr || 'unknown reason'}`))
  }

  private onSubscription(e: solace.SessionEvent, ok: boolean) {
    const key = String(e.correlationKey)
    const p = this.pendingSubscriptions.get(key)
    if (!p) return
    this.pendingSubscriptions.delete(key)
    if (ok) p.resolve()
    else p.reject(new Error(`Subscription rejected: ${e.infoStr || 'unknown reason'}`))
  }

  /** Called once when the broker drops the session (not on close()). */
  onUnexpectedClose(listener: (reason: string) => void): void {
    this.closeListeners.add(listener)
  }

  private onDisconnected() {
    const unexpected = !this.closed
    this.closed = true
    this.failPending(new Error('Session disconnected'))
    if (unexpected) this.closeListeners.forEach((l) => l('Session disconnected by broker'))
    this.closeListeners.clear()
  }

  private failPending(err: Error) {
    for (const [key, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
      this.pending.delete(key)
    }
    for (const [key, p] of this.pendingSubscriptions) {
      p.reject(err)
      this.pendingSubscriptions.delete(key)
    }
  }
}

/**
 * Connects a queue consumer / browser and resolves once it is up. Guarded by a timeout: if the broker never
 * answers, the caller (a live subscription being started) must not hang and keep its slot for good.
 */
function bindFlow<T extends solace.MessageConsumer | solace.QueueBrowser>(
  flow: T,
  events: { UP: string; CONNECT_FAILED_ERROR: string },
  label: string,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const settle = (done: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(guard)
      done()
    }
    const fail = (reason: string) => settle(() => reject(new Error(`Cannot bind to ${label}: ${reason}`)))
    const guard = setTimeout(() => {
      try {
        flow.disconnect()
      } catch {
        /* ignore */
      }
      fail(`no answer from the broker within ${timeoutMs} ms`)
    }, timeoutMs)

    flow.on(events.UP, () => settle(() => resolve(flow)))
    flow.on(events.CONNECT_FAILED_ERROR, (e: { infoStr?: string; message?: string }) => fail(e?.infoStr || e?.message || 'unknown error'))
    try {
      flow.connect()
    } catch (e) {
      fail(errMsg(e))
    }
  })
}

/** Builds a solclientjs message from a publish spec. */
export function buildMessage(spec: PublishSpec): solace.Message {
  const s = sol()
  const msg = s.SolclientFactory.createMessage()
  msg.setDestination(s.SolclientFactory.createTopicDestination(spec.topic))
  msg.setBinaryAttachment(Buffer.from(spec.payload ?? '', 'utf8'))
  msg.setDeliveryMode(
    spec.deliveryMode === 'PERSISTENT' ? s.MessageDeliveryModeType.PERSISTENT : s.MessageDeliveryModeType.DIRECT
  )
  if (spec.contentType) msg.setHttpContentType(spec.contentType)
  if (spec.correlationId) msg.setCorrelationId(spec.correlationId)
  if (spec.timeToLiveMs && spec.timeToLiveMs > 0) msg.setTimeToLive(spec.timeToLiveMs)
  if (spec.dmqEligible != null) msg.setDMQEligible(!!spec.dmqEligible)
  if (spec.priority != null) msg.setPriority(spec.priority)

  if (spec.userProperties?.length) {
    const map = new s.SDTMapContainer()
    for (const p of spec.userProperties) {
      switch (p.type) {
        case 'INT': {
          const n = parseInt64(p.value)
          if (n === undefined) throw new Error(`User property "${p.name}" is not an integer in the safe range: ${p.value}`)
          map.addField(p.name, s.SDTFieldType.INT64, n)
          break
        }
        case 'BOOL': {
          const b = parseBool(p.value)
          if (b === undefined) throw new Error(`User property "${p.name}" is not true or false: ${p.value}`)
          map.addField(p.name, s.SDTFieldType.BOOL, b)
          break
        }
        default:
          map.addField(p.name, s.SDTFieldType.STRING, p.value ?? '')
      }
    }
    msg.setUserPropertyMap(map)
  }
  return msg
}

/** Converts a received solclientjs message into a plain object. */
export function readMessage(msg: solace.Message): ReceivedMessage {
  const s = sol()
  let payload = ''
  if (msg.getType() === s.MessageType.TEXT) {
    payload = String(msg.getSdtContainer()?.getValue() ?? '')
  } else {
    const bin = msg.getBinaryAttachment()
    if (bin != null) payload = Buffer.isBuffer(bin) ? bin.toString('utf8') : Buffer.from(bin, 'latin1').toString('utf8')
  }

  const userProperties: Record<string, unknown> = {}
  const map = msg.getUserPropertyMap()
  if (map) {
    for (const k of map.getKeys()) {
      const v = map.getField(k)?.getValue()
      // INT64 fields may come back as Long-like objects
      userProperties[k] = v != null && typeof v === 'object' && 'toString' in v ? String(v) : v
    }
  }

  const dm = msg.getDeliveryMode()
  return {
    topic: msg.getDestination()?.getName() ?? '',
    payload,
    contentType: msg.getHttpContentType() || null,
    userProperties,
    correlationId: msg.getCorrelationId() || null,
    deliveryMode:
      dm === s.MessageDeliveryModeType.PERSISTENT
        ? 'PERSISTENT'
        : dm === s.MessageDeliveryModeType.NON_PERSISTENT
          ? 'NON_PERSISTENT'
          : 'DIRECT',
    receivedAt: new Date(msg.getReceiverTimestamp() || Date.now())
  }
}
