import cds from '@sap/cds'
import { CHUNK_SIZE } from '../srv/lib/cleanup/cleanup'
import { resetDatabase, startServer, users } from './helpers'

const { GET, POST } = startServer()
const { admin, tester, noRole } = users
const CLEANUP = '/odata/v4/cleanup'

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
const uuid = () => cds.utils.uuid()
const E = (name: string) => `aem.suite.${name}`
const count = async (entity: string, where: object = {}) =>
  Number(((await SELECT.one.from(E(entity)).columns('count(1) as n').where(where)) as { n: number }).n)

const preview = (request: object, auth: object = admin) => POST(`${CLEANUP}/preview`, { request }, auth)
const execute = (request: object, expected: object[], auth: object = admin, ruleName?: string) => POST(`${CLEANUP}/execute`, { request, expected, ruleName }, auth)

/** previews and executes with the previewed counts; returns the counts per category */
async function cleanUp(request: object): Promise<Record<string, number>> {
  const p = await preview(request)
  expect(p.status).toBe(200)
  const expected = p.data.value.map((c: { category: string; count: number }) => ({ category: c.category, count: c.count }))
  const res = await execute(request, expected)
  expect(res.status).toBe(200)
  return Object.fromEntries(res.data.counts.map((c: { category: string; count: number }) => [c.category, c.count]))
}

const older = (days: number) => ({ age: { value: days, unit: 'DAYS' } })

