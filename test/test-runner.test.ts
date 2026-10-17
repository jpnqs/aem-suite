import cds from '@sap/cds'
import { waitForRun } from '../srv/lib/test-runner'
import { createActive, fakeBroker, resetDatabase, startServer, users } from './helpers'

const { GET, POST } = startServer()
const { admin, tester } = users

describe('test runner', () => {
  const { published } = fakeBroker()
  let broker: { ID: string }
  /** fails every database write of a result whose topic contains "dbfail" (HANA rejecting a row, a lost connection) */
  let failWrites = false

  const run = async (testCaseIds: string[]) => {
    published.length = 0
    const res = await POST('/odata/v4/test/runTests', { testCaseIds, brokerIds: [broker.ID], credentials: [{ brokerId: broker.ID, password: 'pw' }] }, tester)
    expect(res.status).toBe(200)
    await waitForRun(res.data.runId)
    return res.data.runId as string
  }
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
    const tc = (name: string, topic: string) => createActive(POST, 'test', 'TestCases', { name, topic, payload: '{}', deliveryMode: 'PERSISTENT' })
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
})
