import cds from '@sap/cds'
import { currentJwt, loadBroker } from './lib/credentials/resolve'
import { buildSpec, loadVariableScopes, scopeFor, TestCaseRecord } from './lib/test-case-spec'
import { BrokerCredential, createRun, executeRunInBackground, toPasswords } from './lib/test-runner'
import { detectContentType, inferPropertyType, STARTER_CORRELATION_ID, STARTER_PAYLOAD } from './lib/defaults'

const VAR_NAME = /^[A-Za-z_][\w.-]*$/

export default class TestService extends cds.ApplicationService {
  async init() {
    const { TestCases } = this.entities

    // starter template for new test cases (not for copies / test cases created from messages)
    this.before('NEW', TestCases.drafts!, (req) => {
      const d = req.data as Partial<TestCaseRecord>
      d.payload ??= STARTER_PAYLOAD
      d.correlationId ??= STARTER_CORRELATION_ID
    })

    // name follows the topic while editing, until the user enters an own name
    this.before('UPDATE', TestCases.drafts!, async (req) => {
      const d = req.data as Partial<TestCaseRecord>
      if (d.topic === undefined || d.name !== undefined) return
      const draft = (await SELECT.one
        .from(TestCases.drafts!)
        .columns('name', 'topic')
        .where({ ID: d.ID ?? keyOf(req).ID })) as { name?: string | null; topic?: string | null } | undefined
      if (!draft?.name || draft.name === draft.topic) d.name = (d.topic ?? '').slice(0, 200)
    })

    this.before(['CREATE', 'UPDATE'], TestCases, (req) => {
      const d = req.data as TestCaseRecord
      // fill what was left empty
      if (!d.name && d.topic) d.name = d.topic.slice(0, 200)
      if (!d.contentType && d.payload !== undefined) d.contentType = detectContentType(d.payload)
      d.userProperties?.forEach((p) => {
        if (!p.type) p.type = inferPropertyType(p.value)
      })
      if (d.payload) {
        // placeholders are replaced by 0 so templated numbers ({{count}}) stay valid JSON
        const probe = d.payload.replace(/\{\{[^}]*\}\}/g, '0')
        const isJson = !d.contentType || /json/i.test(d.contentType)
        if (isJson) {
          try {
            JSON.parse(probe)
          } catch (e) {
            req.error(400, `Payload is not valid JSON: ${(e as Error).message}`, 'in/payload')
          }
        }
      }
      if (d.ackTimeoutMs != null && (d.ackTimeoutMs < 100 || d.ackTimeoutMs > 120000))
        req.error(400, 'ACK timeout must be between 100 and 120000 ms', 'in/ackTimeoutMs')
      if (d.priority != null && (d.priority < 0 || d.priority > 255))
        req.error(400, 'Priority must be between 0 and 255', 'in/priority')

      const seen = new Set<string>()
      d.userProperties?.forEach((p, i) => {
        if (seen.has(p.name)) req.error(400, `Duplicate user property "${p.name}"`, `in/userProperties(${i})/name`)
        seen.add(p.name)
        const templated = /\{\{/.test(p.value ?? '')
        if (p.type === 'INT' && !templated && !/^-?\d+$/.test(p.value ?? ''))
          req.error(400, `User property "${p.name}" must be an integer`, `in/userProperties(${i})/value`)
        if (p.type === 'BOOL' && !templated && !/^(true|false|1|0|yes|no)$/i.test(p.value ?? ''))
          req.error(400, `User property "${p.name}" must be true or false`, `in/userProperties(${i})/value`)
      })
      const seenVars = new Set<string>()
      d.variables?.forEach((v, i) => {
        if (!VAR_NAME.test(v.name ?? '')) req.error(400, `Invalid variable name "${v.name}"`, `in/variables(${i})/name`)
        if (seenVars.has(v.name)) req.error(400, `Duplicate variable "${v.name}"`, `in/variables(${i})/name`)
        seenVars.add(v.name)
      })
    })

    this.on('runTest', TestCases, async (req) => {
      const { brokerIds, credentials } = req.data as { brokerIds: string[]; credentials?: BrokerCredential[] }
      return startRun(req, [keyOf(req).ID], brokerIds, credentials)
    })

    this.on('runTests', async (req) => {
      const { testCaseIds, brokerIds, credentials } = req.data as {
        testCaseIds: string[]
        brokerIds: string[]
        credentials?: BrokerCredential[]
      }
      return startRun(req, testCaseIds, brokerIds, credentials)
    })

    // preview works on saved test cases and on drafts (lean draft routes draft calls to TestCases.drafts)
    this.on('preview', [TestCases, TestCases.drafts!], async (req) => {
      const { ID, IsActiveEntity } = keyOf(req)
      const { brokerId } = req.data as { brokerId?: string }
      const source = IsActiveEntity === false ? TestCases.drafts! : TestCases
      const tc = (await SELECT.one.from(source, ID, (t: any) => {
        t`.*`
        t.userProperties((p: any) => p`.*`)
        t.variables((v: any) => v`.*`)
      })) as TestCaseRecord | null
      if (!tc) return req.error(404, 'Test case not found')

      try {
        const broker = brokerId ? await loadBroker(brokerId) : undefined
        const vars = await loadVariableScopes(broker ? [broker.ID] : [])
        const spec = buildSpec(tc, scopeFor(tc, broker, vars))
        return {
          topic: spec.topic,
          payload: prettyJson(spec.payload),
          correlationId: spec.correlationId ?? null,
          userProperties: JSON.stringify(
            Object.fromEntries((spec.userProperties ?? []).map((p) => [p.name, p.value])),
            null,
            2
          ),
          valid: true,
          message: broker ? `Resolved for broker ${broker.name}` : 'Resolved with global variables only'
        }
      } catch (e) {
        return { valid: false, message: (e as Error).message }
      }
    })

    this.on('duplicate', TestCases, async (req) => {
      const { ID } = keyOf(req)
      const tc = (await SELECT.one.from('aem.suite.TestCases', ID, (t: any) => {
        t`.*`
        t.userProperties((p: any) => p`.*`)
        t.variables((v: any) => v`.*`)
      })) as (TestCaseRecord & Record<string, unknown>) | null
      if (!tc) return req.error(404, 'Test case not found')
      const newId = cds.utils.uuid()
      const strip = (row: Record<string, unknown>, keys: string[]) =>
        Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)))
      const child = ['ID', 'testCase_ID']
      await INSERT.into('aem.suite.TestCases').entries({
        ...strip(tc, ['createdAt', 'createdBy', 'modifiedAt', 'modifiedBy']),
        ID: newId,
        name: `${tc.name} (Copy)`.slice(0, 200),
        userProperties: (tc.userProperties ?? []).map((p) => strip(p as unknown as Record<string, unknown>, child)),
        variables: (tc.variables ?? []).map((v) => strip(v as unknown as Record<string, unknown>, child))
      })
      return SELECT.one.from(TestCases, newId)
    })

    return super.init()
  }
}

async function startRun(req: cds.Request, testCaseIds: string[], brokerIds: string[], credentials?: BrokerCredential[]) {
  // passwords stay in memory of this run only - never persisted or logged
  const passwords = toPasswords(credentials)
  const runId = await createRun(testCaseIds, brokerIds, passwords)
  const jwt = currentJwt()
  // execute after the run rows are committed
  req.on('succeeded', () => void executeRunInBackground(runId, jwt, passwords))
  req.info(200, 'Test run started - see "Test Runs" for results')
  return { runId }
}

function keyOf(req: cds.Request): { ID: string; IsActiveEntity?: boolean } {
  const p = req.params[0] as unknown
  return typeof p === 'string' ? { ID: p } : (p as { ID: string; IsActiveEntity?: boolean })
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}
