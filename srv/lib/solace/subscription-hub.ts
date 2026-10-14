import cds from '@sap/cds'
import type solace from 'solclientjs'
import { loadBroker, resolveConnection } from '../credentials/resolve'
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
}

interface Subscription {
  id: string
  owner: string
  brokerId: string
  brokerName: string
  sourceType: SourceType
  source: string
  startedAt: Date
  /** last client heartbeat - messages do not count, so orphaned subscriptions get closed */
  lastHeartbeat: number
  messageCount: number
  /** messages forwarded in the current one-second window (throttling) */
  windowStart: number
  windowCount: number
  throttled: boolean
  session: SolaceSession
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

const cfg = () =>
  ({
    maxPerUser: 5,
    idleTimeoutMs: 5 * 60 * 1000,
    maxMessagesPerSecond: 100,
    maxPayloadBytes: 512 * 1024,
    ...(cds.env as unknown as { aemSuite?: { subscriptions?: Record<string, number> } }).aemSuite?.subscriptions
  }) as { maxPerUser: number; idleTimeoutMs: number; maxMessagesPerSecond: number; maxPayloadBytes: number }

const subscriptions = new Map<string, Subscription>()
let sweeper: NodeJS.Timeout | undefined

/**
 * Opens a dedicated session for a live subscription and forwards every message
 * to the websocket service (LiveService.message, context = subscription id).
 * NOTE: state is held in memory of this app instance.
 */
export async function startSubscription(req: StartRequest): Promise<string> {
  const { maxPerUser } = cfg()
  const own = [...subscriptions.values()].filter((s) => s.owner === req.owner)
  if (own.length >= maxPerUser) throw httpError(429, `Maximum of ${maxPerUser} parallel subscriptions reached`)

  let source: string
  if (req.sourceType === 'TOPIC') {
    const topics = (req.topics ?? []).map((t) => t.trim()).filter(Boolean)
    if (!topics.length) throw httpError(400, 'Enter at least one topic subscription')
    source = topics.join(', ')
  } else if (req.sourceType === 'QUEUE_BROWSE' || req.sourceType === 'QUEUE_CONSUME') {
    if (!req.queue?.trim()) throw httpError(400, 'Enter a queue name')
    source = req.queue.trim()
  } else throw httpError(400, `Unknown source type ${req.sourceType}`)

  const broker = await loadBroker(req.brokerId)
  let conn
  try {
    conn = await resolveConnection(broker, req.jwt, req.password)
  } catch (e) {
    throw httpError(400, (e as Error).message)
  }
  const session = await SolaceSession.connect(conn)

  const sub: Subscription = {
    id: cds.utils.uuid(),
    owner: req.owner,
    brokerId: broker.ID,
    brokerName: broker.name,
    sourceType: req.sourceType,
    source,
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
      for (const t of source.split(', ')) await session.subscribe(t)
    } else if (req.sourceType === 'QUEUE_BROWSE') {
      const browser = await session.createQueueBrowser(source)
      browser.on(s.QueueBrowserEventName.MESSAGE, (m: solace.Message) => forward(sub, m))
      browser.on(s.QueueBrowserEventName.DOWN_ERROR, () => void drop(sub, 'Queue browser went down'))
      sub.flow = browser
    } else {
      const consumer = await session.createQueueConsumer(source)
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
    throw httpError(400, (e as Error).message)
  }

  session.onUnexpectedClose((reason) => void drop(sub, reason))
  subscriptions.set(sub.id, sub)
  ensureSweeper()
  LOG.info(`Subscription ${sub.id} started by ${sub.owner}: ${sub.sourceType} ${sub.source} @ ${sub.brokerName}`)
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
      source: s.source,
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
  if (now - sub.windowStart >= 1000) {
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
  if (Buffer.byteLength(payload) > maxPayloadBytes) payload = payload.slice(0, maxPayloadBytes) + '\n... [truncated]'

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
  }, 30 * 1000)
  sweeper.unref()
}

/** Client heartbeat - keeps the subscription from being idle-closed. */
export function touch(id: string, owner: string): boolean {
  const sub = subscriptions.get(id)
  if (!sub || sub.owner !== owner) return false
  sub.lastHeartbeat = Date.now()
  return true
}

function httpError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code, status: code })
}
