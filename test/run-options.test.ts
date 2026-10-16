import { waitForRun } from '../srv/lib/test-runner'
import { createActive, fakeBroker, resetDatabase, startServer, users, withAemSuiteConfig } from './helpers'

const { GET, POST } = startServer()
const { admin, tester } = users

describe('advanced run settings (repetitions, delay, stop on failure, stop)', () => {
  const { published } = fakeBroker()
  let broker: { ID: string }
  let a: { ID: string }
  let b: { ID: string }
  let bad: { ID: string }

  const creds = () => [{ brokerId: broker.ID, password: 'pw' }]
  const run = async (testCaseIds: string[], options?: object, auth: object = tester) => {
    published.length = 0
    return POST('/odata/v4/test/runTests', { testCaseIds, brokerIds: [broker.ID], credentials: creds(), options }, auth)
  }
  const results = async (runId: string) =>
    (await GET(`/odata/v4/test/RunResults?$filter=run_ID eq ${runId}&$orderby=sequence&$select=testCaseName,status,iteration,sequence,errorMessage`, tester)).data.value as {
      testCaseName: string
      status: string
      iteration: number
      sequence: number
      errorMessage?: string
    }[]

  beforeAll(async () => {
    await resetDatabase()
    broker = await createActive(POST, 'admin', 'Brokers', { name: 'dev', credentialMode: 'DIRECT', url: 'dev.example', msgVpn: 'vpn', username: 'u' }, admin)
    const tc = (name: string, topic: string) => createActive(POST, 'test', 'TestCases', { name, topic, payload: '{}', deliveryMode: 'PERSISTENT' })
    a = await tc('A', 'run/a')
    b = await tc('B', 'run/b')
    bad = await tc('Bad', 'run/reject')
  })

  it('without settings a message is sent once per test case and broker', async () => {
    const res = await run([a.ID, b.ID])
    await waitForRun(res.data.runId)
    expect(published.map((p) => p.spec.topic)).toEqual(['run/a', 'run/b'])
    const { data } = await GET(`/odata/v4/test/TestRuns(${res.data.runId})`, tester)
    expect(data).toMatchObject({ totalCount: 2, passedCount: 2, skippedCount: 0, repetitions: 1, delayMs: 0, stopOnFailure: false })
  })

  it('repeats the whole selection (ROUND, default) or every test case in a row (EACH)', async () => {
    let res = await run([a.ID, b.ID], { repetitions: 3 })
    await waitForRun(res.data.runId)
    expect(published.map((p) => p.spec.topic)).toEqual(['run/a', 'run/b', 'run/a', 'run/b', 'run/a', 'run/b'])
    const rows = await results(res.data.runId)
    expect(rows.map((r) => `${r.sequence}:${r.testCaseName}#${r.iteration}`)).toEqual(['1:A#1', '2:B#1', '3:A#2', '4:B#2', '5:A#3', '6:B#3'])
    const { data } = await GET(`/odata/v4/test/TestRuns(${res.data.runId})`, tester)
    expect(data).toMatchObject({ totalCount: 6, passedCount: 6, repetitions: 3 })
    expect(data.summary).toContain('× 3')

    res = await run([a.ID, b.ID], { repetitions: 2, order: 'each' })
    await waitForRun(res.data.runId)
    expect(published.map((p) => p.spec.topic)).toEqual(['run/a', 'run/a', 'run/b', 'run/b'])
    expect((await results(res.data.runId)).map((r) => `${r.testCaseName}#${r.iteration}`)).toEqual(['A#1', 'A#2', 'B#1', 'B#2'])
  })

  it('pauses between two messages, but not before the first', async () => {
    const started = Date.now()
    const res = await run([a.ID], { repetitions: 3, delayMs: 150 })
    await waitForRun(res.data.runId)
    const took = Date.now() - started
    expect(published).toHaveLength(3)
    expect(took).toBeGreaterThanOrEqual(290) // two pauses
    expect(took).toBeLessThan(2500)
  })

  it('stops after the first failure when asked: the rest of the broker is skipped', async () => {
    const res = await run([a.ID, bad.ID, b.ID], { stopOnFailure: true })
    await waitForRun(res.data.runId)
    const rows = await results(res.data.runId)
    expect(rows.map((r) => `${r.testCaseName}:${r.status}`)).toEqual(['A:PASSED', 'Bad:FAILED', 'B:SKIPPED'])
    expect(rows[2].errorMessage).toMatch(/stop on first failure/)
    // the failed message was offered to the broker, the skipped one never
    expect(published.map((p) => p.spec.topic)).toEqual(['run/a', 'run/reject'])
    const { data } = await GET(`/odata/v4/test/TestRuns(${res.data.runId})`, tester)
    expect(data).toMatchObject({ status: 'DONE', totalCount: 3, passedCount: 1, failedCount: 1, skippedCount: 1, outcome: 'FAILED', stopOnFailure: true })
    // a skipped test case does not change its last result
    const stats = (await GET('/odata/v4/test/TestCaseStats', tester)).data.value as { testCase_ID: string; run_ID: string }[]
    expect(stats.find((s) => s.testCase_ID === b.ID)?.run_ID).not.toBe(res.data.runId)
  })

  it('without the setting a failure does not stop the run', async () => {
    const res = await run([bad.ID, b.ID])
    await waitForRun(res.data.runId)
    expect((await results(res.data.runId)).map((r) => `${r.testCaseName}:${r.status}`)).toEqual(['Bad:FAILED', 'B:PASSED'])
  })

  it('can be stopped: what was not sent yet is skipped', async () => {
    // started by the administrator: another tester may not stop it
    const res = await run([a.ID], { repetitions: 20, delayMs: 300 }, admin)
    const runId = res.data.runId
    // wait for the first message, then stop
    while (!published.length) await new Promise((r) => setTimeout(r, 20))
    expect((await POST('/odata/v4/test/cancelRun', { runId }, tester)).status).toBe(403)
    expect((await POST('/odata/v4/test/cancelRun', { runId }, users.noRole)).status).toBe(403)
    expect((await POST('/odata/v4/test/cancelRun', { runId }, admin)).status).toBeLessThan(300)
    await waitForRun(runId)
    const rows = await results(runId)
    const sent = rows.filter((r) => r.status === 'PASSED').length
    expect(sent).toBeGreaterThanOrEqual(1)
    expect(sent).toBeLessThan(20)
    expect(rows.filter((r) => r.status === 'SKIPPED')).toHaveLength(20 - sent)
    expect(rows.find((r) => r.status === 'SKIPPED')?.errorMessage).toMatch(/stopped/)
    const { data } = await GET(`/odata/v4/test/TestRuns(${runId})`, tester)
    expect(data).toMatchObject({ status: 'DONE', passedCount: sent, skippedCount: 20 - sent, failedCount: 0, outcome: 'PASSED' })
    // a finished run cannot be stopped again
    expect((await POST('/odata/v4/test/cancelRun', { runId }, admin)).status).toBe(409)
    expect((await POST('/odata/v4/test/cancelRun', { runId: '00000000-0000-4000-8000-000000000000' }, admin)).status).toBe(404)
  })

  it('checks the settings against the limits', async () => {
    for (const options of [{ repetitions: 0 }, { repetitions: 1001 }, { repetitions: 1.5 }, { delayMs: -1 }, { delayMs: 60001 }, { order: 'SOMETIMES' }]) {
      const res = await run([a.ID], options)
      expect(res.status).toBe(400)
    }
    const tooMany = await withAemSuiteConfig({ runs: { maxResults: 5 } }, () => run([a.ID, b.ID], { repetitions: 3 }))
    expect(tooMany.status).toBe(400)
    expect(tooMany.data.error.message).toMatch(/at most 5 messages .* 6/)
    const limits = await withAemSuiteConfig({ runs: { maxRepetitions: 2 } }, () => run([a.ID], { repetitions: 3 }))
    expect(limits.status).toBe(400)
  })

  it('numbers from number ranges are taken for every repetition', async () => {
    await DELETE.from('aem.suite.NumberRanges')
    await createActive(POST, 'admin', 'NumberRanges', { name: 'REP', prefix: 'R-', length: 3, start: 1 }, admin)
    const counted = await createActive(POST, 'test', 'TestCases', { name: 'numbered', topic: 'run/{{numberRange.REP}}', payload: '{}', deliveryMode: 'PERSISTENT' })
    const res = await run([counted.ID], { repetitions: 3 })
    await waitForRun(res.data.runId)
    expect(published.map((p) => p.spec.topic)).toEqual(['run/R-001', 'run/R-002', 'run/R-003'])
  })
})
