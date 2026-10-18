import cds from '@sap/cds'
import * as testCaseSpec from '../srv/lib/runs/test-case-spec'
import { failRuns, waitForRun } from '../srv/lib/runs/test-runner'
import { setSessionFactory, stopAll } from '../srv/lib/solace/subscription-hub'
import { FakeSubscriberSession } from './fakes/solace'
import { createActive, draft, fakeBroker, resetDatabase, runAndWait, startServer, users, withDestinations } from './helpers'

const { GET, POST, PATCH, DELETE: DEL } = startServer()
const { admin, tester } = users

describe('AEM test suite services', () => {
  const { published, connectedWith, connectedAs } = fakeBroker(3)
  let goodBroker: { ID: string }
  let badBroker: { ID: string; url: string }
  let testCase: { ID: string; payload: string }

  beforeAll(async () => {
    await resetDatabase()
    goodBroker = await createActive(
      POST,
      'admin',
      'Brokers',
      { name: 'dev', credentialMode: 'DIRECT', url: 'dev.example', msgVpn: 'dev-vpn', username: 'solace-cloud-client' },
      admin
    )
    await INSERT.into('aem.suite.Variables').entries({ broker_ID: goodBroker.ID, name: 'region', value: 'eu' })
    badBroker = await createActive(
      POST,
      'admin',
      'Brokers',
      { name: 'unreachable', credentialMode: 'DIRECT', url: 'nope.example:55443', msgVpn: 'x', username: 'u' },
      admin
    )
    await createActive(POST, 'admin', 'GlobalVariables', { name: 'app', value: 'shop' }, admin)
    testCase = await createActive(POST, 'test', 'TestCases', {
      name: 'Order created',
      topic: '{{app}}/orders/{{region}}/created/{{uuid}}',
      payload: '{"id":"{{uuid}}","qty":{{qty}},"broker":"{{broker.name}}"}',
      deliveryMode: 'PERSISTENT',
      correlationId: '{{uuid}}',
      userProperties: [{ name: 'qty', type: 'INT', value: '{{qty}}' }],
      variables: [{ name: 'qty', value: '5' }]
    })
  })

  it('returns the logged-in user for the "my entries" filter', async () => {
    const { data } = await GET('/odata/v4/test/currentUser()', tester)
    expect(data.value).toBe('tester')
  })

  it('denies admin service to testers', async () => {
    const res = await GET('/odata/v4/admin/Brokers', tester)
    expect(res.status).toBe(403)
  })

  it('creates direct brokers without storing any password', async () => {
    const { data: created } = await POST(
      '/odata/v4/admin/Brokers',
      { name: 'no-password', credentialMode: 'DIRECT', url: 'dev.example', msgVpn: 'dev-vpn', username: 'solace-cloud-client' },
      admin
    )
    expect(created.username).toBe('solace-cloud-client')
    expect(created.url).toBe('wss://dev.example:443')
    const { data: active, status } = await draft.activate(POST, 'admin', 'Brokers', created.ID, admin)
    expect(status).toBe(201)
    // no automatic connection test for direct brokers - there is no password to test with
    expect(active.lastConnectionStatus ?? null).toBeNull()
    expect(Object.keys(active).filter((k) => /password/i.test(k))).toEqual([])
    const row = await SELECT.one.from('aem.suite.Brokers', active.ID)
    expect(Object.keys(row).filter((k) => /password/i.test(k))).toEqual([])
  })

  it('completes the broker URL from the host and port', async () => {
    // host:port of an SMF port becomes tcps:// (the broker of beforeAll)
    expect(badBroker.url).toBe('tcps://nope.example:55443')
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

  it('tests destination brokers automatically on save', () =>
    withDestinations([{ name: 'aem-dest', url: 'https://dest.example', username: 'du', password: 'dp', msgVpn: 'dvpn' }], async () => {
      // inactive: saved without test
      let res = await draft.save(POST, 'admin', 'Brokers', { name: 'dest', credentialMode: 'DESTINATION', destinationName: 'aem-dest', active: false }, admin)
      const { ID } = res.data
      expect(res.data.lastConnectionStatus ?? null).toBeNull()
      try {
        await draft.edit(POST, 'admin', 'Brokers', ID, admin)
        await PATCH(`/odata/v4/admin/Brokers(ID=${ID},IsActiveEntity=false)`, { active: true }, admin)
        res = await draft.activate(POST, 'admin', 'Brokers', ID, admin)
        expect(res.data).toMatchObject({ lastConnectionStatus: 'OK' })
        expect(String(res.headers['sap-messages'])).toMatch(/Connection test successful/)
        expect(connectedWith.dest).toBe('dp')
      } finally {
        // later tests list the active brokers
        await UPDATE('aem.suite.Brokers', ID).with({ active: false })
      }
    }))

  it('saves a destination broker whose connection test fails, with a warning', () =>
    withDestinations([{ name: 'aem-down', url: 'https://down.example', username: 'du', password: 'dp', msgVpn: 'dvpn' }], async () => {
      // the fake broker refuses connections to brokers named "unreachable"
      const res = await draft.save(POST, 'admin', 'Brokers', { name: 'unreachable', credentialMode: 'DESTINATION', destinationName: 'aem-down' }, admin)
      try {
        expect(res.status).toBe(201)
        expect(res.data).toMatchObject({ lastConnectionStatus: 'ERROR', lastConnectionMessage: 'Connect failed: Unauthorized' })
        expect(String(res.headers['sap-messages'])).toMatch(/Saved, but the connection test failed: Connect failed: Unauthorized/)
      } finally {
        await UPDATE('aem.suite.Brokers', res.data.ID).with({ active: false })
      }
    }))

  it('validates broker input', async () => {
    const messages = async (data: object) => {
      const res = await draft.save(POST, 'admin', 'Brokers', data, admin)
      expect(res.status).toBe(400)
      const error = res.data.error
      return (error.details ?? [error]).map((e: { message: string; target: string }) => `${e.target}: ${e.message}`)
    }
    expect(await messages({ name: 'broken', credentialMode: 'DESTINATION' })).toEqual(['in/destinationName: Destination name is required'])
    expect(await messages({ name: 'broken', credentialMode: 'DIRECT' })).toEqual(['in/url: URL is required', 'in/msgVpn: Message VPN is required'])
    expect((await messages({ name: 'broken', credentialMode: 'DIRECT', url: 'ftp://x.example', msgVpn: 'v' })).join()).toMatch(/^in\/url: .*ftp/)
  })

  it('checks broker variable names like test case variables', async () => {
    const broker = { credentialMode: 'DIRECT', url: 'vars.example', msgVpn: 'v' }
    const activate = (data: object) => draft.save(POST, 'admin', 'Brokers', data, admin)
    const invalid = await activate({ ...broker, name: 'vars1', variables: [{ name: 'my var', value: 'x' }] })
    expect(invalid.status).toBe(400)
    expect(invalid.data.error).toMatchObject({ message: 'Invalid variable name "my var"', target: 'in/variables(0)/name' })
    const duplicate = await activate({ ...broker, name: 'vars2', variables: [{ name: 'region', value: 'eu' }, { name: 'region', value: 'us' }] })
    expect(duplicate.status).toBe(400)
    expect(duplicate.data.error.message).toBe('Duplicate variable "region"')
    expect((await activate({ ...broker, name: 'vars3', variables: [{ name: 'region', value: 'eu' }] })).status).toBeLessThan(300)
  })

  it('rejects enum values and numbers outside the schema limits on the OData paths too', async () => {
    const activate = (service: 'admin' | 'test', entity: string, data: object, auth: object) => draft.save(POST, service, entity, data, auth)
    const message = (res: { data: unknown }) => JSON.stringify(res.data)
    const tc = { name: 'enum', topic: 't/enum', payload: '{}' }
    const results = [
      await activate('test', 'TestCases', { ...tc, deliveryMode: 'FOO' }, tester),
      await activate('test', 'TestCases', { ...tc, userProperties: [{ name: 'p', type: 'X', value: '1' }] }, tester),
      await activate('test', 'TestCases', { ...tc, priority: 256 }, tester),
      await activate('admin', 'Brokers', { name: 'enum', credentialMode: 'X', url: 'a.example', msgVpn: 'v' }, admin),
      await activate('admin', 'Brokers', { name: 'slow', credentialMode: 'DIRECT', url: 'a.example', msgVpn: 'v', connectTimeoutMs: 50 }, admin)
    ]
    expect(results.map((r) => r.status)).toEqual([400, 400, 400, 400, 400])
    expect(message(results[0])).toMatch(/ASSERT_ENUM.*in\/deliveryMode/)
    expect(message(results[1])).toMatch(/ASSERT_ENUM.*userProperties/)
    expect(message(results[2])).toMatch(/in\/priority/)
    expect(message(results[3])).toMatch(/ASSERT_ENUM.*in\/credentialMode/)
    expect(message(results[4])).toMatch(/between 1000 and 120000.*in\/connectTimeoutMs/)
  })

  it('creates global variables and rejects duplicates and invalid names', async () => {
    await createActive(POST, 'admin', 'GlobalVariables', { name: 'tenant', value: 'acme' }, admin)
    const duplicate = await draft.save(POST, 'admin', 'GlobalVariables', { name: 'tenant', value: 'x' }, admin)
    expect(duplicate.status).toBe(409)
    expect(duplicate.data.error.message).toBe('Global variable "tenant" already exists')
    // names are unique regardless of case, as number ranges and subscriber setups
    expect((await draft.save(POST, 'admin', 'GlobalVariables', { name: 'Tenant', value: 'x' }, admin)).status).toBe(409)
    const invalid = await draft.save(POST, 'admin', 'GlobalVariables', { name: 'my tenant', value: 'x' }, admin)
    expect(invalid.status).toBe(400)
    expect(invalid.data.error).toMatchObject({ message: expect.stringMatching(/^Variable names must start with a letter/), target: 'in/name' })
  })

  it('rejects invalid JSON payloads but accepts templated numbers', async () => {
    const res = await draft.save(POST, 'test', 'TestCases', { name: 'bad', topic: 't', payload: '{"a": }' })
    expect(res.status).toBe(400)
    expect(res.data.error).toMatchObject({ message: expect.stringMatching(/^Payload is not valid JSON/), target: 'in/payload' })
    // the test case of beforeAll has a variable where a number goes - saved as is
    expect(testCase.payload).toContain('"qty":{{qty}}')
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

  describe('a run of one test case against two brokers', () => {
    let runId: string
    let run: Record<string, any>

    beforeAll(async () => {
      published.length = 0
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
      runId = res.data.runId
      await waitForRun(runId)
      run = (await GET(`/odata/v4/test/TestRuns(${runId})?$expand=results`, tester)).data
    })

    it('stores one result per broker', () => {
      expect(run).toMatchObject({ status: 'DONE', totalCount: 2, passedCount: 1, failedCount: 1, statusCriticality: 1 })
      expect(run.summary).toBe('Order created → dev, unreachable')
      const byBroker = Object.fromEntries(run.results.map((r: { brokerName: string }) => [r.brokerName, r]))
      expect(byBroker.dev).toMatchObject({ status: 'PASSED', ackLatencyMs: 3, deliveryMode: 'PERSISTENT' })
      expect(byBroker.dev.resolvedTopic).toMatch(/^shop\/orders\/eu\/created\//)
      expect(byBroker.unreachable).toMatchObject({ status: 'ERROR', errorMessage: 'Connect failed: Unauthorized' })
    })

    it('sends the resolved message with the password entered for the run, and keeps no password', async () => {
      const sent = published.find((p) => p.broker === 'dev')!.spec
      expect(sent.userProperties).toEqual([{ name: 'qty', type: 'INT', value: '5' }])
      expect(connectedWith.dev).toBe('pw-dev')
      const rows = await SELECT.from('aem.suite.RunResults').where({ run_ID: runId })
      expect(JSON.stringify(rows)).not.toContain('pw-dev')
    })

    it('keeps the last result per test case: failed on one broker -> ERROR overall, with the reason', async () => {
      const { data: tc } = await GET(`/odata/v4/test/TestCases(ID=${testCase.ID},IsActiveEntity=true)?$expand=lastResult`, tester)
      expect(tc.lastResult).toMatchObject({ status: 'ERROR', criticality: 1, brokers: 'dev, unreachable' })
      expect(tc.lastResult.message).toBe('unreachable: Connect failed: Unauthorized')
    })
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

  it('asks for a username only for direct brokers without a maintained one', async () => {
    // the username is optional on the broker and has no default value
    const noUser = await createActive(POST, 'admin', 'Brokers', { name: 'no-user', credentialMode: 'DIRECT', url: 'nouser.example', msgVpn: 'v' }, admin)
    expect(noUser.username ?? null).toBeNull()
    // the test case needs {{region}}
    await INSERT.into('aem.suite.Variables').entries({ broker_ID: noUser.ID, name: 'region', value: 'eu' })
    try {
      const run = `/odata/v4/test/TestCases(ID=${testCase.ID},IsActiveEntity=true)/TestService.runTest`
      const refused = await POST(run, { brokerIds: [noUser.ID], credentials: [{ brokerId: noUser.ID, password: 'pw' }] }, tester)
      expect(refused.status).toBe(400)
      expect(refused.data.error.message).toBe('Username required for broker(s): no-user')

      // test connection: username and password both come from the request
      const url = `/odata/v4/admin/Brokers(ID=${noUser.ID},IsActiveEntity=true)/AdminService.testConnection`
      const { data: noName } = await POST(url, { password: 'pw' }, admin)
      expect(noName).toMatchObject({ ok: false, message: 'Username required for broker "no-user"' })
      const { data: ok } = await POST(url, { username: 'entered', password: 'pw' }, admin)
      expect(ok.ok).toBe(true)
      expect(connectedAs['no-user']).toBe('entered')

      const started = await POST(
        run,
        { brokerIds: [noUser.ID], credentials: [{ brokerId: noUser.ID, username: ' alice ', password: 'pw' }] },
        tester
      )
      expect(started.status).toBe(200)
      await waitForRun(started.data.runId)
      expect(connectedAs['no-user']).toBe('alice')
      const rows = await SELECT.from('aem.suite.RunResults').where({ run_ID: started.data.runId })
      expect(rows.map((r: { status: string }) => r.status)).toEqual(['PASSED'])
      // neither the entered username nor the password is persisted with the broker
      const stored = await SELECT.one.from('aem.suite.Brokers', noUser.ID)
      expect(stored.username ?? null).toBeNull()

      // a maintained username wins over an entered one
      const maintained = await POST(
        run,
        { brokerIds: [goodBroker.ID], credentials: [{ brokerId: goodBroker.ID, username: 'ignored', password: 'pw-dev' }] },
        tester
      )
      await waitForRun(maintained.data.runId)
      expect(connectedAs.dev).toBe('solace-cloud-client')
    } finally {
      await DELETE.from('aem.suite.RunResults').where({ broker_ID: noUser.ID })
      await DELETE.from('aem.suite.Variables').where({ broker_ID: noUser.ID })
      await DELETE.from('aem.suite.Brokers').where({ ID: noUser.ID })
    }
  })

  it('runs several test cases and marks broker rejections as FAILED', async () => {
    const rejecting = await createActive(POST, 'test', 'TestCases', { name: 'rejected', topic: 'reject/me', payload: '{}', deliveryMode: 'DIRECT' })
    const res = await runAndWait(POST, { testCaseIds: [testCase.ID, rejecting.ID], brokerIds: [goodBroker.ID] })
    expect(res.status).toBe(200)
    const { data } = await GET(`/odata/v4/test/RunResults?$filter=run_ID eq ${res.data.runId}`, tester)
    const statuses = data.value.map((r: { testCaseName: string; status: string }) => `${r.testCaseName}:${r.status}`).sort()
    expect(statuses).toEqual(['Order created:PASSED', 'rejected:FAILED'])
    const { data: stats } = await GET('/odata/v4/test/TestCaseStats', tester)
    const byCase = Object.fromEntries(stats.value.map((x: { testCase_ID: string; status: string }) => [x.testCase_ID, x.status]))
    expect(byCase[testCase.ID]).toBe('PASSED')
    expect(byCase[rejecting.ID]).toBe('FAILED')
  })

  it('marks a run that crashed as FAILED, so it neither shows as running nor blocks run slots', async () => {
    const crash = jest.spyOn(testCaseSpec, 'loadTestCases').mockRejectedValueOnce(new Error('database gone'))
    try {
      const res = await runAndWait(POST, { testCaseIds: [testCase.ID], brokerIds: [goodBroker.ID] })
      expect(res.status).toBe(200)
      const { data: run } = await GET(`/odata/v4/test/TestRuns(${res.data.runId})?$expand=results`, tester)
      expect(run).toMatchObject({ status: 'FAILED', outcome: 'FAILED', statusCriticality: 1, passedCount: 0, failedCount: 1 })
      expect(run.finishedAt).toBeTruthy()
      expect(run.results).toEqual([expect.objectContaining({ status: 'ERROR', errorMessage: 'Run aborted: database gone' })])
    } finally {
      crash.mockRestore()
    }
  })

  it('ends runs left RUNNING by a server restart', async () => {
    const ID = cds.utils.uuid()
    await INSERT.into('aem.suite.TestRuns').entries({ ID, status: 'RUNNING', totalCount: 1 })
    await INSERT.into('aem.suite.RunResults').entries({ run_ID: ID, testCase_ID: testCase.ID, status: 'PENDING' })
    await failRuns({}, 'The server restarted while the run was in progress')
    expect(await SELECT.one.from('aem.suite.TestRuns', ID)).toMatchObject({ status: 'FAILED', failedCount: 1 })
    expect(await SELECT.one.from('aem.suite.RunResults').where({ run_ID: ID })).toMatchObject({
      status: 'ERROR',
      errorMessage: 'The server restarted while the run was in progress'
    })
  })

  it('validates run input', async () => {
    const noBroker = await POST('/odata/v4/test/runTests', { testCaseIds: [testCase.ID], brokerIds: [] }, tester)
    expect(noBroker.status).toBe(400)
    expect(noBroker.data.error.message).toBe('Select at least one broker')
    const noTest = await POST('/odata/v4/test/runTests', { testCaseIds: [], brokerIds: [goodBroker.ID] }, tester)
    expect(noTest.data.error.message).toBe('Select at least one test case or folder')
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
    // placed behind the existing top-level nodes, like a test case created in the UI
    const top = (await SELECT.from('aem.suite.TestCases').columns('ID', 'sortOrder').where({ parent_ID: null })) as { ID: string; sortOrder: number }[]
    expect(Math.max(...top.map((t) => t.sortOrder))).toBe(top.find((t) => t.ID === data.ID)!.sortOrder)
  })

  it('lets testers delete only their own saved messages, and nobody change one', async () => {
    const save = async (auth: object) =>
      (await POST('/odata/v4/subscribe/ReceivedMessages', { broker_ID: goodBroker.ID, source: 'a/>', sourceType: 'TOPIC', topic: 'a/b', payload: '{}' }, auth)).data
    const ofAdmin = await save(admin)
    const ofTester = await save(tester)
    const url = (id: string) => `/odata/v4/subscribe/ReceivedMessages(${id})`
    // everybody sees all saved messages and can make a test case of any
    expect((await GET(url(ofAdmin.ID), tester)).status).toBe(200)
    expect((await POST(`${url(ofAdmin.ID)}/SubscribeService.createTestCase`, {}, tester)).status).toBe(200)
    expect((await PATCH(url(ofTester.ID), { topic: 'changed' }, tester)).status).toBe(405)
    expect((await PATCH(url(ofTester.ID), { topic: 'changed' }, admin)).status).toBe(405)
    expect((await DEL(url(ofAdmin.ID), tester)).status).toBe(403)
    expect((await DEL(url(ofTester.ID), tester)).status).toBe(204)
    // administrators clean up any
    const another = await save(tester)
    expect((await DEL(url(another.ID), admin)).status).toBe(204)
    expect(await SELECT.one.from('aem.suite.ReceivedMessages', ofAdmin.ID)).toMatchObject({ topic: 'a/b' })
  })

  it('applies the test case rules to messages saved from a queue', async () => {
    const { data: msg, status } = await POST(
      '/odata/v4/subscribe/ReceivedMessages',
      {
        broker_ID: goodBroker.ID,
        source: 'orders',
        sourceType: 'QUEUE_BROWSE',
        topic: 'acme/orders/eu',
        payload: 'plain text',
        userProperties: JSON.stringify({ note: 'x'.repeat(1500) }),
        deliveryMode: 'NON_PERSISTENT'
      },
      tester
    )
    expect(status).toBe(201)
    const res = await POST(`/odata/v4/subscribe/ReceivedMessages(${msg.ID})/SubscribeService.createTestCase`, {}, tester)
    expect(res.status).toBe(400)
    expect(res.data.error.message).toBe('userProperties(0)/value: user property "note" value is too long (1500 characters, maximum 1000)')
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

  it('starts, keeps alive, lists and stops a live subscription', async () => {
    setSessionFactory(async () => new FakeSubscriberSession())
    try {
      const started = await POST('/odata/v4/subscribe/start', { brokerId: goodBroker.ID, sourceType: 'TOPIC', topics: ['a/>'], password: 'pw' }, tester)
      expect(started.status).toBe(200)
      const { subscriptionId } = started.data
      const heartbeat = async (auth: object) => (await POST('/odata/v4/subscribe/heartbeat', { subscriptionId }, auth)).data.active
      const active = async (auth: object) => (await GET('/odata/v4/subscribe/activeSubscriptions()', auth)).data.value
      expect(await active(tester)).toEqual([expect.objectContaining({ subscriptionId, brokerName: 'dev', sourceType: 'TOPIC', source: 'a/>' })])
      expect(await active(admin)).toEqual([])
      expect(await heartbeat(tester)).toBe(true)
      // only the owner keeps it alive
      expect(await heartbeat(admin)).toBe(false)
      expect((await POST('/odata/v4/subscribe/stop', { subscriptionId }, admin)).status).toBe(403)
      expect((await POST('/odata/v4/subscribe/stop', { subscriptionId }, tester)).status).toBeLessThan(300)
      expect(await heartbeat(tester)).toBe(false)
      expect(await active(tester)).toEqual([])
    } finally {
      await stopAll()
      setSessionFactory()
    }
  })

  it('lets admins update brokers via draft edit', async () => {
    await draft.edit(POST, 'admin', 'Brokers', goodBroker.ID, admin)
    await PATCH(`/odata/v4/admin/Brokers(ID=${goodBroker.ID},IsActiveEntity=false)`, { description: 'changed' }, admin)
    const res = await draft.activate(POST, 'admin', 'Brokers', goodBroker.ID, admin)
    expect(res.status).toBe(200)
    const row = await SELECT.one.from('aem.suite.Brokers', goodBroker.ID)
    expect(row.description).toBe('changed')
  })

  it('starts new test cases from a template and fills empty types on save', async () => {
    const { data: created } = await POST('/odata/v4/test/TestCases', {}, tester)
    expect(created.payload).toContain('"id": "{{uuid}}"')
    expect(created.correlationId).toBe('{{uuid}}')
    expect(created.priority ?? null).toBeNull()

    await PATCH(
      `/odata/v4/test/TestCases(ID=${created.ID},IsActiveEntity=false)`,
      { name: 'auto', topic: 'a/b', payload: 'plain text {{uuid}}', contentType: null },
      tester
    )
    for (const [name, value] of [['n', '42'], ['b', 'true'], ['s', 'x'], ['t', '{{qty}}']])
      await POST(`/odata/v4/test/TestCases(ID=${created.ID},IsActiveEntity=false)/userProperties`, { name, value }, tester)
    const res = await draft.activate(POST, 'test', 'TestCases', created.ID)
    expect(res.status).toBe(201)
    const { data: tc } = await GET(
      `/odata/v4/test/TestCases(ID=${created.ID},IsActiveEntity=true)?$expand=userProperties`,
      tester
    )
    expect(tc.contentType).toBe('text/plain')
    const types = Object.fromEntries(tc.userProperties.map((p: { name: string; type: string }) => [p.name, p.type]))
    expect(types).toEqual({ n: 'INT', b: 'BOOL', s: 'STRING', t: 'STRING' })
  })

  it('takes the name from the topic until the user names the test case', async () => {
    const { data: created } = await POST('/odata/v4/test/TestCases', {}, tester)
    expect(created.contentType).toBe('application/json')
    const url = `/odata/v4/test/TestCases(ID=${created.ID},IsActiveEntity=false)`

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
    const res = await draft.activate(POST, 'test', 'TestCases', d2.ID)
    expect(res.status).toBe(201)
    expect(res.data.name).toBe('x/y')
  })

  it('previews a draft while it is being edited', async () => {
    const { data: created } = await POST('/odata/v4/test/TestCases', { topic: 'draft/{{region}}' }, tester)
    const { data, status } = await POST(
      `/odata/v4/test/TestCases(ID=${created.ID},IsActiveEntity=false)/TestService.preview`,
      { brokerId: goodBroker.ID },
      tester
    )
    expect(status).toBe(200)
    expect(data).toMatchObject({ valid: true, topic: 'draft/eu' })
  })

  it('lists destinations for the value help', () =>
    withDestinations(
      [
        { name: 'aem-dev', url: 'https://mr-dev.messaging.solace.cloud:443', username: 'u', password: 'p', msgVpn: 'dev' },
        // the connection accepts the aem. prefix - the value help must too
        { name: 'aem-prefixed', url: 'ftp://ignored', 'aem.smfUrl': 'tcps://mr-x:55443', 'aem.msgVpn': 'x' },
        { name: 'some-http-api', url: 'ftp://not-a-broker' }
      ],
      async () => {
        const { data } = await GET('/odata/v4/admin/Destinations', admin)
        expect(data.value).toEqual([
          expect.objectContaining({ name: 'aem-dev', msgVpn: 'dev', source: 'ENV', authentication: 'BasicAuthentication' }),
          expect.objectContaining({ name: 'aem-prefixed', url: 'tcps://mr-x:55443', msgVpn: 'x' })
        ])
        const { data: search } = await GET('/odata/v4/admin/Destinations?$search=nothing', admin)
        expect(search.value).toEqual([])
        // one by its key (the value help reads the selected destination)
        const { data: one } = await GET("/odata/v4/admin/Destinations('aem-dev')", admin)
        expect(one).toMatchObject({ name: 'aem-dev', msgVpn: 'dev' })
      }
    ))
})
