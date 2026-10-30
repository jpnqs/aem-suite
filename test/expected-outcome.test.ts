import { createActive, draft, fakeBroker, resetDatabase, runAndWait, startServer, users } from './helpers'

const { GET, POST } = startServer()
const { admin, tester } = users

// a test case with an expected outcome waits for a message after sending and checks it (lib/runs/expectations.ts)
describe('expected outcome of a test case', () => {
  const broker = fakeBroker()
  let brokerId: string

  const tc = (data: object) =>
    createActive(POST, 'test', 'TestCases', { name: 'tc', topic: 'acme/orders/{{uuid}}', payload: '{"id":"{{uuid}}","qty":3}', correlationId: '{{uuid}}', ...data })
  const runOne = async (id: string) => {
    const res = await runAndWait(POST, { testCaseIds: [id], brokerIds: [brokerId] })
    expect(res.status).toBe(200)
    const { data } = await GET(`/odata/v4/test/RunResults?$filter=run_ID eq ${res.data.runId}&$expand=checks($orderby=position)`, tester)
    return data.value[0] as Record<string, unknown> & { checks: Record<string, unknown>[] }
  }

  beforeAll(async () => {
    await resetDatabase()
    const b = await createActive(POST, 'admin', 'Brokers', { name: 'dev', credentialMode: 'DIRECT', url: 'dev.example', msgVpn: 'vpn', username: 'u' }, admin)
    brokerId = b.ID
  })
  afterEach(() => {
    broker.respond = undefined
  })

  it('passes when the message arrives on the topic subscription and all checks hold', async () => {
    const t = await tc({
      expectMode: 'TOPIC',
      expectSource: 'acme/orders/>',
      checks: [
        // {{uuid}} in a check is the uuid that was sent
        { position: 1, target: 'JSON_PATH', path: 'id', operator: 'EQUALS', value: '{{uuid}}' },
        { position: 2, target: 'JSON_PATH', path: 'qty', operator: 'EQUALS', value: '3' }
      ]
    })
    const row = await runOne(t.ID)
    expect(row).toMatchObject({ status: 'PASSED', expectMode: 'TOPIC', errorMessage: null })
    expect(String(row.receivedTopic)).toMatch(/^acme\/orders\//)
    expect(row.checks.map((c) => c.passed)).toEqual([true, true])
    expect(row.checks[1]).toMatchObject({ description: 'JSON path qty equals 3', actual: '3' })
  })

  it('fails with the failed checks and what was found', async () => {
    const t = await tc({ expectMode: 'TOPIC', expectSource: 'acme/>', checks: [{ position: 1, target: 'JSON_PATH', path: 'qty', operator: 'EQUALS', value: '4' }] })
    const row = await runOne(t.ID)
    expect(row.status).toBe('FAILED')
    expect(row.errorMessage).toBe('1 of 1 check(s) failed: JSON path qty equals 4 (found: 3)')
    expect(row.checks).toMatchObject([{ passed: false, actual: '3' }])
  })

  it('fails when nothing arrives in time, naming source and correlation id', async () => {
    broker.respond = () => undefined
    const t = await tc({ expectMode: 'TOPIC', expectSource: 'acme/>', expectTimeoutMs: 100 })
    const row = await runOne(t.ID)
    expect(row.status).toBe('FAILED')
    expect(row.errorMessage).toMatch(/^No expected message with correlation id [\w-]+ on acme\/> within 100 ms$/)
  })

  it('ignores messages with another correlation id, unless that is switched off', async () => {
    broker.respond = (spec) => ({ topic: spec.topic, payload: '{}', contentType: null, userProperties: {}, correlationId: 'someone-else', deliveryMode: 'DIRECT', receivedAt: new Date() })
    const strict = await tc({ expectMode: 'TOPIC', expectSource: 'acme/>', expectTimeoutMs: 100 })
    expect((await runOne(strict.ID)).status).toBe('FAILED')
    const loose = await tc({ expectMode: 'TOPIC', expectSource: 'acme/>', expectTimeoutMs: 100, expectCorrelation: false })
    expect((await runOne(loose.ID)).status).toBe('PASSED')
  })

  it('request/reply: sends a generated reply-to topic and waits for the answer there', async () => {
    const t = await tc({ expectMode: 'REPLY', checks: [{ position: 1, target: 'CORRELATION_ID', operator: 'EXISTS' }] })
    const row = await runOne(t.ID)
    const sent = broker.published.at(-1)!.spec
    expect(sent.replyTo).toMatch(/^aem-suite\/reply\/[\w-]+$/)
    expect(row).toMatchObject({ status: 'PASSED', expectMode: 'REPLY', receivedTopic: sent.replyTo })
  })

  it('a queue: an unknown queue is an ERROR, a known one is consumed', async () => {
    const missing = await tc({ expectMode: 'QUEUE', expectSource: 'q/missing' })
    const bad = await runOne(missing.ID)
    expect(bad.status).toBe('ERROR')
    expect(bad.errorMessage).toMatch(/^Cannot listen for the expected message: Cannot bind to queue/)

    const ok = await tc({ topic: 'acme/fixed', expectMode: 'QUEUE', expectSource: 'q/acme/fixed' })
    expect((await runOne(ok.ID)).status).toBe('PASSED')
  })

  it('without expectation the acknowledgement is enough (as before)', async () => {
    const t = await tc({})
    const row = await runOne(t.ID)
    expect(row).toMatchObject({ status: 'PASSED', expectMode: null, receivedTopic: null })
    expect(row.checks).toEqual([])
  })

  it('rejects incomplete expectations on save', async () => {
    const noSource = await draft.save(POST, 'test', 'TestCases', { topic: 'a/b', expectMode: 'QUEUE', expectSource: '' })
    expect(noSource.status).toBe(400)
    expect(JSON.stringify(noSource.data)).toMatch(/Enter the queue the expected message arrives on/)
    const badCheck = await draft.save(POST, 'test', 'TestCases', {
      topic: 'a/b',
      expectMode: 'TOPIC',
      expectSource: 'a/>',
      checks: [{ target: 'JSON_PATH', operator: 'EQUALS', path: '' }]
    })
    expect(badCheck.status).toBe(400)
    expect(JSON.stringify(badCheck.data)).toMatch(/Check 1: enter a JSON path/)
  })

  it('copy, export and import keep the expectation and its checks', async () => {
    const t = await tc({
      name: 'with checks',
      expectMode: 'QUEUE',
      expectSource: 'q/orders',
      expectTimeoutMs: 2000,
      checks: [
        { position: 1, target: 'JSON_PATH', path: 'id', operator: 'EXISTS' },
        { position: 2, target: 'PROPERTY', path: 'source', operator: 'EQUALS', value: 'erp' }
      ]
    })
    const { data: copies } = await POST('/odata/v4/test/copyNodes', { ids: [t.ID] }, tester)
    const { data: copy } = await GET(`/odata/v4/test/TestCases(ID=${copies.value[0].ID},IsActiveEntity=true)?$expand=checks($orderby=position)`, tester)
    expect(copy).toMatchObject({ expectMode: 'QUEUE', expectSource: 'q/orders', expectTimeoutMs: 2000 })
    expect(copy.checks.map((c: { target: string }) => c.target)).toEqual(['JSON_PATH', 'PROPERTY'])

    const { data: exported } = await POST('/odata/v4/test/exportNodes', { ids: [t.ID] }, tester)
    const [node] = JSON.parse(exported.content).nodes
    expect(node).toMatchObject({ expectMode: 'QUEUE', expectSource: 'q/orders', expectCorrelation: true })
    expect(node.checks).toEqual([
      { target: 'JSON_PATH', path: 'id', operator: 'EXISTS' },
      { target: 'PROPERTY', path: 'source', operator: 'EQUALS', value: 'erp' }
    ])
    const { data: imported } = await POST('/odata/v4/test/importNodes', { content: exported.content }, tester)
    expect(imported).toMatchObject({ testCases: 1, checks: 2 })

    // without an expectation the file has no expect fields (like files of older versions)
    const plain = await tc({ name: 'plain' })
    const { data: plainExport } = await POST('/odata/v4/test/exportNodes', { ids: [plain.ID] }, tester)
    expect(Object.keys(JSON.parse(plainExport.content).nodes[0]).filter((k) => k.startsWith('expect'))).toEqual([])
  })

  it('the preview describes the expectation', async () => {
    const t = await tc({ expectMode: 'TOPIC', expectSource: 'acme/>', checks: [{ position: 1, target: 'TOPIC', operator: 'CONTAINS', value: 'orders' }] })
    const { data } = await POST(`/odata/v4/test/TestCases(ID=${t.ID},IsActiveEntity=true)/TestService.preview`, { brokerId }, tester)
    expect(data.expectation).toMatch(/^Message on acme\/> with correlation id [\w-]+ within 5000 ms; checks: topic contains orders$/)
  })
})
