import { EventEmitter } from 'node:events'
import type solaceTypes from 'solclientjs'
import { buildMessage, PublishSpec, sol } from '../../srv/lib/solace/session'
import type { SubscriberSession } from '../../srv/lib/solace/subscription-hub'

export type Behaviour = 'ack' | 'reject' | 'silent'
/** how the fake broker answers connect() / subscribe() / disconnect(): 'silent' = never */
export type Answer = 'ok' | 'error' | 'silent'

/** Fake solclientjs session: reacts to connect()/send() with configurable events. */
export class FakeSolclientSession extends EventEmitter {
  sent: solaceTypes.Message[] = []
  /** solclientjs uses numeric event codes */
  fire(code: number, data: unknown) {
    return this.emit(code as unknown as string, data)
  }
  subscribeAnswer: Answer = 'ok'
  disconnectAnswer: Answer = 'ok'
  constructor(
    private connectOk: boolean | 'silent' = true,
    public behaviour: Behaviour = 'ack'
  ) {
    super()
  }
  connect() {
    const s = sol()
    if (this.connectOk === 'silent') return
    setImmediate(() =>
      this.connectOk
        ? this.fire(s.SessionEventCode.UP_NOTICE, {})
        : this.fire(s.SessionEventCode.CONNECT_FAILED_ERROR, { infoStr: 'Unauthorized' })
    )
  }
  subscribe(_topic: unknown, _confirm: boolean, correlationKey: string) {
    const s = sol()
    if (this.subscribeAnswer === 'ok') setImmediate(() => this.fire(s.SessionEventCode.SUBSCRIPTION_OK, { correlationKey }))
    if (this.subscribeAnswer === 'error') setImmediate(() => this.fire(s.SessionEventCode.SUBSCRIPTION_ERROR, { correlationKey, infoStr: 'Subscription ACL Denied' }))
  }
  send(m: solaceTypes.Message) {
    const s = sol()
    this.sent.push(m)
    const key = (m as unknown as { getCorrelationKey(): unknown }).getCorrelationKey()
    if (this.behaviour === 'ack') setImmediate(() => this.fire(s.SessionEventCode.ACKNOWLEDGED_MESSAGE, { correlationKey: key }))
    if (this.behaviour === 'reject')
      setImmediate(() =>
        this.fire(s.SessionEventCode.REJECTED_MESSAGE_ERROR, { correlationKey: key, infoStr: 'Queue full' })
      )
  }
  disconnect() {
    if (this.disconnectAnswer === 'ok') setImmediate(() => this.fire(sol().SessionEventCode.DISCONNECTED, {}))
  }
  disposed = 0
  dispose() {
    this.disposed++
  }
  /** queue consumers / browsers: a flow that never answers the bind (see flowAnswers) */
  flow = new FakeFlow()
  createMessageConsumer() {
    return this.flow
  }
  createQueueBrowser() {
    return this.flow
  }
}

/** A queue browser / consumer: emits messages, acknowledges nothing. */
export class FakeFlow extends EventEmitter {
  disconnected = false
  acknowledged = 0
  /** acknowledge() throws (a consumer whose flow just went down) */
  failAck = false
  /** what connect() does: nothing (a broker that never answers), or fire the given event */
  connectAnswer?: string
  connect() {
    const answer = this.connectAnswer
    if (answer) setImmediate(() => this.emit(answer, { infoStr: 'Unknown Queue' }))
  }
  disconnect() {
    this.disconnected = true
  }
  /** delivers a message built from the spec (a real solclientjs message) */
  deliver(event: string, spec: Partial<PublishSpec> = {}) {
    const m = buildMessage({ topic: 'acme/x', payload: '{}', deliveryMode: 'PERSISTENT', ...spec })
    ;(m as unknown as { acknowledge(): void }).acknowledge = () => {
      if (this.failAck) throw new Error('Flow is down')
      this.acknowledged++
    }
    this.emit(event, m)
  }
}

/** The broker session of a live subscription (subscription-hub), recording what the hub asked for. */
export class FakeSubscriberSession implements SubscriberSession {
  subscribed: string[] = []
  closed = false
  flow = new FakeFlow()
  /** the broker refuses topic subscriptions containing this text */
  failSubscribe?: string
  private listeners: ((m: solaceTypes.Message) => void)[] = []
  private closeListeners: ((reason: string) => void)[] = []

  async subscribe(topic: string) {
    if (this.failSubscribe && topic.includes(this.failSubscribe)) throw new Error(`Subscription rejected: Subscription ACL Denied (${topic})`)
    this.subscribed.push(topic)
  }
  onMessage(listener: (m: solaceTypes.Message) => void) {
    this.listeners.push(listener)
    return () => true
  }
  async createQueueBrowser() {
    return this.flow as unknown as solaceTypes.QueueBrowser
  }
  async createQueueConsumer() {
    return this.flow as unknown as solaceTypes.MessageConsumer
  }
  onUnexpectedClose(listener: (reason: string) => void) {
    this.closeListeners.push(listener)
  }
  async close() {
    this.closed = true
  }

  /** a direct message on a topic subscription */
  deliver(spec: Partial<PublishSpec> = {}) {
    const m = buildMessage({ topic: 'acme/x', payload: '{}', deliveryMode: 'DIRECT', ...spec })
    this.listeners.forEach((l) => l(m))
  }
  /** the broker drops the session */
  drop(reason = 'Session disconnected by broker') {
    this.closeListeners.forEach((l) => l(reason))
  }
}
