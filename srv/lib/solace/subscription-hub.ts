import cds from '@sap/cds'
import type solace from 'solclientjs'
import { config } from '../config'
import { BrokerConnection, loadBroker, resolveConnection } from '../credentials/resolve'
import { errMsg, httpError } from '../errors'
import { readMessage, SolaceSession, sol } from './session'

const LOG = cds.log('aem-subscribe')

export type SourceType = 'TOPIC' | 'QUEUE_BROWSE' | 'QUEUE_CONSUME'

export interface StartRequest {
  brokerId: string
  sourceType: SourceType
  topics?: string[] | null
  queue?: string | null
  owner: string
  jwt?: string
  /** DIRECT brokers - used to open the session, not kept afterwards */
  password?: string
  /** DIRECT brokers without a maintained username */
  username?: string
}

interface Subscription {
  id: string
  owner: string
  brokerId: string
  brokerName: string
  sourceType: SourceType
  /** topic subscriptions (TOPIC) or the queue name */
  sources: string[]
  startedAt: Date
  /** last client heartbeat - messages do not count, so orphaned subscriptions get closed */
  lastHeartbeat: number
  messageCount: number
  /** messages forwarded in the current one-second window (throttling) */
  windowStart: number
  windowCount: number
  throttled: boolean
  session: SubscriberSession
  flow?: solace.MessageConsumer | solace.QueueBrowser
}

export interface SubscriptionInfo {
  subscriptionId: string
  brokerId: string
  brokerName: string
  sourceType: string
  source: string
  startedAt: string
  messageCount: number
}

/** What the hub needs of a broker session - SolaceSession, or a fake in tests. */
export type SubscriberSession = Pick<
  SolaceSession,
  'subscribe' | 'onMessage' | 'createQueueBrowser' | 'createQueueConsumer' | 'onUnexpectedClose' | 'close'
>
export type SessionFactory = (conn: BrokerConnection) => Promise<SubscriberSession>

const defaultFactory: SessionFactory = (conn) => SolaceSession.connect(conn)
let openSession: SessionFactory = defaultFactory

/** Replaces the broker connection of live subscriptions - used by tests. */
export function setSessionFactory(factory?: SessionFactory): void {
  openSession = factory ?? defaultFactory
}

const cfg = () => config().subscriptions

const subscriptions = new Map<string, Subscription>()
/** subscriptions being opened, per owner - they count against the limit while connecting */
const starting = new Map<string, number>()
let sweeper: NodeJS.Timeout | undefined

const SWEEP_INTERVAL_MS = 30 * 1000
const THROTTLE_WINDOW_MS = 1000

/**
 * Opens a dedicated session for a live subscription and forwards every message
 * to the websocket service (LiveService.message, context = subscription id).
 * NOTE: state is held in memory of this app instance.
 */
export async function startSubscription(req: StartRequest): Promise<string> {
  const sources = sourcesOf(req)
  // reserve the slot before connecting, so parallel starts cannot pass the limit together
  const { maxPerUser } = cfg()
  const own = [...subscriptions.values()].filter((s) => s.owner === req.owner).length + (starting.get(req.owner) ?? 0)
  if (own >= maxPerUser) throw httpError(429, `Maximum of ${maxPerUser} parallel subscriptions reached`)
  starting.set(req.owner, (starting.get(req.owner) ?? 0) + 1)
  try {
    return await open(req, sources)
  } finally {
    const left = (starting.get(req.owner) ?? 1) - 1
    if (left) starting.set(req.owner, left)
    else starting.delete(req.owner)
  }
}

function sourcesOf(req: StartRequest): string[] {
  if (req.sourceType === 'TOPIC') {
    const topics = (req.topics ?? []).map((t) => t.trim()).filter(Boolean)
    if (!topics.length) throw httpError(400, 'Enter at least one topic subscription')
    return topics
  }
  if (req.sourceType === 'QUEUE_BROWSE' || req.sourceType === 'QUEUE_CONSUME') {
    if (!req.queue?.trim()) throw httpError(400, 'Enter a queue name')
    return [req.queue.trim()]
  }
  throw httpError(400, `Unknown source type ${req.sourceType}`)
}

async function open(req: StartRequest, sources: string[]): Promise<string> {
  const broker = await loadBroker(req.brokerId)
  // same rule as for runs
  if (broker.active === false) throw httpError(400, `Broker "${broker.name}" is inactive`)
  // a wrong password or an unreachable broker is the user's to fix: 400 with the broker's reason
  // (CAP would hide the message of a 5xx in production)
  let session
  try {
    session = await openSession(await resolveConnection(broker, req.jwt, req.password, req.username))
  } catch (e) {
    throw httpError(400, errMsg(e))
  }

  const sub: Subscription = {
    id: cds.utils.uuid(),
    owner: req.owner,
    brokerId: broker.ID,
    brokerName: broker.name,
    sourceType: req.sourceType,
    sources,
    startedAt: new Date(),
    lastHeartbeat: Date.now(),
    messageCount: 0,
    windowStart: Date.now(),
    windowCount: 0,
    throttled: false,
    session
  }

  try {
    const s = sol()
    if (req.sourceType === 'TOPIC') {
      session.onMessage((m) => forward(sub, m))
      for (const t of sources) await session.subscribe(t)
    } else if (req.sourceType === 'QUEUE_BROWSE') {
      const browser = await session.createQueueBrowser(sources[0])
      browser.on(s.QueueBrowserEventName.MESSAGE, (m: solace.Message) => forward(sub, m))
      browser.on(s.QueueBrowserEventName.DOWN_ERROR, () => void drop(sub, 'Queue browser went down'))
      sub.flow = browser
    } else {
      const consumer = await session.createQueueConsumer(sources[0])
      consumer.on(s.MessageConsumerEventName.MESSAGE, (m: solace.Message) => {
        forward(sub, m)
        try {
          m.acknowledge()
        } catch (e) {
          LOG.warn('acknowledge failed', e)
        }
      })
      consumer.on(s.MessageConsumerEventName.DOWN_ERROR, () => void drop(sub, 'Queue consumer went down'))
      sub.flow = consumer
    }
  } catch (e) {
    await session.close().catch(() => undefined)
    throw httpError(400, errMsg(e))
  }

  session.onUnexpectedClose((reason) => void drop(sub, reason))
  subscriptions.set(sub.id, sub)
  ensureSweeper()
  LOG.info(`Subscription ${sub.id} started by ${sub.owner}: ${sub.sourceType} ${sub.sources.join(', ')} @ ${sub.brokerName}`)
  return sub.id
}

