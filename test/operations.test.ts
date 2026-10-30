import { stopAllRuns, waitForRun } from '../srv/lib/runs/test-runner'
import { createActive, draft, fakeBroker, resetDatabase, startServer, users, waitFor, withAemSuiteConfig } from './helpers'

const { GET, POST } = startServer()
const { admin, tester } = users

// running the suite: graceful stop, limits of runs and payloads, health check, the System section of Home
describe('operations', () => {
  fakeBroker()
  let brokerId: string
  const ids: string[] = []
  const start = (options: object = {}) =>
    POST('/odata/v4/test/runTests', { testCaseIds: ids, brokerIds: [brokerId], credentials: [{ brokerId, password: 'pw' }], options }, tester)

  beforeAll(async () => {
    await resetDatabase()
    brokerId = (await createActive(POST, 'admin', 'Brokers', { name: 'dev', credentialMode: 'DIRECT', url: 'dev.example', msgVpn: 'vpn', username: 'u' }, admin)).ID
    for (const n of [1, 2, 3]) ids.push((await createActive(POST, 'test', 'TestCases', { name: `op ${n}`, topic: `op/${n}`, payload: '{}' })).ID)
  })

  it('a stopping server ends its runs STOPPED, the messages not sent yet SKIPPED with the reason', async () => {
    const res = await start({ delayMs: 2000 })
    expect(res.status).toBe(200)
    const runId = res.data.runId
    await waitFor(async () => (await GET(`/odata/v4/test/RunResults?$filter=run_ID eq ${runId} and status eq 'PASSED'`, tester)).data.value.length > 0)
    await stopAllRuns(5000)
    await waitForRun(runId)
    const { data: run } = await GET(`/odata/v4/test/TestRuns(${runId})`, tester)
    expect(run).toMatchObject({ status: 'STOPPED', passedCount: 1, skippedCount: 2 })
    const { data } = await GET(`/odata/v4/test/RunResults?$filter=run_ID eq ${runId} and status eq 'SKIPPED'`, tester)
    expect(data.value[0].errorMessage).toBe('Skipped: the server was stopped while the run was in progress')
  })

  it('limits the runs in progress per user and on the server', async () => {
    await withAemSuiteConfig({ runs: { maxActivePerUser: 0 } }, async () => {
      const res = await start()
      expect(res.status).toBe(429)
      expect(res.data.error.message).toMatch(/^You have 0 runs in progress \(limit 0\)/)
    })
    await withAemSuiteConfig({ runs: { maxActive: 0 } }, async () => {
      expect((await start()).data.error.message).toMatch(/^0 runs are in progress \(limit 0\)/)
    })
  })

  it('limits the size of a payload on save and when it is sent', async () => {
    await withAemSuiteConfig({ runs: { maxPayloadBytes: 20 } }, async () => {
      const saved = await draft.save(POST, 'test', 'TestCases', { topic: 'op/big', payload: JSON.stringify({ text: 'x'.repeat(30) }) })
      expect(saved.status).toBe(400)
      expect(JSON.stringify(saved.data)).toMatch(/The payload has 41 bytes - at most 20 are allowed/)

      // a variable can make the sent payload bigger than the template
      const tc = await createActive(POST, 'test', 'TestCases', { topic: 'op/var', payload: '{"t":"{{long}}"}', variables: [{ name: 'long', value: 'y'.repeat(30) }] })
      const res = await POST('/odata/v4/test/runTests', { testCaseIds: [tc.ID], brokerIds: [brokerId], credentials: [{ brokerId, password: 'pw' }] }, tester)
      await waitForRun(res.data.runId)
      const { data } = await GET(`/odata/v4/test/RunResults?$filter=run_ID eq ${res.data.runId}`, tester)
      expect(data.value[0]).toMatchObject({ status: 'ERROR', errorMessage: expect.stringMatching(/^The payload has 38 bytes - at most 20 are sent/) })
    })
  })

  it('answers the database health check without login', async () => {
    const res = await GET('/health/db')
    expect(res.status).toBe(200)
    expect(res.data).toEqual({ status: 'UP' })
  })

  it('shows administrators the state of the server on Home, testers not', async () => {
    const { data: forAdmin } = await GET('/odata/v4/home/overview()', admin)
    expect(forAdmin.system).toMatchObject({ version: expect.stringMatching(/^\d+\.\d+\.\d+/), runsInProgress: 0, liveSubscriptions: 0 })
    expect(forAdmin.system.runsStarted).toBeGreaterThanOrEqual(2)
    expect(forAdmin.system.messagesPassed).toBeGreaterThanOrEqual(1)
    expect(typeof forAdmin.flakyTestCases).toBe('number')
    const { data: forTester } = await GET('/odata/v4/home/overview()', tester)
    expect(forTester.system).toBeNull()
  })
})
