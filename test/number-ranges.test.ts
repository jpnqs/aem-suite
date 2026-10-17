import { allocateNumbers, formatNumber, nextExample } from '../srv/lib/number-ranges'
import { TemplateError, TemplateResolver, numberSlots } from '../srv/lib/template/resolve'
import { waitForRun } from '../srv/lib/test-runner'
import { createActive, fakeBroker, resetDatabase, startServer, users } from './helpers'

describe('number range templates (resolver)', () => {
  it('finds the numbers a message needs: plain names once, every alias of its own, also inside variables', () => {
    const slots = numberSlots(['{{numberRange.ORD}}/{{numberRange.ORD}}', '{{numberRange.ORD as a}} {{numberRange.ORD as b}} {{a}} {{inner}}'], {
      global: { inner: '{{numberRange.INV}}', unused: '{{numberRange.NEVER}}' }
    })
    expect(slots.map((s) => s.key).sort()).toEqual(['as:a', 'as:b', 'numberRange.INV', 'numberRange.ORD'])
    expect(slots.find((s) => s.key === 'as:b')?.range).toBe('ORD')
  })

  it('inserts the same number for every plain occurrence and keeps aliases as temporary variables', () => {
    const r = new TemplateResolver({ numbers: { 'numberRange.ORD': 'SO-000007', 'as:a': 'SO-000008', 'as:b': 'SO-000009' } })
    expect(r.resolve('{{numberRange.ORD}} {{numberRange.ORD}}')).toBe('SO-000007 SO-000007')
    // an alias works before and after its definition
    expect(r.resolve('{{a}} / {{numberRange.ORD as a}} / {{a}} / {{b}} / {{numberRange.ORD as b}}')).toBe('SO-000008 / SO-000008 / SO-000008 / SO-000009 / SO-000009')
  })

  it('reports a number range that was not handed out', () => {
    expect(() => new TemplateResolver().resolve('{{numberRange.NOPE}}')).toThrow(TemplateError)
    expect(() => new TemplateResolver().resolve('{{numberRange.}}')).toThrow(/Unknown variable/)
  })

  it('formats prefix, zero filled number and suffix', () => {
    const r = { name: 'X', prefix: 'SO-', suffix: '-EU', length: 6, start: 1, step: 1 }
    expect(formatNumber(r, 42n)).toBe('SO-000042-EU')
    expect(formatNumber({ ...r, length: 0 }, 42n)).toBe('SO-42-EU')
    expect(nextExample(r)).toBe('SO-000001-EU')
    expect(nextExample({ ...r, start: 4500000000, step: 10, length: 10, current: 4500000010 })).toBe('SO-4500000020-EU')
  })
})

const { GET, POST, PATCH } = startServer()
const { admin, tester } = users
const ADMIN = '/odata/v4/admin'

