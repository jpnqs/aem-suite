import cds from '@sap/cds'
import * as testCaseSpec from '../srv/lib/test-case-spec'
import { runOutcome } from '../srv/lib/test-runner'
import { createActive, fakeBroker, resetDatabase, runAndWait, startServer, users } from './helpers'

const { GET, POST } = startServer()
const { admin, tester } = users

describe('test runner', () => {
  const { published } = fakeBroker()
  let broker: { ID: string }
  /** fails every database write of a result whose topic contains "dbfail" (HANA rejecting a row, a lost connection) */
  let failWrites = false

  const run = async (testCaseIds: string[]) => {
    published.length = 0
    const res = await runAndWait(POST, { testCaseIds, brokerIds: [broker.ID] })
    expect(res.status).toBe(200)
    return res.data.runId as string
  }
  const tc = (name: string, topic: string) => createActive(POST, 'test', 'TestCases', { name, topic, payload: '{}', deliveryMode: 'PERSISTENT' })
  const resultsOf = async (runId: string) =>
    (await GET(`/odata/v4/test/RunResults?$filter=run_ID eq ${runId}&$orderby=sequence`, tester)).data.value as Record<string, unknown>[]
  const runOf = async (runId: string) => (await GET(`/odata/v4/test/TestRuns(${runId})`, tester)).data

  beforeAll(async () => {
    await resetDatabase()
    broker = await createActive(POST, 'admin', 'Brokers', { name: 'dev', credentialMode: 'DIRECT', url: 'dev.example', msgVpn: 'vpn', username: 'u' }, admin)
    cds.db.before('UPDATE', 'aem.suite.RunResults', (req) => {
      if (failWrites && JSON.stringify(req.query).includes('dbfail')) throw new Error('database write failed')
    })
  })
  afterEach(() => {
    failWrites = false
  })

  it('a failed database write ends the run FAILED instead of DONE with PENDING results', async () => {
    const ok = await tc('ok', 'run/ok')
    const broken = await tc('broken', 'run/dbfail')
    const after = await tc('after', 'run/after')
    failWrites = true
    const runId = await run([ok.ID, broken.ID, after.ID])
    expect(await runOf(runId)).toMatchObject({ status: 'FAILED', outcome: 'FAILED', passedCount: 1 })
    const rows = await resultsOf(runId)
    expect(rows.map((r) => r.status)).toEqual(['PASSED', 'ERROR', 'ERROR'])
    expect(rows[1].errorMessage).toMatch(/Run aborted: database write failed/)
  })

  it('cuts topic and correlation id to their columns when variables make them longer', async () => {
    const long = 'x'.repeat(400)
    const tc = await createActive(POST, 'test', 'TestCases', {
      name: 'long',
      topic: 'run/{{long}}/{{long}}',
      correlationId: '{{long}}',
      payload: '{}',
      deliveryMode: 'PERSISTENT',
      variables: [{ name: 'long', value: long }]
    })
    const runId = await run([tc.ID])
    // the broker gets the full topic, the result keeps what fits into the column
    expect(published[0].spec.topic).toHaveLength(4 + 400 + 1 + 400)
    const [row] = await resultsOf(runId)
    expect(row.status).toBe('PASSED')
    expect(row.resolvedTopic).toHaveLength(500)
    expect(row.correlationId).toHaveLength(200)
    expect(String(row.resolvedTopic).endsWith('...')).toBe(true)
  })

  it('a message that cannot be resolved is an ERROR and is not sent', async () => {
    const unknown = await tc('unknown', 'run/{{nope}}')
    const runId = await run([unknown.ID])
    expect(published).toEqual([])
    const [row] = await resultsOf(runId)
    expect(row).toMatchObject({ status: 'ERROR', errorMessage: 'Unknown variable(s): nope' })
    expect(await runOf(runId)).toMatchObject({ status: 'DONE', outcome: 'FAILED', failedCount: 1 })
  })

  it('a test case deleted before the run executes ends as ERROR', async () => {
    const gone = await tc('gone', 'run/gone')
    // the run was created, but the test case is gone when the run loads it
    const load = jest.spyOn(testCaseSpec, 'loadTestCases').mockResolvedValueOnce([])
    try {
      const runId = await run([gone.ID])
      expect((await resultsOf(runId))[0]).toMatchObject({ status: 'ERROR', errorMessage: 'Test case was deleted' })
    } finally {
      load.mockRestore()
    }
  })

  it('reports the progress to the run dialog - throttled - and always the end', async () => {
    const live = await cds.connect.to('LiveService')
    const emit = jest.spyOn(live, 'emit')
    try {
      const a = await tc('progress a', 'run/p/a')
      const b = await tc('progress b', 'run/p/b')
      const runId = await run([a.ID, b.ID])
      // emit(event, data) - the typings only know emit({ event, data })
      const calls = emit.mock.calls as unknown as [string, { runId: string }][]
      const events = calls.filter(([event, data]) => event === 'runProgress' && data.runId === runId).map(([, data]) => data)
      // the first message right away, the second within 250 ms of it: no event of its own, the end follows
      expect(events).toEqual([
        expect.objectContaining({ status: 'RUNNING', total: 2, done: 1, passed: 1, failed: 0, skipped: 0, resultId: expect.any(String) }),
        expect.objectContaining({ status: 'DONE', total: 2, done: 2, passed: 2, failed: 0 })
      ])
    } finally {
      emit.mockRestore()
    }
  })

  it('the outcome in TestService.TestRuns (CDS) is the same as runOutcome() for every status', async () => {
    const cases = (['RUNNING', 'DONE', 'FAILED', 'STOPPED'] as const).flatMap((status) => [0, 2].map((failedCount) => ({ ID: cds.utils.uuid(), status, failedCount, summary: 'outcome', totalCount: 2 })))
    await INSERT.into('aem.suite.TestRuns').entries(cases)
    try {
      for (const c of cases) {
        const { data } = await GET(`/odata/v4/test/TestRuns(${c.ID})?$select=outcome,statusCriticality`, tester)
        // the criticality follows the outcome: PASSED 3, FAILED 1, RUNNING and STOPPED 2
        const criticality = { PASSED: 3, FAILED: 1, RUNNING: 2, STOPPED: 2 }[runOutcome(c)]
        expect({ ...c, outcome: data.outcome, criticality: data.statusCriticality }).toEqual({ ...c, outcome: runOutcome(c), criticality })
      }
    } finally {
      await DELETE.from('aem.suite.TestRuns').where({ summary: 'outcome' })
    }
  })
})
