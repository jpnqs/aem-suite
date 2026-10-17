import { waitForRun } from '../srv/lib/test-runner'
import { createActive, fakeBroker, resetDatabase, startServer, users, waitFor, withAemSuiteConfig } from './helpers'

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
    (await GET(`/odata/v4/test/RunResults?$filter=run_ID eq ${runId}&$orderby=sequence&$select=testCaseName,status,iteration,sequence,errorMessage,executedAt`, tester)).data.value as {
      testCaseName: string
      status: string
      iteration: number
      sequence: number
      errorMessage?: string
      executedAt: string
    }[]
  const lastResultOf = async (testCaseId: string) =>
    ((await GET('/odata/v4/test/TestCaseStats', tester)).data.value as { testCase_ID: string; run_ID: string }[]).find((s) => s.testCase_ID === testCaseId)

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
    // the number of messages, so the Run dialog can show the progress right away
    expect(res.data.total).toBe(6)
    await waitForRun(res.data.runId)
    expect(published.map((p) => p.spec.topic)).toEqual(['run/a', 'run/b', 'run/a', 'run/b', 'run/a', 'run/b'])
    const rows = await results(res.data.runId)
    expect(rows.map((r) => `${r.sequence}:${r.testCaseName}#${r.iteration}`)).toEqual(['1:A#1', '2:B#1', '3:A#2', '4:B#2', '5:A#3', '6:B#3'])
    const { data } = await GET(`/odata/v4/test/TestRuns(${res.data.runId})`, tester)
    expect(data).toMatchObject({ totalCount: 6, passedCount: 6, repetitions: 3, repetitionOrder: 'ROUND' })
    expect(data.summary).toContain('× 3')

    res = await run([a.ID, b.ID], { repetitions: 2, order: 'each' })
    await waitForRun(res.data.runId)
    expect(published.map((p) => p.spec.topic)).toEqual(['run/a', 'run/a', 'run/b', 'run/b'])
    expect((await results(res.data.runId)).map((r) => `${r.testCaseName}#${r.iteration}`)).toEqual(['A#1', 'A#2', 'B#1', 'B#2'])
    // the order is stored with the run, so it can be understood afterwards
    expect((await GET(`/odata/v4/test/TestRuns(${res.data.runId})`, tester)).data.repetitionOrder).toBe('EACH')
  })

  it('pauses between two messages, but not before the first', async () => {
    const res = await run([a.ID], { repetitions: 3, delayMs: 150 })
    await waitForRun(res.data.runId)
    expect(published).toHaveLength(3)
    // a message is stored right after it was sent, the next one is sent after the pause
    const sentAt = (await results(res.data.runId)).map((r) => Date.parse(r.executedAt))
    expect(sentAt[1] - sentAt[0]).toBeGreaterThanOrEqual(150)
    expect(sentAt[2] - sentAt[1]).toBeGreaterThanOrEqual(150)
  })

  it('stops after the first failure when asked: the rest of the broker is skipped', async () => {
    const before = await lastResultOf(b.ID)
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
    expect(await lastResultOf(b.ID)).toEqual(before)
    expect((await lastResultOf(a.ID))?.run_ID).toBe(res.data.runId)
  })

  it('without the setting a failure does not stop the run', async () => {
    const res = await run([bad.ID, b.ID])
    await waitForRun(res.data.runId)
    expect((await results(res.data.runId)).map((r) => `${r.testCaseName}:${r.status}`)).toEqual(['Bad:FAILED', 'B:PASSED'])
  })

  // 100 messages with 300 ms between them: the run takes 30 s, so the stop always comes before its end
  const REPETITIONS = 100

  it('can be stopped: what was not sent yet is skipped (administrators stop any run)', async () => {
    // started by the administrator: another tester may not stop it
    const res = await run([a.ID], { repetitions: REPETITIONS, delayMs: 300 }, admin)
    const runId = res.data.runId
    // wait for the first message, then stop
    await waitFor(() => published.length > 0, 5000, 'the first message')
    const refused = await POST('/odata/v4/test/cancelRun', { runId }, tester)
    expect(refused.status).toBe(403)
    expect(refused.data.error.message).toMatch(/Only the user who started the run/)
    expect((await POST('/odata/v4/test/cancelRun', { runId }, users.noRole)).status).toBe(403)
    expect((await POST('/odata/v4/test/cancelRun', { runId }, admin)).status).toBeLessThan(300)
    await waitForRun(runId)
    const rows = await results(runId)
    const sent = rows.filter((r) => r.status === 'PASSED').length
    expect(sent).toBeGreaterThanOrEqual(1)
    expect(sent).toBeLessThan(REPETITIONS)
    expect(rows.filter((r) => r.status === 'SKIPPED')).toHaveLength(REPETITIONS - sent)
    expect(rows.find((r) => r.status === 'SKIPPED')?.errorMessage).toMatch(/stopped/)
    const { data } = await GET(`/odata/v4/test/TestRuns(${runId})`, tester)
    // stopped by its user: its own status and outcome (warning), not DONE / PASSED
    expect(data).toMatchObject({ status: 'STOPPED', passedCount: sent, skippedCount: REPETITIONS - sent, failedCount: 0, outcome: 'STOPPED', statusCriticality: 2 })
    // a finished run cannot be stopped again
    const again = await POST('/odata/v4/test/cancelRun', { runId }, admin)
    expect(again.status).toBe(409)
    expect(again.data.error.message).toMatch(/not running/)
    const unknown = await POST('/odata/v4/test/cancelRun', { runId: '00000000-0000-4000-8000-000000000000' }, admin)
    expect(unknown.status).toBe(404)
    expect(unknown.data.error.message).toBe('Run not found')
  })

  it('a tester stops their own run', async () => {
    const res = await run([a.ID], { repetitions: REPETITIONS, delayMs: 300 }, tester)
    await waitFor(() => published.length > 0, 5000, 'the first message')
    expect((await POST('/odata/v4/test/cancelRun', { runId: res.data.runId }, tester)).status).toBeLessThan(300)
    await waitForRun(res.data.runId)
    const { data } = await GET(`/odata/v4/test/TestRuns(${res.data.runId})`, tester)
    expect(data.skippedCount).toBeGreaterThan(0)
  })

  it('checks the settings against the limits', async () => {
    const refused: [object, RegExp][] = [
      [{ repetitions: 0 }, /Repetitions must be a whole number from 1 to 1000/],
      [{ repetitions: 1001 }, /Repetitions must be/],
      [{ repetitions: 1.5 }, /Repetitions must be/],
      [{ delayMs: -1 }, /delay between messages must be from 0 to 60000 ms/],
      [{ delayMs: 60001 }, /delay between messages/],
      [{ order: 'SOMETIMES' }, /order must be ROUND .* or EACH/]
    ]
    for (const [options, message] of refused) {
      const res = await run([a.ID], options)
      expect({ options, status: res.status, message: res.data.error?.message }).toEqual({ options, status: 400, message: expect.stringMatching(message) })
    }
    const tooMany = await withAemSuiteConfig({ runs: { maxResults: 5 } }, () => run([a.ID, b.ID], { repetitions: 3 }))
    expect(tooMany.status).toBe(400)
    expect(tooMany.data.error.message).toMatch(/at most 5 messages .* 6/)
    const limits = await withAemSuiteConfig({ runs: { maxRepetitions: 2 } }, () => run([a.ID], { repetitions: 3 }))
    expect(limits.status).toBe(400)
    expect(limits.data.error.message).toMatch(/from 1 to 2$/)
  })

  it('numbers from number ranges are taken for every repetition', async () => {
    await createActive(POST, 'admin', 'NumberRanges', { name: 'REP', prefix: 'R-', length: 3, start: 1 }, admin)
    const counted = await createActive(POST, 'test', 'TestCases', { name: 'numbered', topic: 'run/{{numberRange.REP}}', payload: '{}', deliveryMode: 'PERSISTENT' })
    const res = await run([counted.ID], { repetitions: 3 })
    await waitForRun(res.data.runId)
    expect(published.map((p) => p.spec.topic)).toEqual(['run/R-001', 'run/R-002', 'run/R-003'])
  })
})
