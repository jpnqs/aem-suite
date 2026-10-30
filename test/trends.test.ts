import { healthOf, nextHistory } from '../srv/lib/runs/trends'
import { createActive, fakeBroker, resetDatabase, runAndWait, startServer, users } from './helpers'

const { GET, POST } = startServer()
const { admin, tester } = users

describe('trends (lib/runs/trends.ts)', () => {
  it('keeps the last 20 outcomes, newest last', () => {
    expect(nextHistory(null, 'PASSED')).toBe('P')
    expect(nextHistory('PF', 'ERROR')).toBe('PFE')
    expect(nextHistory('P'.repeat(20), 'FAILED')).toBe('P'.repeat(19) + 'F')
  })

  it('flaky: passed and failed in the last 10 runs, changing at least twice', () => {
    expect(healthOf('')).toEqual({ passRate: null, flaky: false })
    expect(healthOf('PPPP')).toEqual({ passRate: 100, flaky: false })
    // one regression is no flakiness
    expect(healthOf('PPPPFFF')).toEqual({ passRate: 57, flaky: false })
    expect(healthOf('PFP')).toEqual({ passRate: 67, flaky: true })
    expect(healthOf('PEPPF')).toMatchObject({ flaky: true })
    // the changes are older than the last 10 runs
    expect(healthOf('PFPF' + 'P'.repeat(10))).toMatchObject({ flaky: false })
  })
})

describe('trends of runs', () => {
  fakeBroker()
  let brokerId: string
  let tc: { ID: string }
  const run = async (ids: string[]) => {
    const res = await runAndWait(POST, { testCaseIds: ids, brokerIds: [brokerId] })
    expect(res.status).toBe(200)
    return res.data.runId as string
  }
  const setTopic = (topic: string) => UPDATE('aem.suite.TestCases', tc.ID).with({ topic })

  beforeAll(async () => {
    await resetDatabase()
    brokerId = (await createActive(POST, 'admin', 'Brokers', { name: 'dev', credentialMode: 'DIRECT', url: 'dev.example', msgVpn: 'vpn', username: 'u' }, admin)).ID
    tc = await createActive(POST, 'test', 'TestCases', { name: 'trend', topic: 'trend/ok', payload: '{}' })
  })

  it('keeps the history, pass rate and flakiness of a test case', async () => {
    await run([tc.ID])
    await setTopic('trend/reject')
    await run([tc.ID])
    await setTopic('trend/ok')
    await run([tc.ID])
    const { data } = await GET(`/odata/v4/test/TestCases(ID=${tc.ID},IsActiveEntity=true)?$expand=lastResult`, tester)
    expect(data.lastResult).toMatchObject({ status: 'PASSED', history: 'PFP', passRate: 67, flaky: true, flakyCriticality: 2 })
  })

  it('adds up messages and latencies per broker and day', async () => {
    const { data } = await GET(`/odata/v4/admin/Brokers(ID=${brokerId},IsActiveEntity=true)/dailyStats`, admin)
    expect(data.value).toEqual([
      expect.objectContaining({ day: new Date().toISOString().slice(0, 10), brokerName: 'dev', messages: 3, passed: 2, ackCount: 2, passRate: 67, criticality: 2 })
    ])
  })

  it('compares two runs per test case and broker', async () => {
    const other = await createActive(POST, 'test', 'TestCases', { name: 'other', topic: 'trend/other', payload: '{}' })
    const base = await run([tc.ID])
    await setTopic('trend/reject')
    const now = await run([tc.ID, other.ID])
    const { data, status } = await GET(`/odata/v4/test/compareRuns(baseRunId=${base},otherRunId=${now})`, tester)
    expect(status).toBe(200)
    expect(data.value).toEqual([
      expect.objectContaining({ testCase: 'trend', broker: 'dev', baseStatus: 'PASSED', otherStatus: 'FAILED', change: 'BROKEN', baseAckLatencyMs: 1 }),
      expect.objectContaining({ testCase: 'other', baseStatus: null, otherStatus: 'PASSED', change: 'NEW' })
    ])
    const back = await GET(`/odata/v4/test/compareRuns(baseRunId=${now},otherRunId=${base})`, tester)
    expect(back.data.value.map((r: { change: string }) => r.change)).toEqual(['FIXED', 'GONE'])
    expect((await GET(`/odata/v4/test/compareRuns(baseRunId=${base},otherRunId=00000000-0000-4000-8000-000000000000)`, tester)).status).toBe(404)
  })
})
