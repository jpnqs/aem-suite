import cds from '@sap/cds'
import { applyAutomaticRules, RETENTION_USER } from '../srv/lib/cleanup/retention'
import { masked } from '../srv/lib/core/errors'
import { setConnector } from '../srv/lib/solace/connector'
import { createActive, fakeBroker, mcpRpc, resetDatabase, runAndWait, startServer, users } from './helpers'

const { GET, POST, DELETE: DEL } = startServer()
const { admin, tester } = users

const auditOf = async (filter: string) =>
  (await GET(`/odata/v4/admin/AuditLog?$filter=${encodeURIComponent(filter)}&$orderby=at desc`, admin)).data.value as Record<string, string>[]

describe('audit log, production brokers, secrets, retention', () => {
  fakeBroker()
  let broker: { ID: string }

  beforeAll(async () => {
    await resetDatabase()
    await DELETE.from('aem.suite.AuditLog')
    broker = await createActive(POST, 'admin', 'Brokers', { name: 'dev', credentialMode: 'DIRECT', url: 'dev.example', msgVpn: 'vpn', username: 'u' }, admin)
  })

  describe('audit log', () => {
    it('logs saves with the changed fields, not drafts and not values', async () => {
      const [created] = await auditOf(`target eq 'Brokers' and action eq 'CREATE'`)
      expect(created).toMatchObject({ user: 'admin', service: 'AdminService', targetId: broker.ID, name: 'dev' })
      expect(created.details).toContain('url')
      expect(created.details).not.toContain('dev.example')
      // a draft that is never saved leaves no entry
      await POST('/odata/v4/admin/Brokers', { name: 'never saved' }, admin)
      expect(await auditOf(`name eq 'never saved'`)).toEqual([])
    })

    it('logs runs and deletes with what they were done to, never passwords', async () => {
      const tc = await createActive(POST, 'test', 'TestCases', { topic: 'audit/a', payload: '{}' })
      await runAndWait(POST, { testCaseIds: [tc.ID], brokerIds: [broker.ID], credentials: [{ brokerId: broker.ID, password: 'top-secret-pw' }] })
      const [run] = await auditOf(`action eq 'runTests'`)
      expect(run).toMatchObject({ user: 'tester', service: 'TestService' })
      expect(run.details).toMatch(/testCaseIds: 1, brokerIds: 1, .*runId: [0-9a-f-]+/)
      const all = JSON.stringify((await GET('/odata/v4/admin/AuditLog', admin)).data)
      expect(all).not.toContain('top-secret-pw')

      await DEL(`/odata/v4/test/TestCases(ID=${tc.ID},IsActiveEntity=true)`, tester)
      expect(await auditOf(`action eq 'DELETE' and targetId eq '${tc.ID}'`)).toHaveLength(1)
      // reading is not logged
      expect(await auditOf(`action eq 'READ'`)).toEqual([])
    })

    it('is for administrators only and cannot be changed', async () => {
      expect((await GET('/odata/v4/admin/AuditLog', tester)).status).toBe(403)
      const [entry] = await auditOf(`action eq 'CREATE'`)
      expect((await DEL(`/odata/v4/admin/AuditLog(${entry.ID})`, admin)).status).toBe(405)
    })
  })

  describe('production brokers', () => {
    let prod: { ID: string }
    let tc: { ID: string }
    beforeAll(async () => {
      prod = await createActive(
        POST,
        'admin',
        'Brokers',
        { name: 'prod', credentialMode: 'DESTINATION', destinationName: 'aem-prod', production: true },
        admin
      )
      tc = await createActive(POST, 'test', 'TestCases', { topic: 'prod/a', payload: '{}' })
    })

    it('runs only with the confirmation', async () => {
      const refused = await POST('/odata/v4/test/runTests', { testCaseIds: [tc.ID], brokerIds: [prod.ID] }, tester)
      expect(refused.status).toBe(400)
      expect(refused.data.error.message).toBe('prod is a production broker - confirm sending to production to run')
      const confirmed = await POST('/odata/v4/test/runTests', { testCaseIds: [tc.ID], brokerIds: [prod.ID], options: { confirmProduction: true } }, tester)
      expect(confirmed.status).toBe(200)
    })

    it('is never available to AI agents', async () => {
      const res = await mcpRpc(POST, 'tools/call', { name: 'TestAgentService-call', arguments: { action: 'runTests', parameters: { testCaseIds: [tc.ID], brokerIds: [prod.ID] } } })
      expect(JSON.stringify(res.body)).toMatch(/never production brokers/)
    })

    it('only administrators consume from its queues', async () => {
      const consume = { brokerId: prod.ID, sourceType: 'QUEUE_CONSUME', queue: 'q' }
      const res = await POST('/odata/v4/subscribe/start', consume, tester)
      expect(res.status).toBe(403)
      expect(res.data.error.message).toMatch(/only administrators consume from its queues/)
    })
  })

  describe('secrets', () => {
    it('masks a password in error texts', () => {
      expect(masked('Connect failed: bad login for user u / pw s3cret!', 's3cret!')).toBe('Connect failed: bad login for user u / pw ***')
      expect(masked('a b', 'ab')).toBe('a b')
      expect(masked('nothing', undefined)).toBe('nothing')
    })

    it('a broker library that repeats the password does not bring it into the results', async () => {
      setConnector(async (conn) => {
        throw new Error(`Connect failed for ${conn.userName}:${conn.password}`)
      })
      try {
        const tc = await createActive(POST, 'test', 'TestCases', { topic: 'secret/a', payload: '{}' })
        const res = await runAndWait(POST, { testCaseIds: [tc.ID], brokerIds: [broker.ID], credentials: [{ brokerId: broker.ID, password: 'hunter22' }] })
        const { data } = await GET(`/odata/v4/test/RunResults?$filter=run_ID eq ${res.data.runId}`, tester)
        expect(data.value[0].errorMessage).toBe('Connect failed for u:***')
      } finally {
        setConnector()
      }
    })
  })

  describe('retention', () => {
    it('applies the automatic cleanup rules and logs them', async () => {
      await INSERT.into('aem.suite.ReceivedMessages').entries([
        { ID: cds.utils.uuid(), topic: 'old/1', payload: '{}', receivedAt: '2020-01-01T00:00:00Z' },
        { ID: cds.utils.uuid(), topic: 'new/1', payload: '{}', receivedAt: new Date().toISOString() }
      ])
      const request = JSON.stringify({ messages: { age: { value: 30, unit: 'DAYS' } } })
      await INSERT.into('aem.suite.CleanupRules').entries([
        { ID: cds.utils.uuid(), name: 'old messages', request, automatic: true },
        { ID: cds.utils.uuid(), name: 'manual only', request: JSON.stringify({ messages: { age: { value: 1, unit: 'DAYS' } } }), automatic: false }
      ])
      const before = Number((await SELECT.one.from('aem.suite.ReceivedMessages').columns('count(1) as n')).n)
      expect(await applyAutomaticRules()).toBeGreaterThanOrEqual(1)
      const after = Number((await SELECT.one.from('aem.suite.ReceivedMessages').columns('count(1) as n')).n)
      expect(before - after).toBeGreaterThanOrEqual(1)
      expect(await SELECT.one.from('aem.suite.ReceivedMessages').where({ topic: 'new/1' })).toBeTruthy()
      const log = await SELECT.one.from('aem.suite.CleanupLogs').where({ ruleName: 'old messages' })
      expect(log).toMatchObject({ status: 'DONE', createdBy: RETENTION_USER })
    })
  })
})