export async function stopSubscription(id: string, owner: string): Promise<void> {
  const sub = subscriptions.get(id)
  if (!sub) return
  if (sub.owner !== owner) throw httpError(403, 'Not your subscription')
  await close(sub, 'STOPPED', 'Stopped by user')
}

export function listSubscriptions(owner: string): SubscriptionInfo[] {
  return [...subscriptions.values()]
    .filter((s) => s.owner === owner)
    .map((s) => ({
      subscriptionId: s.id,
      brokerId: s.brokerId,
      brokerName: s.brokerName,
      sourceType: s.sourceType,
      source: s.sources.join(', '),
      startedAt: s.startedAt.toISOString(),
      messageCount: s.messageCount
    }))
}

export async function stopAll(): Promise<void> {
  await Promise.allSettled([...subscriptions.values()].map((s) => close(s, 'STOPPED', 'Server shutdown')))
  if (sweeper) clearInterval(sweeper)
  sweeper = undefined
}

function forward(sub: Subscription, m: solace.Message) {
  const { maxMessagesPerSecond, maxPayloadBytes } = cfg()
  sub.messageCount++

  const now = Date.now()
  if (now - sub.windowStart >= THROTTLE_WINDOW_MS) {
    if (sub.throttled) void status(sub, 'RESUMED', 'Message rate back to normal')
    sub.windowStart = now
    sub.windowCount = 0
    sub.throttled = false
  }
  if (++sub.windowCount > maxMessagesPerSecond) {
    if (!sub.throttled) {
      sub.throttled = true
      void status(sub, 'THROTTLED', `More than ${maxMessagesPerSecond} msg/s - not all messages are shown`)
    }
    return
  }

  let msg
  try {
    msg = readMessage(m)
  } catch (e) {
    LOG.warn('Cannot read message', e)
    return
  }
  let payload = msg.payload
  if (Buffer.byteLength(payload) > maxPayloadBytes)
    // cut at the byte limit; a multi-byte character split there becomes U+FFFD, so drop it
    payload = Buffer.from(payload).subarray(0, maxPayloadBytes).toString('utf8').replace(/�$/, '') + '\n... [truncated]'

  void emit('message', {
    subscriptionId: sub.id,
    brokerId: sub.brokerId,
    topic: msg.topic,
    payload,
    contentType: msg.contentType,
    userProperties: JSON.stringify(msg.userProperties),
    correlationId: msg.correlationId,
    deliveryMode: msg.deliveryMode,
    receivedAt: msg.receivedAt.toISOString(),
    seq: sub.messageCount
  })
}

async function drop(sub: Subscription, reason: string) {
  if (!subscriptions.has(sub.id)) return
  await close(sub, 'DOWN', reason)
}

async function close(sub: Subscription, state: string, message: string) {
  subscriptions.delete(sub.id)
  try {
    sub.flow?.disconnect()
  } catch {
    /* ignore */
  }
  await sub.session.close().catch(() => undefined)
  await status(sub, state, message)
  LOG.info(`Subscription ${sub.id} closed: ${message}`)
}

function status(sub: Subscription, state: string, message: string) {
  return emit('subscriptionStatus', { subscriptionId: sub.id, status: state, message })
}

async function emit(event: string, data: Record<string, unknown>) {
  try {
    const live = await cds.connect.to('LiveService')
    await live.emit(event, data)
  } catch (e) {
    LOG.debug(`emit ${event} failed`, e)
  }
}

function ensureSweeper() {
  if (sweeper) return
  sweeper = setInterval(() => {
    const { idleTimeoutMs } = cfg()
    for (const sub of subscriptions.values()) {
      if (Date.now() - sub.lastHeartbeat > idleTimeoutMs) void close(sub, 'STOPPED', 'No heartbeat from client (idle timeout)')
    }
    if (!subscriptions.size && sweeper) {
      clearInterval(sweeper)
      sweeper = undefined
    }
  }, SWEEP_INTERVAL_MS)
  sweeper.unref()
}

/** Client heartbeat - keeps the subscription from being idle-closed. */
export function touch(id: string, owner: string): boolean {
  const sub = subscriptions.get(id)
  if (!sub || sub.owner !== owner) return false
  sub.lastHeartbeat = Date.now()
  return true
}
