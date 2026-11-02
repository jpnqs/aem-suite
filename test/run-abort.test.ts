import { waitForRun } from '../srv/lib/runs/test-runner'
import { setConnector } from '../srv/lib/solace/connector'
import type { Publisher } from '../srv/lib/solace/session'
import { createActive, resetDatabase, startServer, users, waitFor } from './helpers'

const { GET, POST } = startServer()
const { admin, tester } = users

// What a run does when the broker does not answer, and when it is stopped while it waits for the broker.

describe('runs and an unresponsive broker', () => {
  let broker: { ID: string }
  let testCases: { ID: string }[]

  const start = (ids = testCases.map((t) => t.ID)) =>
    POST('/odata/v4/test/runTests', { testCaseIds: ids, brokerIds: [broker.ID], credentials: [{ brokerId: broker.ID, password: 'pw' }] }, tester)
  const results = async (runId: string) =>
    (await GET(`/odata/v4/test/RunResults?$filter=run_ID eq ${runId}&$orderby=sequence&$select=status,errorMessage`, tester)).data.value as { status: string; errorMessage?: string }[]
  const brokerState = async () => (await GET(`/odata/v4/admin/Brokers(ID=${broker.ID},IsActiveEntity=true)?$select=lastConnectionStatus,lastConnectionMessage`, admin)).data

  beforeAll(async () => {
    await resetDatabase()
    broker = await createActive(POST, 'admin', 'Brokers', { name: 'dev', credentialMode: 'DIRECT', url: 'dev.example', msgVpn: 'vpn', username: 'u' }, admin)
    testCases = []
    for (const n of [1, 2, 3]) testCases.push(await createActive(POST, 'test', 'TestCases', { name: `abort ${n}`, topic: `abort/${n}`, payload: '{}' }))
  })
  afterEach(() => setConnector())

  it('stores a connect error once - the other results point to it - and the broker list shows it', async () => {
    setConnector(async () => {
      throw new Error('Connect failed: Unauthorized')
    })
    const { data } = await start()
    await waitForRun(data.runId)
    const rows = await results(data.runId)
    expect(rows.map((r) => r.status)).toEqual(['ERROR', 'ERROR', 'ERROR'])
    expect(rows[0].errorMessage).toBe('Connect failed: Unauthorized')
    expect(rows[1].errorMessage).toMatch(/^Not sent - the connection to this broker failed \(see the first result/)
    expect(await brokerState()).toMatchObject({ lastConnectionStatus: 'ERROR', lastConnectionMessage: 'Connect failed: Unauthorized' })
  })

  it('a run that connects updates the connection status of the broker too', async () => {
    setConnector(async () => ({ publish: async () => ({ latencyMs: 1 }), close: async () => undefined }))
    await waitForRun((await start()).data.runId)
    expect(await brokerState()).toMatchObject({ lastConnectionStatus: 'OK' })
  })

  it('stopping a run ends the wait for a connection at once and closes the connection made later', async () => {
    let closed = false
    let connectNow: (p: Publisher) => void = () => undefined
    setConnector(
      () =>
        new Promise<Publisher>((resolve) => {
          connectNow = resolve
        })
    )
    const { data } = await start()
    const stopped = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect((await POST('/odata/v4/test/cancelRun', { runId: data.runId }, tester)).status).toBeLessThan(300)
    await waitForRun(data.runId)
    expect(Date.now() - stopped).toBeLessThan(3000)
    const rows = await results(data.runId)
    expect(rows.map((r) => r.status)).toEqual(['SKIPPED', 'SKIPPED', 'SKIPPED'])
    expect((await GET(`/odata/v4/test/TestRuns(${data.runId})`, tester)).data).toMatchObject({ status: 'STOPPED', skippedCount: 3 })
    // the connection that comes after all is not kept
    connectNow({ publish: async () => ({ latencyMs: 1 }), close: async () => void (closed = true) })
    await waitFor(() => closed, 2000, 'the late connection to be closed')
  })

  it('stopping a run ends the wait for an acknowledgement: the closed connection rejects what is pending', async () => {
    let reject: (e: Error) => void = () => undefined
    let sent = 0
    setConnector(async () => ({
      publish: () =>
        new Promise((_, rej) => {
          sent++
          reject = rej
        }),
      // closing the connection rejects the pending message, as the Solace session does
      close: async () => reject(new Error('The connection to the broker is closed (it was lost, or the run was stopped)'))
    }))
    const { data } = await start()
    await waitFor(() => sent === 1, 5000, 'the first message')
    expect((await POST('/odata/v4/test/cancelRun', { runId: data.runId }, tester)).status).toBeLessThan(300)
    await waitForRun(data.runId)
    const rows = await results(data.runId)
    expect(rows.map((r) => r.status)).toEqual(['FAILED', 'SKIPPED', 'SKIPPED'])
    expect(rows[0].errorMessage).toMatch(/^Stopped while waiting for the acknowledgement - the message may have been delivered/)
  })
})