describe('data cleanup', () => {
  const brokerA = uuid()
  const brokerB = uuid()
  const testCase = uuid()

  /** a finished run `age` days ago with one result per broker */
  async function run(age: number, data: object = {}, brokers = [brokerA]) {
    const ID = uuid()
    await INSERT.into(E('TestRuns')).entries({ ID, summary: `run ${age}`, status: 'DONE', startedAt: daysAgo(age), createdAt: daysAgo(age), createdBy: 'tester', failedCount: 0, ...data })
    for (const b of brokers)
      await INSERT.into(E('RunResults')).entries({ ID: uuid(), run_ID: ID, broker_ID: b, testCase_ID: testCase, status: 'PASSED', resolvedPayload: '{"a":1}', executedAt: daysAgo(age) })
    return ID
  }

  async function message(age: number, data: object = {}) {
    const ID = uuid()
    await INSERT.into(E('ReceivedMessages')).entries({ ID, broker_ID: brokerA, brokerName: 'A', topic: 'acme/orders', sourceType: 'TOPIC', receivedAt: daysAgo(age), createdBy: 'tester', ...data })
    return ID
  }

  beforeEach(async () => {
    await resetDatabase()
    await DELETE.from(E('CleanupLogs'))
    await DELETE.from(E('CleanupRules'))
    await INSERT.into(E('Brokers')).entries([
      { ID: brokerA, name: 'A', credentialMode: 'DIRECT', active: true },
      { ID: brokerB, name: 'B', credentialMode: 'DIRECT', active: false }
    ])
    await INSERT.into(E('TestCases')).entries({ ID: testCase, kind: 'TEST', name: 'tc', topic: 't' })
  })

  it('is for admins only', async () => {
    for (const auth of [tester, noRole]) {
      expect((await preview({ runs: older(1) }, auth)).status).toBe(403)
      expect((await execute({ runs: older(1) }, [], auth)).status).toBe(403)
      expect((await GET(`${CLEANUP}/CleanupLogs`, auth)).status).toBe(403)
    }
  })

  it('previews counts, cutoff and the newest samples without deleting anything', async () => {
    await run(40)
    await run(35)
    await run(5)
    const res = await preview({ runs: older(30) })
    expect(res.status).toBe(200)
    const [runs] = res.data.value
    expect(runs).toMatchObject({ category: 'RUNS', count: 2 })
    expect(new Date(runs.cutoff).getTime()).toBeCloseTo(new Date(daysAgo(30)).getTime(), -5)
    expect(runs.samples.map((s: { title: string }) => s.title)).toEqual(['run 35', 'run 40'])
    expect(await count('TestRuns')).toBe(3)
  })

  it('deletes old runs with their results, never running ones, and keeps the last result of the test case', async () => {
    const old = await run(40)
    await run(40, { status: 'RUNNING' })
    const young = await run(5)
    await INSERT.into(E('TestCaseStats')).entries({ testCase_ID: testCase, status: 'PASSED', run_ID: old, runAt: daysAgo(40) })

    expect(await cleanUp({ runs: older(30) })).toEqual({ RUNS: 1 })
    expect(await count('TestRuns', { ID: old })).toBe(0)
    expect(await count('RunResults', { run_ID: old })).toBe(0)
    expect(await count('TestRuns')).toBe(2)
    expect(await count('RunResults', { run_ID: young })).toBe(1)
    expect(await SELECT.one.from(E('TestCaseStats')).where({ testCase_ID: testCase })).toMatchObject({ status: 'PASSED', run_ID: null })
  })

  it('filters runs by outcome, user, broker, summary and keeps the newest N', async () => {
    const passed = await run(40)
    const failed = await run(40, { failedCount: 2 })
    const stopped = await run(40, { status: 'STOPPED' })
    const aborted = await run(40, { status: 'FAILED', summary: 'Nightly regression' })
    const byAdmin = await run(40, { createdBy: 'admin' })
    const onB = await run(40, {}, [brokerB])
    const ids = async (criteria: object) => {
      const res = await preview({ runs: { ...older(30), ...criteria } })
      expect(res.status).toBe(200)
      return res.data.value[0].samples.map((s: { ID: string }) => s.ID).sort()
    }
    expect(await ids({ outcomes: ['FAILED'] })).toEqual([failed, aborted].sort())
    expect(await ids({ outcomes: ['STOPPED', 'PASSED'] })).toEqual([passed, stopped, byAdmin, onB].sort())
    expect(await ids({ startedBy: ['admin'] })).toEqual([byAdmin])
    expect(await ids({ brokerIds: [brokerB] })).toEqual([onB])
    expect(await ids({ summaryContains: 'NIGHTLY' })).toEqual([aborted])
    expect((await preview({ runs: { ...older(30), outcomes: ['WHATEVER'] } })).status).toBe(400)

    // keep the newest 2 of all runs - a young one counts too
    await run(1)
    const res = await preview({ runs: { ...older(30), keepNewest: 2 } })
    expect(res.data.value[0].count).toBe(5)
  })

  it('clears payloads only, keeping runs and results', async () => {
    const old = await run(40, {}, [brokerA, brokerB])
    expect(await cleanUp({ runPayloads: older(30) })).toEqual({ RUN_PAYLOADS: 2 })
    expect(await count('RunResults', { run_ID: old })).toBe(2)
    expect(await count('RunResults', { run_ID: old, resolvedPayload: null })).toBe(2)
    // nothing left to clear
    expect((await preview({ runPayloads: older(30) })).data.value[0].count).toBe(0)
  })

  it('deletes saved messages by age, broker, user, source type and topic', async () => {
    const old = await message(40)
    await message(5)
    const queue = await message(40, { sourceType: 'QUEUE_BROWSE', topic: 'acme/payments', broker_ID: brokerB, createdBy: 'admin' })
    const n = async (criteria: object) => (await preview({ messages: { ...older(30), ...criteria } })).data.value[0].count
    expect(await n({})).toBe(2)
    expect(await n({ brokerIds: [brokerB] })).toBe(1)
    expect(await n({ savedBy: ['tester'] })).toBe(1)
    expect(await n({ sourceTypes: ['QUEUE_BROWSE', 'QUEUE_CONSUME'] })).toBe(1)
    expect(await n({ topicContains: 'Payments' })).toBe(1)
    expect(await cleanUp({ messages: { ...older(30), topicContains: 'orders' } })).toEqual({ MESSAGES: 1 })
    expect(await count('ReceivedMessages', { ID: old })).toBe(0)
    expect(await count('ReceivedMessages', { ID: queue })).toBe(1)
  })

  it('deletes subscriber setups not changed for long, optionally of inactive brokers only', async () => {
    await INSERT.into(E('SubscriberPresets')).entries([
      { ID: uuid(), name: 'old A', broker_ID: brokerA, modifiedAt: daysAgo(100), createdBy: 'tester' },
      { ID: uuid(), name: 'old B', broker_ID: brokerB, modifiedAt: daysAgo(100), createdBy: 'tester' },
      { ID: uuid(), name: 'new', broker_ID: brokerA, modifiedAt: daysAgo(1), createdBy: 'tester' }
    ])
    expect((await preview({ presets: { age: { value: 1, unit: 'MONTHS' } } })).data.value[0].count).toBe(2)
    expect(await cleanUp({ presets: { age: { value: 1, unit: 'MONTHS' }, inactiveBroker: true } })).toEqual({ PRESETS: 1 })
    expect((await SELECT.from(E('SubscriberPresets')).columns('name').orderBy('name')).map((p: { name: string }) => p.name)).toEqual(['new', 'old A'])
  })

  it('deletes orphans: rows of deleted brokers and test cases', async () => {
    const gone = uuid()
    await message(1, { broker_ID: gone })
    await message(1)
    await INSERT.into(E('SubscriberPresets')).entries({ ID: uuid(), name: 'p', broker_ID: gone })
    await INSERT.into(E('Variables')).entries([
      { ID: uuid(), name: 'v', broker_ID: gone },
      { ID: uuid(), name: 'global' }
    ])
    await INSERT.into(E('TestCaseStats')).entries([
      { testCase_ID: uuid(), status: 'PASSED' },
      { testCase_ID: testCase, status: 'PASSED' }
    ])
    expect(await cleanUp({ orphans: { messages: true, presets: true, stats: true, variables: true } })).toEqual({
      ORPHAN_MESSAGES: 1,
      ORPHAN_PRESETS: 1,
      ORPHAN_STATS: 1,
      ORPHAN_VARIABLES: 1
    })
    expect(await count('ReceivedMessages')).toBe(1)
    expect(await count('Variables')).toBe(1)
    expect(await count('TestCaseStats')).toBe(1)
  })

  it('refuses when more rows match than were previewed, or without a preview', async () => {
    await message(40)
    const request = { messages: older(30) }
    expect((await execute(request, [])).status).toBe(400)
    await message(40)
    const res = await execute(request, [{ category: 'MESSAGES', count: 1 }])
    expect(res.status).toBe(409)
    expect(res.data.error.message).toMatch(/preview again/)
    expect(await count('ReceivedMessages')).toBe(2)
    expect(await count('CleanupLogs')).toBe(0)
  })

  it('rejects an empty selection and invalid ages', async () => {
    expect((await preview({})).status).toBe(400)
    expect((await preview({ runs: { age: { value: 0, unit: 'DAYS' } } })).status).toBe(400)
    expect((await preview({ runs: {} })).status).toBe(400)
  })

  it('deletes in chunks', async () => {
    const n = CHUNK_SIZE + 3
    await INSERT.into(E('ReceivedMessages')).entries(Array.from({ length: n }, () => ({ ID: uuid(), topic: 't', receivedAt: daysAgo(40) })))
    expect(await cleanUp({ messages: older(30) })).toEqual({ MESSAGES: n })
    expect(await count('ReceivedMessages')).toBe(0)
  })

  it('logs every cleanup and the rule it came from', async () => {
    await run(40)
    await message(40)
    const rule = await POST(`${CLEANUP}/CleanupRules`, { name: 'monthly', request: JSON.stringify({ runs: older(30) }) }, admin)
    expect(rule.status).toBe(201)
    const request = { runs: older(30), messages: older(30) }
    const res = await execute(request, [
      { category: 'RUNS', count: 1 },
      { category: 'MESSAGES', count: 1 }
    ], admin, 'monthly')
    expect(res.status).toBe(200)
    expect(res.data.totalCount).toBe(2)
    const logs = (await GET(`${CLEANUP}/CleanupLogs`, admin)).data.value
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ status: 'DONE', totalCount: 2, ruleName: 'monthly', createdBy: 'admin', summary: 'Test runs 1, Saved messages 1' })
    expect(JSON.parse(logs[0].request)).toEqual(request)
    expect((await GET(`${CLEANUP}/CleanupRules(${rule.data.ID})`, admin)).data.lastRunAt).toBeTruthy()
  })

  it('logs a cleanup that failed half way as PARTIAL, keeping what was done', async () => {
    await run(40)
    await message(40)
    const fail = () => {
      throw new Error('disk full')
    }
    cds.db.before('DELETE', E('ReceivedMessages'), fail)
    try {
      const res = await execute({ runs: older(30), messages: older(30) }, [
        { category: 'RUNS', count: 1 },
        { category: 'MESSAGES', count: 1 }
      ])
      expect(res.status).toBe(500)
    } finally {
      const handlers = (cds.db as unknown as { _handlers: { before: { handler: unknown }[] } })._handlers.before
      handlers.splice(handlers.findIndex((h) => h.handler === fail), 1)
    }
    expect(await count('TestRuns')).toBe(0)
    expect(await count('ReceivedMessages')).toBe(1)
    const [log] = (await GET(`${CLEANUP}/CleanupLogs`, admin)).data.value
    expect(log).toMatchObject({ status: 'PARTIAL', totalCount: 1, errorMessage: expect.stringMatching(/disk full/) })
  })

  it('checks the selection of a saved rule', async () => {
    expect((await POST(`${CLEANUP}/CleanupRules`, { name: 'bad', request: '{' }, admin)).status).toBe(400)
    expect((await POST(`${CLEANUP}/CleanupRules`, { name: 'empty', request: '{}' }, admin)).status).toBe(400)
    expect((await POST(`${CLEANUP}/CleanupRules`, { name: 'ok', request: JSON.stringify({ orphans: { stats: true } }) }, admin)).status).toBe(201)
  })

  it('lists the users for the value help', async () => {
    await run(40, { createdBy: 'zoe' })
    await message(1, { createdBy: 'adam' })
    const res = await GET(`${CLEANUP}/users()`, admin)
    expect(res.data.value).toEqual(['adam', 'zoe'])
  })
})
