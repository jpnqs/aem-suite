import type solaceTypes from 'solclientjs'
import { buildMessage, readMessage, SolaceSession, sol } from '../srv/lib/solace/session'
import { FakeSolclientSession as FakeSession } from './fakes/solace'

const cfg = { url: 'wss://fake', vpnName: 'v', userName: 'u', password: 'p', connectTimeoutMs: 1000 }
const spec = { topic: 'a/b', payload: '{"x":1}', deliveryMode: 'PERSISTENT' as const, ackTimeoutMs: 200 }

function useFake(fake: FakeSession) {
  return jest.spyOn(sol().SolclientFactory, 'createSession').mockReturnValue(fake as unknown as solaceTypes.Session)
}

afterEach(() => jest.restoreAllMocks())

describe('SolaceSession', () => {
  it('connects and resolves PERSISTENT publish on ACK', async () => {
    const fake = new FakeSession(true, 'ack')
    useFake(fake)
    const s = await SolaceSession.connect(cfg)
    const res = await s.publish(spec)
    expect(res.latencyMs).toBeGreaterThanOrEqual(0)
    expect(fake.sent).toHaveLength(1)
    await s.close()
    expect(s.isClosed).toBe(true)
  })

  it('rejects on connect failure', async () => {
    useFake(new FakeSession(false))
    await expect(SolaceSession.connect(cfg)).rejects.toThrow(/Connect failed: Unauthorized/)
  })

  it('rejects when the broker rejects the message', async () => {
    useFake(new FakeSession(true, 'reject'))
    const s = await SolaceSession.connect(cfg)
    await expect(s.publish(spec)).rejects.toThrow(/Rejected by broker: Queue full/)
  })

  it('rejects when no ACK arrives in time', async () => {
    useFake(new FakeSession(true, 'silent'))
    const s = await SolaceSession.connect(cfg)
    await expect(s.publish(spec)).rejects.toThrow(/No broker acknowledgement within 200 ms/)
  })

  it('resolves DIRECT publish without waiting for an ACK', async () => {
    useFake(new FakeSession(true, 'silent'))
    const s = await SolaceSession.connect(cfg)
    await expect(s.publish({ ...spec, deliveryMode: 'DIRECT' })).resolves.toBeDefined()
  })

  it('fails pending publishes when the broker drops the session', async () => {
    const fake = new FakeSession(true, 'silent')
    useFake(fake)
    const s = await SolaceSession.connect(cfg)
    const dropped = jest.fn()
    s.onUnexpectedClose(dropped)
    const p = s.publish({ ...spec, ackTimeoutMs: 5000 })
    fake.fire(sol().SessionEventCode.DISCONNECTED, {})
    await expect(p).rejects.toThrow(/disconnected/)
    expect(dropped).toHaveBeenCalledTimes(1)
  })
})

describe('buildMessage / readMessage', () => {
  it('maps all publish options and round-trips via readMessage', () => {
    const s = sol()
    const m = buildMessage({
      topic: 'acme/orders/created',
      payload: '{"ä":1}',
      contentType: 'application/json',
      deliveryMode: 'PERSISTENT',
      timeToLiveMs: 1000,
      dmqEligible: true,
      priority: 7,
      correlationId: 'c-1',
      userProperties: [
        { name: 'source', type: 'STRING', value: 'test' },
        { name: 'count', type: 'INT', value: '42' },
        { name: 'flag', type: 'BOOL', value: 'TRUE' },
        { name: 'flag1', type: 'BOOL', value: '1' },
        { name: 'flag0', type: 'BOOL', value: '0' }
      ]
    })
    expect(m.getDeliveryMode()).toBe(s.MessageDeliveryModeType.PERSISTENT)
    const r = readMessage(m)
    expect(r.topic).toBe('acme/orders/created')
    expect(r.payload).toBe('{"ä":1}')
    expect(r.contentType).toBe('application/json')
    expect(r.correlationId).toBe('c-1')
    expect(r.deliveryMode).toBe('PERSISTENT')
    expect(r.userProperties).toEqual({ source: 'test', count: 42, flag: true, flag1: true, flag0: false })
  })

  it('rejects non-integer INT properties', () => {
    expect(() =>
      buildMessage({ topic: 't', payload: '', deliveryMode: 'DIRECT', userProperties: [{ name: 'n', type: 'INT', value: 'x' }] })
    ).toThrow(/not an integer/)
  })
})