// every test is self-contained: the shared range ORDERS is set back to "nothing issued" before each one
describe('number ranges (service and runs)', () => {
  const { published } = fakeBroker()
  let broker: { ID: string }
  /** the range ORDERS: SO-000100, SO-000101, ... */
  let orders: { ID: string }
  /** a test case with ORDERS in topic and payload */
  let testCase: { ID: string }

  const rangeUrl = (id: string) => `${ADMIN}/NumberRanges(ID=${id},IsActiveEntity=true)`
  const create = (data: object) => createActive(POST, 'admin', 'NumberRanges', data, admin)
  const current = async (id: string) => (await GET(rangeUrl(id), admin)).data
  const run = async (testCaseId: string) => {
    const res = await POST('/odata/v4/test/runTests', { testCaseIds: [testCaseId], brokerIds: [broker.ID], credentials: [{ brokerId: broker.ID, password: 'pw' }] }, tester)
    expect(res.status).toBe(200)
    await waitForRun(res.data.runId)
    return res.data.runId as string
  }

  beforeAll(async () => {
    await resetDatabase()
    broker = await createActive(POST, 'admin', 'Brokers', { name: 'dev', credentialMode: 'DIRECT', url: 'dev.example', msgVpn: 'vpn', username: 'u' }, admin)
    orders = await create({ name: 'ORDERS', prefix: 'SO-', length: 6, start: 100 })
    testCase = await createActive(POST, 'test', 'TestCases', { name: 'order', topic: 'o/{{numberRange.ORDERS}}', payload: '{"id":"{{numberRange.ORDERS}}"}', deliveryMode: 'PERSISTENT' })
  })

  beforeEach(async () => {
    published.length = 0
    await UPDATE('aem.suite.NumberRanges').set({ current: null }).where({ ID: orders.ID })
  })

  it('creates a range and shows what the next number looks like', async () => {
    const r = await create({ name: 'SHOWN', prefix: 'SO-', length: 6, start: 100 })
    expect(await current(r.ID)).toMatchObject({ name: 'SHOWN', nextNumber: 'SO-000100', lastNumber: '' })
  })

  it('checks name, uniqueness and sizes', async () => {
    const draftOf = async (data: object) => {
      const { data: d } = await POST(`${ADMIN}/NumberRanges`, data, admin)
      return POST(`${ADMIN}/NumberRanges(ID=${d.ID},IsActiveEntity=false)/AdminService.draftActivate`, {}, admin)
    }
    // drafts are saved as they are, the checks run on save
    expect((await POST(`${ADMIN}/NumberRanges`, { name: 'x' }, admin)).status).toBe(201)
    const cases: [object, RegExp][] = [
      [{ name: '9bad' }, /must start with a letter/],
      [{ name: 'orders' }, /"orders" exists already/], // the name of ORDERS in another case
      [{ name: 'LONG', length: 30 }, /length must be between 0 and/],
      [{ name: 'STEP', step: 0 }, /step must be at least 1/],
      [{ name: 'MAX', start: 10, maximum: 5 }, /maximum must not be below the start/],
      [{ name: 'PRE', prefix: '{{x}}' }, /plain text, no variables/]
    ]
    const results = await Promise.all(cases.map(([data]) => draftOf(data)))
    results.forEach((r, i) => {
      expect(r.status).toBe(400)
      expect(r.data.error.message).toMatch(cases[i][1])
    })
  })

  it('the preview shows the next number and does not use it up', async () => {
    const url = `/odata/v4/test/TestCases(ID=${testCase.ID},IsActiveEntity=true)/TestService.preview`
    for (let i = 0; i < 2; i++) {
      const { data } = await POST(url, {}, tester)
      expect(data.valid).toBe(true)
      expect(data.topic).toBe('o/SO-000100')
      expect(JSON.parse(data.payload)).toEqual({ id: 'SO-000100' })
    }
  })

  it('a run takes the next number per message, the same one everywhere in the message', async () => {
    await run(testCase.ID)
    await run(testCase.ID)
    expect(published.map((p) => p.spec.topic)).toEqual(['o/SO-000100', 'o/SO-000101'])
    expect(JSON.parse(published[1].spec.payload)).toEqual({ id: 'SO-000101' })
    expect(await current(orders.ID)).toMatchObject({ lastNumber: 'SO-000101', nextNumber: 'SO-000102' })
  })

  it('temporary variables reuse one number, a second alias takes another', async () => {
    const tc = await createActive(POST, 'test', 'TestCases', {
      name: 'aliases',
      topic: 'a/{{orderNo}}',
      payload: '{"order":"{{numberRange.ORDERS as orderNo}}","again":"{{orderNo}}","other":"{{numberRange.ORDERS as second}}"}',
      deliveryMode: 'PERSISTENT'
    })
    await run(tc.ID)
    const payload = JSON.parse(published[0].spec.payload)
    expect(published[0].spec.topic).toBe(`a/${payload.order}`)
    expect(payload.order).toBe(payload.again)
    expect([payload.order, payload.other].sort()).toEqual(['SO-000100', 'SO-000101'])
  })

  it('parallel runs never get the same number', async () => {
    await Promise.all(Array.from({ length: 4 }, () => run(testCase.ID)))
    expect(published.map((p) => p.spec.topic).sort()).toEqual(['o/SO-000100', 'o/SO-000101', 'o/SO-000102', 'o/SO-000103'])
  })

  it('reset sets the next number (empty = start)', async () => {
    await run(testCase.ID)
    let res = await POST(`${rangeUrl(orders.ID)}/AdminService.reset`, { nextNumber: 500 }, admin)
    expect(res.status).toBeLessThan(300)
    expect(await current(orders.ID)).toMatchObject({ nextNumber: 'SO-000500', lastNumber: 'SO-000499' })
    res = await POST(`${rangeUrl(orders.ID)}/AdminService.reset`, {}, admin)
    expect(res.status).toBeLessThan(300)
    expect(await current(orders.ID)).toMatchObject({ nextNumber: 'SO-000100', lastNumber: '' })
  })

  it('saving a range that was open in a draft does not set the counter back', async () => {
    await POST(`${rangeUrl(orders.ID)}/AdminService.draftEdit`, { PreserveChanges: true }, admin)
    // meanwhile a run takes numbers
    await run(testCase.ID)
    const draft = `${ADMIN}/NumberRanges(ID=${orders.ID},IsActiveEntity=false)`
    await PATCH(draft, { description: 'edited' }, admin)
    const save = await POST(`${draft}/AdminService.draftActivate`, {}, admin)
    expect(save.status).toBeLessThan(300)
    expect(await current(orders.ID)).toMatchObject({ description: 'edited', lastNumber: 'SO-000100', nextNumber: 'SO-000101' })
  })

  it('stops with an error when the range is exhausted', async () => {
    const small = await create({ name: 'SMALL', length: 2, start: 98, maximum: 99 })
    const slots = [{ key: 'numberRange.SMALL', range: 'SMALL' }]
    expect(await allocateNumbers(slots, 'consume')).toEqual({ 'numberRange.SMALL': '98' })
    expect(await allocateNumbers(slots, 'consume')).toEqual({ 'numberRange.SMALL': '99' })
    await expect(allocateNumbers(slots, 'consume')).rejects.toThrow(/exhausted/)
    // a failed take does not move the range
    expect(await current(small.ID)).toMatchObject({ lastNumber: '99' })

    const tc = await createActive(POST, 'test', 'TestCases', { name: 'small', topic: 's/{{numberRange.SMALL}}', payload: '{}', deliveryMode: 'PERSISTENT' })
    const runId = await run(tc.ID)
    const { data } = await GET(`/odata/v4/test/RunResults?$filter=run_ID eq ${runId}`, tester)
    expect(data.value[0]).toMatchObject({ status: 'ERROR' })
    expect(data.value[0].errorMessage).toMatch(/exhausted/)
  })

  it('reports an unknown range in the preview', async () => {
    const tc = await createActive(POST, 'test', 'TestCases', { name: 'unknown', topic: 'u/{{numberRange.MISSING}}', payload: '{}', deliveryMode: 'PERSISTENT' })
    const { data } = await POST(`/odata/v4/test/TestCases(ID=${tc.ID},IsActiveEntity=true)/TestService.preview`, {}, tester)
    expect(data.valid).toBe(false)
    expect(data.message).toMatch(/Unknown number range "MISSING"/)
  })

  it('is for administrators', async () => {
    expect((await GET(`${ADMIN}/NumberRanges`, tester)).status).toBe(403)
  })
})
