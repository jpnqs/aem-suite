import cds from '@sap/cds'
import { checkConnection } from '../srv/lib/broker-check'
import type { BrokerConnection } from '../srv/lib/credentials/resolve'
import { setConnector } from '../srv/lib/solace/connector'
import { resetDatabase, startServer } from './helpers'

startServer()

describe('checkConnection', () => {
  const ID = cds.utils.uuid()
  let opened: BrokerConnection[]
  let failWith: string | undefined

  beforeAll(async () => {
    await resetDatabase()
    await INSERT.into('aem.suite.Brokers').entries({ ID, name: 'dev', credentialMode: 'DIRECT', url: 'wss://dev:443', msgVpn: 'v', username: 'u' })
    setConnector(async (conn) => {
      opened.push(conn)
      if (failWith) throw new Error(failWith)
      return { publish: async () => ({ latencyMs: 1 }), close: async () => undefined }
    })
  })
  beforeEach(() => {
    opened = []
    failWith = undefined
  })
  afterAll(() => setConnector())

  const stored = () => SELECT.one.from('aem.suite.Brokers', ID).columns('lastConnectionStatus', 'lastConnectionMessage')

  it('connects with the entered password, caps the timeout and stores the outcome', async () => {
    const check = await checkConnection(ID, { password: 'pw', maxTimeoutMs: 3000 })
    expect(check).toMatchObject({ ok: true, message: 'Connected to wss://dev:443 (VPN v) as u', lastConnectionStatus: 'OK' })
    expect(opened).toEqual([expect.objectContaining({ password: 'pw', connectTimeoutMs: 3000 })])
    expect(await stored()).toEqual({ lastConnectionStatus: 'OK', lastConnectionMessage: check.message })
  })

  it('stores a failure with a shortened message', async () => {
    failWith = 'x'.repeat(1500)
    const check = await checkConnection(ID, { password: 'pw' })
    expect(check.ok).toBe(false)
    const row = await stored()
    expect(row.lastConnectionStatus).toBe('ERROR')
    expect(row.lastConnectionMessage.length).toBeLessThanOrEqual(1000)
  })

  it('does not connect without a password', async () => {
    const check = await checkConnection(ID)
    expect(check).toMatchObject({ ok: false, message: 'Password required for broker "dev"' })
    expect(opened).toEqual([])
  })
})
