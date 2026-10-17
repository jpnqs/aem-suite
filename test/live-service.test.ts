import cds from '@sap/cds'
import WebSocket from 'ws'
import { emitLive } from '../srv/lib/live'
import * as hub from '../srv/lib/solace/subscription-hub'
import { FakeSubscriberSession } from './fakes/solace'
import { resetDatabase, startServer } from './helpers'

// The websocket service LiveService (/ws/live) and the server wiring of srv/server.ts.
// Locally the websocket plugin does not check the login (mocked auth) - what is checked here is that a client
// only gets the events of the context it entered, also when it connects relative to an app.

const server = startServer()
const BASIC = `Basic ${Buffer.from('tester:tester').toString('base64')}`

/** A websocket client that collects every event it receives. */
async function client(path = '/ws/live') {
  const ws = new WebSocket(String(server.axios.defaults.baseURL).replace(/^http/, 'ws') + path, { headers: { authorization: BASIC } })
  const events: { event: string; data: Record<string, unknown> }[] = []
  ws.on('message', (raw) => events.push(JSON.parse(String(raw))))
  await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject))
  const enter = async (context: string) => {
    ws.send(JSON.stringify({ event: 'wsContext', data: { context } }))
    // the plugin answers nothing; give it a moment to register the context
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return { ws, events, enter }
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((resolve) => setTimeout(resolve, 20))
}

describe('LiveService (websocket)', () => {
  const open: WebSocket[] = []
  afterAll(() => open.forEach((ws) => ws.close()))

  it('pushes an event only to the clients in its context', async () => {
    const a = await client()
    const b = await client()
    open.push(a.ws, b.ws)
    await a.enter('run-a')
    await b.enter('run-b')
    // outside of any request, like the runner and the broker callbacks
    await emitLive('runProgress', { runId: 'run-a', status: 'RUNNING', total: 1, done: 1, passed: 1, failed: 0, skipped: 0 })
    await until(() => a.events.length > 0)
    expect(a.events).toEqual([expect.objectContaining({ event: 'runProgress', data: expect.objectContaining({ runId: 'run-a', done: 1 }) })])
    expect(b.events).toEqual([])
  })

  it('accepts the app-relative path the apps use (/comaemsuite<app>/ws/live, dev server)', async () => {
    const c = await client('/comaemsuitesubscriber/ws/live')
    open.push(c.ws)
    await c.enter('sub-1')
    await emitLive('subscriptionStatus', { subscriptionId: 'sub-1', status: 'STOPPED', message: 'x' })
    await until(() => c.events.length > 0)
    expect(c.events).toEqual([expect.objectContaining({ event: 'subscriptionStatus', data: expect.objectContaining({ status: 'STOPPED' }) })])
  })
})

describe('server.ts wiring', () => {
  beforeAll(resetDatabase)

  /** our listener of a cds server event (CAP registers its own ones, which must not run here) */
  const ours = (event: string, uses: string) => {
    // cds is an EventEmitter at runtime; its typings only declare on/once
    const found = (cds as unknown as NodeJS.EventEmitter).listeners(event).filter((l) => String(l).includes(uses))
    expect(found).toHaveLength(1)
    return found[0] as () => Promise<void>
  }

  it('on "served": ends runs that were left RUNNING by the last server process', async () => {
    const ID = cds.utils.uuid()
    await INSERT.into('aem.suite.TestRuns').entries({ ID, status: 'RUNNING', totalCount: 1 })
    await ours('served', 'failRuns')()
    expect(await SELECT.one.from('aem.suite.TestRuns', ID)).toMatchObject({ status: 'FAILED' })
  })

  it('on "shutdown": closes the live subscriptions (they hold broker sessions)', async () => {
    const brokerId = cds.utils.uuid()
    await INSERT.into('aem.suite.Brokers').entries({ ID: brokerId, name: 'b', credentialMode: 'DIRECT', url: 'wss://b:443', msgVpn: 'v', username: 'u' })
    const session = new FakeSubscriberSession()
    hub.setSessionFactory(async () => session)
    try {
      await hub.startSubscription({ brokerId, sourceType: 'TOPIC', topics: ['a/>'], owner: 'alice', password: 'pw' })
      expect(hub.listSubscriptions('alice')).toHaveLength(1)
      await ours('shutdown', 'stopAll')()
      expect(hub.listSubscriptions('alice')).toEqual([])
      expect(session.closed).toBe(true)
    } finally {
      hub.setSessionFactory()
    }
  })
})
