import cds from '@sap/cds'
import path from 'node:path'
import { sol } from '../srv/lib/solace/session'
import {
  listSubscriptions,
  setSessionFactory,
  startSubscription,
  StartRequest,
  stopAll,
  stopSubscription,
  touch
} from '../srv/lib/solace/subscription-hub'
import { FakeSubscriberSession } from './fakes/solace'
import { resetDatabase, withAemSuiteConfig } from './helpers'

cds.test(path.join(__dirname, '..'))

describe('subscription hub (live view)', () => {
  const brokerId = cds.utils.uuid()
  let sessions: FakeSubscriberSession[]
  let emitted: { event: string; data: Record<string, unknown> }[]
  const start = (extra: Partial<StartRequest> = {}) =>
    startSubscription({ brokerId, sourceType: 'TOPIC', topics: ['acme/>'], owner: 'alice', password: 'pw', ...extra })
  const statusOf = (id: string) => emitted.filter((e) => e.event === 'subscriptionStatus' && e.data.subscriptionId === id)
  const messagesOf = (id: string) => emitted.filter((e) => e.event === 'message' && e.data.subscriptionId === id)
  /** the hub emits asynchronously */
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise(setImmediate)
  }

  beforeAll(async () => {
    await resetDatabase()
    await INSERT.into('aem.suite.Brokers').entries({
      ID: brokerId,
      name: 'dev',
      credentialMode: 'DIRECT',
      url: 'wss://dev:443',
      msgVpn: 'v',
      username: 'u'
    })
    const live = await cds.connect.to('LiveService')
    jest.spyOn(live, 'emit').mockImplementation((async (event: string, data: Record<string, unknown>) => {
      emitted.push({ event, data })
    }) as never)
  })

  beforeEach(() => {
    sessions = []
    emitted = []
    setSessionFactory(async () => {
      const s = new FakeSubscriberSession()
      sessions.push(s)
      return s
    })
  })

  afterEach(async () => {
    await stopAll()
    setSessionFactory()
    jest.useRealTimers()
  })

  afterAll(() => jest.restoreAllMocks())

  it('subscribes to every topic as entered - a topic may contain ", "', async () => {
    const id = await start({ topics: [' a/b, c ', 'd/>', ''] })
    expect(sessions[0].subscribed).toEqual(['a/b, c', 'd/>'])
    expect(listSubscriptions('alice')).toEqual([
      expect.objectContaining({ subscriptionId: id, brokerName: 'dev', sourceType: 'TOPIC', source: 'a/b, c, d/>' })
    ])
  })

  it('forwards received messages to the owner\'s websocket context', async () => {
    const id = await start()
    sessions[0].deliver({ topic: 'acme/orders', payload: '{"a":1}', userProperties: [{ name: 'n', type: 'INT', value: '7' }] })
    await settle()
    expect(messagesOf(id)).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ topic: 'acme/orders', payload: '{"a":1}', userProperties: '{"n":7}', seq: 1, brokerId })
      })
    ])
  })

  it('cuts payloads at the byte limit without breaking a character', async () =>
    withAemSuiteConfig({ subscriptions: { maxPayloadBytes: 5 } }, async () => {
      const id = await start()
      sessions[0].deliver({ payload: 'abcdéf' }) // é takes bytes 5 and 6
      await settle()
      expect(messagesOf(id)[0].data.payload).toBe('abcd\n... [truncated]')
    }))

  it('throttles busy subscriptions and tells the client', async () =>
    withAemSuiteConfig({ subscriptions: { maxMessagesPerSecond: 2 } }, async () => {
      const id = await start()
      for (let i = 0; i < 5; i++) sessions[0].deliver()
      await settle()
      expect(messagesOf(id)).toHaveLength(2)
      expect(statusOf(id)).toEqual([expect.objectContaining({ data: expect.objectContaining({ status: 'THROTTLED' }) })])
      expect(listSubscriptions('alice')[0].messageCount).toBe(5)
    }))

  it('browses a queue and consumes from a queue (acknowledging each message)', async () => {
    const s = sol()
    const browse = await start({ sourceType: 'QUEUE_BROWSE', queue: ' orders ' })
    sessions[0].flow.deliver(s.QueueBrowserEventName.MESSAGE)
    await settle()
    expect(messagesOf(browse)).toHaveLength(1)
    expect(sessions[0].flow.acknowledged).toBe(0)

    const consume = await start({ sourceType: 'QUEUE_CONSUME', queue: 'orders' })
    sessions[1].flow.deliver(s.MessageConsumerEventName.MESSAGE)
    await settle()
    expect(messagesOf(consume)).toHaveLength(1)
    expect(sessions[1].flow.acknowledged).toBe(1)

    await stopSubscription(consume, 'alice')
    expect(sessions[1].flow.disconnected).toBe(true)
    expect(sessions[1].closed).toBe(true)
  })

  it('validates the input before connecting', async () => {
    await expect(start({ topics: [' '] })).rejects.toMatchObject({ status: 400, message: 'Enter at least one topic subscription' })
    await expect(start({ sourceType: 'QUEUE_BROWSE', queue: '' })).rejects.toMatchObject({ status: 400 })
    await expect(start({ sourceType: 'OTHER' as never })).rejects.toMatchObject({ status: 400 })
    await expect(start({ password: undefined })).rejects.toMatchObject({ status: 400, message: 'Password required for broker "dev"' })
    expect(sessions).toHaveLength(0)
  })

  it('lets only the owner see, keep alive and stop a subscription', async () => {
    const id = await start()
    expect(listSubscriptions('bob')).toEqual([])
    expect(touch(id, 'bob')).toBe(false)
    expect(touch(id, 'alice')).toBe(true)
    await expect(stopSubscription(id, 'bob')).rejects.toMatchObject({ status: 403 })
    await stopSubscription(id, 'alice')
    await settle()
    expect(listSubscriptions('alice')).toEqual([])
    expect(statusOf(id)).toEqual([expect.objectContaining({ data: expect.objectContaining({ status: 'STOPPED' }) })])
  })

  it('limits parallel subscriptions per user - also when they are started at the same time', async () =>
    withAemSuiteConfig({ subscriptions: { maxPerUser: 2 } }, async () => {
      const results = await Promise.allSettled([start(), start(), start()])
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'fulfilled', 'rejected'])
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 429 } })
      expect(sessions).toHaveLength(2)
      await expect(start({ owner: 'bob' })).resolves.toBeTruthy()
    }))

  it('frees the slot when connecting fails', async () =>
    withAemSuiteConfig({ subscriptions: { maxPerUser: 1 } }, async () => {
      setSessionFactory(async () => {
        throw new Error('Connect failed: Unauthorized')
      })
      await expect(start()).rejects.toThrow('Unauthorized')
      setSessionFactory(async () => new FakeSubscriberSession())
      await expect(start()).resolves.toBeTruthy()
    }))

  it('closes the session and answers 400 when the broker refuses a topic', async () => {
    setSessionFactory(async () => {
      const s = new FakeSubscriberSession()
      s.failSubscribe = 'secret'
      sessions.push(s)
      return s
    })
    await expect(start({ topics: ['acme/>', 'secret/>'] })).rejects.toMatchObject({ status: 400, message: 'Subscription rejected: Subscription ACL Denied (secret/>)' })
    expect(sessions[0].closed).toBe(true)
    expect(listSubscriptions('alice')).toEqual([])
  })

  it('closes a queue subscription whose flow went down', async () => {
    const id = await start({ sourceType: 'QUEUE_CONSUME', queue: 'orders' })
    sessions[0].flow.emit(sol().MessageConsumerEventName.DOWN_ERROR)
    await settle()
    expect(listSubscriptions('alice')).toEqual([])
    expect(sessions[0].closed).toBe(true)
    expect(statusOf(id)).toEqual([expect.objectContaining({ data: expect.objectContaining({ status: 'DOWN', message: 'Queue consumer went down' }) })])
  })

  it('still shows a consumed message when acknowledging it fails', async () => {
    const id = await start({ sourceType: 'QUEUE_CONSUME', queue: 'orders' })
    sessions[0].flow.failAck = true
    sessions[0].flow.deliver(sol().MessageConsumerEventName.MESSAGE)
    await settle()
    expect(messagesOf(id)).toHaveLength(1)
    expect(listSubscriptions('alice')).toHaveLength(1)
  })

  it('closes subscriptions the broker dropped', async () => {
    const id = await start()
    sessions[0].drop()
    await settle()
    expect(listSubscriptions('alice')).toEqual([])
    expect(statusOf(id)).toEqual([expect.objectContaining({ data: expect.objectContaining({ status: 'DOWN' }) })])
  })

  it('closes subscriptions without heartbeat after the idle timeout', async () =>
    withAemSuiteConfig({ subscriptions: { idleTimeoutMs: 50_000 } }, async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
      const idle = await start()
      const alive = await start()
      jest.advanceTimersByTime(45_000)
      touch(alive, 'alice')
      jest.advanceTimersByTime(30_000) // sweeps at 30 s and 60 s
      await settle()
      expect(listSubscriptions('alice').map((s) => s.subscriptionId)).toEqual([alive])
      expect(statusOf(idle)).toEqual([
        expect.objectContaining({ data: expect.objectContaining({ status: 'STOPPED', message: expect.stringMatching(/idle timeout/) }) })
      ])
    }))

  it('answers user errors with 4xx: unknown or inactive broker, failed connect', async () => {
    const status = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { status?: number; message: string }) => `${e.status}: ${e.message}`)
    expect(await status(start({ brokerId: cds.utils.uuid() }))).toMatch(/^404: Broker .* not found$/)
    const inactive = cds.utils.uuid()
    await INSERT.into('aem.suite.Brokers').entries({ ID: inactive, name: 'off', credentialMode: 'DIRECT', url: 'wss://off:443', msgVpn: 'v', username: 'u', active: false })
    expect(await status(start({ brokerId: inactive }))).toBe('400: Broker "off" is inactive')
    setSessionFactory(async () => {
      throw new Error('Connect failed: Unauthorized')
    })
    expect(await status(start())).toBe('400: Connect failed: Unauthorized')
    expect(sessions).toHaveLength(0)
  })
})
