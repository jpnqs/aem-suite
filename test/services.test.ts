import cds from '@sap/cds'
import path from 'node:path'
import type { PublishSpec } from '../srv/lib/solace/session'
import { setPublisherFactory, waitForRun } from '../srv/lib/test-runner'

const { GET, POST, PATCH, axios } = cds.test(path.join(__dirname, '..'))
const admin = { auth: { username: 'admin', password: 'admin' } }
const tester = { auth: { username: 'tester', password: 'tester' } }

/** Creates an entity through the draft flow and activates it. */
async function createActive(service: string, entity: string, data: object, auth = admin) {
  const { data: draft } = await POST(`/odata/v4/${service}/${entity}`, data, auth)
  const { data: active } = await POST(
    `/odata/v4/${service}/${entity}(ID=${draft.ID},IsActiveEntity=false)/${service === 'admin' ? 'AdminService' : 'TestService'}.draftActivate`,
    {},
    auth
  )
  return active
}

describe('AEM test suite services', () => {
  const published: { broker: string; spec: PublishSpec }[] = []
  /** broker name -> password the connection was opened with */
  const connectedWith: Record<string, string> = {}
  let goodBroker: { ID: string }
  let badBroker: { ID: string }
  let testCase: { ID: string }

  beforeAll(async () => {
    // start from an empty database - test/data holds demo rows for local development
    for (const e of ['TestCaseProperties', 'TestCaseVariables', 'TestCases', 'Variables', 'Brokers'])
      await DELETE.from(`aem.suite.${e}`)
    axios.defaults.validateStatus = () => true
    setPublisherFactory(async (conn) => {
      connectedWith[conn.brokerName] = conn.password
      if (conn.brokerName === 'unreachable') throw new Error('Connect failed: Unauthorized')
      return {
        publish: async (spec) => {
          published.push({ broker: conn.brokerName, spec })
          if (spec.topic.includes('reject')) throw new Error('Rejected by broker: no subscribers')
          return { latencyMs: 3 }
        },
        close: async () => undefined
      }
    })
  })

  afterAll(() => setPublisherFactory())

  it('returns the logged-in user for the "my entries" filter', async () => {
    const { data } = await GET('/odata/v4/test/currentUser()', tester)
    expect(data.value).toBe('tester')
  })

  it('denies admin service to testers', async () => {
    const res = await GET('/odata/v4/admin/Brokers', tester)
    expect(res.status).toBe(403)
  })

  it('creates direct brokers without storing any password', async () => {
    const { data: draft } = await POST(
      '/odata/v4/admin/Brokers',
      { name: 'dev', credentialMode: 'DIRECT', url: 'dev.example', msgVpn: 'dev-vpn' },
      admin
    )
    expect(draft.username).toBe('solace-cloud-client')
    expect(draft.url).toBe('wss://dev.example:443')
    const { data: active, status } = await POST(
      `/odata/v4/admin/Brokers(ID=${draft.ID},IsActiveEntity=false)/AdminService.draftActivate`,
      {},
      admin
    )
    expect(status).toBe(201)
    goodBroker = active
    // no automatic connection test for direct brokers - there is no password to test with
    expect(active.lastConnectionStatus ?? null).toBeNull()
    expect(Object.keys(active).filter((k) => /password/i.test(k))).toEqual([])
    const row = await SELECT.one.from('aem.suite.Brokers', goodBroker.ID)
    expect(Object.keys(row).filter((k) => /password/i.test(k))).toEqual([])

    await INSERT.into('aem.suite.Variables').entries({ broker_ID: goodBroker.ID, name: 'region', value: 'eu' })
    badBroker = await createActive('admin', 'Brokers', {
      name: 'unreachable',
      credentialMode: 'DIRECT',
      url: 'nope.example:55443',
      msgVpn: 'x',
      username: 'u'
    })
    expect(badBroker).toMatchObject({ url: 'tcps://nope.example:55443' })
  })

  it('tests a direct broker connection with a password entered for that test only', async () => {
    const url = `/odata/v4/admin/Brokers(ID=${goodBroker.ID},IsActiveEntity=true)/AdminService.testConnection`
    const { data: without } = await POST(url, {}, admin)
    expect(without).toMatchObject({ ok: false, message: 'Password required for broker "dev"' })

    const { data: withPw } = await POST(url, { password: 'pw-test' }, admin)
    expect(withPw.ok).toBe(true)
    expect(connectedWith.dev).toBe('pw-test')
    const row = await SELECT.one.from('aem.suite.Brokers', goodBroker.ID)
    expect(row.lastConnectionStatus).toBe('OK')
    expect(JSON.stringify(row)).not.toContain('pw-test')
  })

  it('tests destination brokers automatically on save', async () => {
    process.env.destinations = JSON.stringify([
      { name: 'aem-dest', url: 'https://dest.example', username: 'du', password: 'dp', msgVpn: 'dvpn' }
    ])
    try {
      const { data: draft } = await POST(
        '/odata/v4/admin/Brokers',
        { name: 'dest', credentialMode: 'DESTINATION', destinationName: 'aem-dest', active: false },
        admin
      )
      // inactive: saved without test
      let res = await POST(`/odata/v4/admin/Brokers(ID=${draft.ID},IsActiveEntity=false)/AdminService.draftActivate`, {}, admin)
      expect(res.data.lastConnectionStatus ?? null).toBeNull()

      await POST(`/odata/v4/admin/Brokers(ID=${draft.ID},IsActiveEntity=true)/AdminService.draftEdit`, {}, admin)
      await PATCH(`/odata/v4/admin/Brokers(ID=${draft.ID},IsActiveEntity=false)`, { active: true }, admin)
      res = await POST(`/odata/v4/admin/Brokers(ID=${draft.ID},IsActiveEntity=false)/AdminService.draftActivate`, {}, admin)
      expect(res.data).toMatchObject({ lastConnectionStatus: 'OK' })
      expect(String(res.headers['sap-messages'])).toMatch(/Connection test successful/)
      expect(connectedWith.dest).toBe('dp')
      await UPDATE('aem.suite.Brokers', draft.ID).with({ active: false })
    } finally {
      delete process.env.destinations
    }
  })

  it('validates broker input', async () => {
    const { data: draft } = await POST('/odata/v4/admin/Brokers', { name: 'broken', credentialMode: 'DESTINATION' }, admin)
    const res = await POST(
      `/odata/v4/admin/Brokers(ID=${draft.ID},IsActiveEntity=false)/AdminService.draftActivate`,
      {},
      admin
    )
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.data)).toMatch(/Destination name is required/)
  })

  it('creates global variables and rejects duplicates', async () => {
    await createActive('admin', 'GlobalVariables', { name: 'app', value: 'shop' })
    const { data: draft } = await POST('/odata/v4/admin/GlobalVariables', { name: 'app', value: 'x' }, admin)
    const res = await POST(
      `/odata/v4/admin/GlobalVariables(ID=${draft.ID},IsActiveEntity=false)/AdminService.draftActivate`,
      {},
      admin
    )
    expect(res.status).toBe(409)
  })

  it('rejects invalid JSON payloads but accepts templated numbers', async () => {
    const { data: draft } = await POST(
      '/odata/v4/test/TestCases',
      { name: 'bad', topic: 't', payload: '{"a": }' },
      tester
    )
    const res = await POST(
      `/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=false)/TestService.draftActivate`,
      {},
      tester
    )
    expect(res.status).toBe(400)

    testCase = await createActive(
      'test',
      'TestCases',
      {
        name: 'Order created',
        topic: '{{app}}/orders/{{region}}/created/{{uuid}}',
        payload: '{"id":"{{uuid}}","qty":{{qty}},"broker":"{{broker.name}}"}',
        deliveryMode: 'PERSISTENT',
        correlationId: '{{uuid}}',
        userProperties: [{ name: 'qty', type: 'INT', value: '{{qty}}' }],
        variables: [{ name: 'qty', value: '5' }]
      },
      tester
    )
    expect(testCase.ID).toBeDefined()
  })

  it('previews a test case with broker variables', async () => {
    const { data } = await POST(
      `/odata/v4/test/TestCases(ID=${testCase.ID},IsActiveEntity=true)/TestService.preview`,
      { brokerId: goodBroker.ID },
      tester
    )
    expect(data.valid).toBe(true)
    expect(data.topic).toMatch(/^shop\/orders\/eu\/created\/[0-9a-f-]{36}$/)
    const payload = JSON.parse(data.payload)
    expect(payload).toMatchObject({ qty: 5, broker: 'dev' })
    expect(data.topic.endsWith(payload.id)).toBe(true)
    expect(data.correlationId).toBe(payload.id)
  })

  it('reports unknown variables in preview without a broker', async () => {
    const { data } = await POST(
      `/odata/v4/test/TestCases(ID=${testCase.ID},IsActiveEntity=true)/TestService.preview`,
      {},
      tester
    )
    expect(data.valid).toBe(false)
    expect(data.message).toMatch(/Unknown variable\(s\): region/)
  })

  it('runs a test case against multiple brokers', async () => {
    const res = await POST(
      `/odata/v4/test/TestCases(ID=${testCase.ID},IsActiveEntity=true)/TestService.runTest`,
      {
        brokerIds: [goodBroker.ID, badBroker.ID],
        credentials: [
          { brokerId: goodBroker.ID, password: 'pw-dev' },
          { brokerId: badBroker.ID, password: 'pw-bad' }
        ]
      },
      tester
    )
    expect(res.status).toBe(200)
    const { runId } = res.data
    await waitForRun(runId)

    const { data: run } = await GET(`/odata/v4/test/TestRuns(${runId})?$expand=results`, tester)
    expect(run).toMatchObject({ status: 'DONE', totalCount: 2, passedCount: 1, failedCount: 1, statusCriticality: 1 })
    const byBroker = Object.fromEntries(run.results.map((r: { brokerName: string }) => [r.brokerName, r]))
    expect(byBroker.dev).toMatchObject({ status: 'PASSED', ackLatencyMs: 3, deliveryMode: 'PERSISTENT' })
    expect(byBroker.dev.resolvedTopic).toMatch(/^shop\/orders\/eu\/created\//)
    expect(byBroker.unreachable).toMatchObject({ status: 'ERROR', errorMessage: 'Connect failed: Unauthorized' })

    const sent = published.find((p) => p.broker === 'dev')!.spec
    expect(sent.userProperties).toEqual([{ name: 'qty', type: 'INT', value: '5' }])
    expect(connectedWith.dev).toBe('pw-dev')
    expect(run.summary).toBe('Order created → dev, unreachable')
    // last result per test case: failed on one broker -> ERROR overall, with the reason
    const { data: tc } = await GET(
      `/odata/v4/test/TestCases(ID=${testCase.ID},IsActiveEntity=true)?$expand=lastResult`,
      tester
    )
    expect(tc.lastResult).toMatchObject({ status: 'ERROR', criticality: 1, brokers: 'dev, unreachable' })
    expect(tc.lastResult.message).toBe('unreachable: Connect failed: Unauthorized')
    // the password is not part of anything persisted for the run
    const rows = await SELECT.from('aem.suite.RunResults').where({ run_ID: runId })
    expect(JSON.stringify(rows)).not.toContain('pw-dev')
  })

  it('refuses to start a run without passwords for direct brokers', async () => {
    const res = await POST(
      `/odata/v4/test/TestCases(ID=${testCase.ID},IsActiveEntity=true)/TestService.runTest`,
      { brokerIds: [goodBroker.ID, badBroker.ID], credentials: [{ brokerId: badBroker.ID, password: 'x' }] },
      tester
    )
    expect(res.status).toBe(400)
    expect(res.data.error.message).toBe('Password required for broker(s): dev')
  })

  it('runs several test cases and marks broker rejections as FAILED', async () => {
    const rejecting = await createActive(
      'test',
      'TestCases',
      { name: 'rejected', topic: 'reject/me', payload: '{}', deliveryMode: 'DIRECT' },
      tester
    )
    const res = await POST(
      '/odata/v4/test/runTests',
      {
        testCaseIds: [testCase.ID, rejecting.ID],
        brokerIds: [goodBroker.ID],
        credentials: [{ brokerId: goodBroker.ID, password: 'pw-dev' }]
      },
      tester
    )
    expect(res.status).toBe(200)
    await waitForRun(res.data.runId)
    const { data } = await GET(`/odata/v4/test/RunResults?$filter=run_ID eq ${res.data.runId}`, tester)
    const statuses = data.value.map((r: { testCaseName: string; status: string }) => `${r.testCaseName}:${r.status}`).sort()
    expect(statuses).toEqual(['Order created:PASSED', 'rejected:FAILED'])
    const { data: stats } = await GET('/odata/v4/test/TestCaseStats', tester)
    const byCase = Object.fromEntries(stats.value.map((x: { testCase_ID: string; status: string }) => [x.testCase_ID, x.status]))
    expect(byCase[testCase.ID]).toBe('PASSED')
    expect(byCase[rejecting.ID]).toBe('FAILED')
  })

  it('validates run input', async () => {
    const res = await POST('/odata/v4/test/runTests', { testCaseIds: [testCase.ID], brokerIds: [] }, tester)
    expect(res.status).toBe(400)
  })

  it('duplicates a test case including children', async () => {
    const { data } = await POST(
      `/odata/v4/test/TestCases(ID=${testCase.ID},IsActiveEntity=true)/TestService.duplicate`,
      {},
      tester
    )
    expect(data.name).toBe('Order created (Copy)')
    const { data: copy } = await GET(
      `/odata/v4/test/TestCases(ID=${data.ID},IsActiveEntity=true)?$expand=userProperties,variables`,
      tester
    )
    expect(copy.userProperties).toHaveLength(1)
    expect(copy.variables).toHaveLength(1)
  })

  it('saves a received message and turns it into a test case', async () => {
    const { data: msg } = await POST(
      '/odata/v4/subscribe/ReceivedMessages',
      {
        broker_ID: goodBroker.ID,
        source: 'acme/>',
        sourceType: 'TOPIC',
        topic: 'acme/orders/created',
        payload: '{"a":1}',
        contentType: 'application/json',
        userProperties: '{"count":3,"flag":true,"src":"x"}',
        deliveryMode: 'PERSISTENT'
      },
      tester
    )
    expect(msg.brokerName).toBe('dev')

    const { data } = await POST(
      `/odata/v4/subscribe/ReceivedMessages(${msg.ID})/SubscribeService.createTestCase`,
      {},
      tester
    )
    const { data: tc } = await GET(
      `/odata/v4/test/TestCases(ID=${data.ID},IsActiveEntity=true)?$expand=userProperties`,
      tester
    )
    expect(tc).toMatchObject({ topic: 'acme/orders/created', deliveryMode: 'PERSISTENT' })
    expect(JSON.parse(tc.payload)).toEqual({ a: 1 })
    const types = Object.fromEntries(tc.userProperties.map((p: { name: string; type: string }) => [p.name, p.type]))
    expect(types).toEqual({ count: 'INT', flag: 'BOOL', src: 'STRING' })
  })

  it('validates subscription input', async () => {
    const res = await POST(
      '/odata/v4/subscribe/start',
      { brokerId: goodBroker.ID, sourceType: 'TOPIC', topics: [] },
      tester
    )
    expect(res.status).toBe(400)
    const noPw = await POST(
      '/odata/v4/subscribe/start',
      { brokerId: goodBroker.ID, sourceType: 'TOPIC', topics: ['a/>'] },
      tester
    )
    expect(noPw.status).toBe(400)
    expect(noPw.data.error.message).toBe('Password required for broker "dev"')
    const { data } = await GET('/odata/v4/subscribe/activeSubscriptions()', tester)
    expect(data.value).toEqual([])
  })

  it('lets admins update brokers via draft edit', async () => {
    await POST(`/odata/v4/admin/Brokers(ID=${goodBroker.ID},IsActiveEntity=true)/AdminService.draftEdit`, {}, admin)
    await PATCH(`/odata/v4/admin/Brokers(ID=${goodBroker.ID},IsActiveEntity=false)`, { description: 'changed' }, admin)
    const res = await POST(
      `/odata/v4/admin/Brokers(ID=${goodBroker.ID},IsActiveEntity=false)/AdminService.draftActivate`,
      {},
      admin
    )
    expect(res.status).toBe(200)
    const row = await SELECT.one.from('aem.suite.Brokers', goodBroker.ID)
    expect(row.description).toBe('changed')
  })

  it('starts new test cases from a template and fills empty types on save', async () => {
    const { data: draft } = await POST('/odata/v4/test/TestCases', {}, tester)
    expect(draft.payload).toContain('"id": "{{uuid}}"')
    expect(draft.correlationId).toBe('{{uuid}}')
    expect(draft.priority ?? null).toBeNull()

    await PATCH(
      `/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=false)`,
      { name: 'auto', topic: 'a/b', payload: 'plain text {{uuid}}', contentType: null },
      tester
    )
    for (const [name, value] of [['n', '42'], ['b', 'true'], ['s', 'x'], ['t', '{{qty}}']])
      await POST(`/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=false)/userProperties`, { name, value }, tester)
    const res = await POST(
      `/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=false)/TestService.draftActivate`,
      {},
      tester
    )
    expect(res.status).toBe(201)
    const { data: tc } = await GET(
      `/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=true)?$expand=userProperties`,
      tester
    )
    expect(tc.contentType).toBe('text/plain')
    const types = Object.fromEntries(tc.userProperties.map((p: { name: string; type: string }) => [p.name, p.type]))
    expect(types).toEqual({ n: 'INT', b: 'BOOL', s: 'STRING', t: 'STRING' })
  })

  it('takes the name from the topic until the user names the test case', async () => {
    const { data: draft } = await POST('/odata/v4/test/TestCases', {}, tester)
    expect(draft.contentType).toBe('application/json')
    const url = `/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=false)`

    let { data } = await PATCH(url, { topic: 'acme/orders' }, tester)
    expect(data.name).toBe('acme/orders')
    ;({ data } = await PATCH(url, { topic: 'acme/orders/created' }, tester))
    expect(data.name).toBe('acme/orders/created')

    await PATCH(url, { name: 'Order created' }, tester)
    ;({ data } = await PATCH(url, { topic: 'acme/orders/created/v2' }, tester))
    expect(data.name).toBe('Order created')

    // saved without a name -> topic is used
    const { data: d2 } = await POST('/odata/v4/test/TestCases', {}, tester)
    await PATCH(`/odata/v4/test/TestCases(ID=${d2.ID},IsActiveEntity=false)`, { topic: 'x/y', name: null }, tester)
    const res = await POST(`/odata/v4/test/TestCases(ID=${d2.ID},IsActiveEntity=false)/TestService.draftActivate`, {}, tester)
    expect(res.status).toBe(201)
    expect(res.data.name).toBe('x/y')
  })

  it('previews a draft while it is being edited', async () => {
    const { data: draft } = await POST('/odata/v4/test/TestCases', { topic: 'draft/{{region}}' }, tester)
    const { data, status } = await POST(
      `/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=false)/TestService.preview`,
      { brokerId: goodBroker.ID },
      tester
    )
    expect(status).toBe(200)
    expect(data).toMatchObject({ valid: true, topic: 'draft/eu' })
  })

  it('lists destinations for the value help', async () => {
    process.env.destinations = JSON.stringify([
      { name: 'aem-dev', url: 'https://mr-dev.messaging.solace.cloud:443', username: 'u', password: 'p', msgVpn: 'dev' },
      { name: 'some-http-api', url: 'ftp://not-a-broker' }
    ])
    try {
      const { data } = await GET('/odata/v4/admin/Destinations', admin)
      expect(data.value).toEqual([
        expect.objectContaining({ name: 'aem-dev', msgVpn: 'dev', source: 'ENV', authentication: 'BasicAuthentication' })
      ])
      const { data: search } = await GET('/odata/v4/admin/Destinations?$search=nothing', admin)
      expect(search.value).toEqual([])
    } finally {
      delete process.env.destinations
    }
  })
})
