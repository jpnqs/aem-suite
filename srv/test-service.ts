import cds from '@sap/cds'
import { currentJwt, loadBroker } from './lib/credentials/resolve'
import { buildSpec, loadVariableScopes, scopeFor, TestCaseRecord } from './lib/test-case-spec'
import { BrokerCredential, createRun, executeRunInBackground, toCredentials } from './lib/test-runner'
import { detectContentType, inferPropertyType, STARTER_CORRELATION_ID, STARTER_PAYLOAD } from './lib/defaults'
import { copyNodes } from './lib/copy-nodes'
import { compareSiblings, loadTree, TreeNode } from './lib/tree'

const VAR_NAME = /^[A-Za-z_][\w.-]*$/

export default class TestService extends cds.ApplicationService {
  async init() {
    const { TestCases } = this.entities

    // starter template for new test cases (not for folders, copies or test cases created from messages)
    this.before('NEW', TestCases.drafts!, (req) => {
      const d = req.data as Partial<TestCaseRecord>
      if (d.kind === 'FOLDER') return
      d.payload ??= STARTER_PAYLOAD
      d.correlationId ??= STARTER_CORRELATION_ID
    })

    // name follows the topic while editing, until the user enters an own name
    this.before('UPDATE', TestCases.drafts!, async (req) => {
      const d = req.data as Partial<TestCaseRecord>
      if (d.topic === undefined || d.name !== undefined) return
      const draft = (await SELECT.one
        .from(TestCases.drafts!)
        .columns('name', 'topic', 'kind')
        .where({ ID: d.ID ?? keyOf(req).ID })) as { name?: string | null; topic?: string | null; kind?: string } | undefined
      if (draft?.kind === 'FOLDER') return
      if (!draft?.name || draft.name === draft.topic) d.name = (d.topic ?? '').slice(0, 200)
    })

    // tree: parent must be a folder and must not be the node itself or below it; new nodes go to the end
    this.before(['CREATE', 'UPDATE'], TestCases, async (req) => {
      const d = req.data as TestCaseRecord & { sortOrder?: number | null }
      const id = d.ID ?? keyOf(req).ID
      if (d.parent_ID !== undefined && d.parent_ID !== null) {
        const tree = await loadTree()
        const parent = tree.byId.get(d.parent_ID)
        if (!parent) return req.error(400, 'Parent folder not found', 'in/parent_ID')
        if (parent.kind !== 'FOLDER') return req.error(400, 'Test cases can only be placed in folders', 'in/parent_ID')
        if (id && tree.isWithin(d.parent_ID, id)) return req.error(400, 'A folder cannot be moved into itself', 'in/parent_ID')
      }
      if (req.event === 'CREATE' && !d.sortOrder) {
        const siblings = (await SELECT.from('aem.suite.TestCases')
          .columns('sortOrder')
          .where({ parent_ID: d.parent_ID ?? null })) as { sortOrder: number | null }[]
        d.sortOrder = Math.max(0, ...siblings.map((x) => x.sortOrder ?? 0)) + 10
      }
    })

    this.before(['CREATE', 'UPDATE'], TestCases, (req) => {
      const d = req.data as TestCaseRecord
      const isFolder = d.kind === 'FOLDER'
      if (isFolder) {
        if ((req.event === 'CREATE' || d.name !== undefined) && !d.name?.trim())
          req.error(400, 'Folder name is required', 'in/name')
      } else if (d.kind === 'TEST' || req.event === 'CREATE') {
        if (!d.topic?.trim()) req.error(400, 'Topic is required', 'in/topic')
      }
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

    // drag & drop: place the node before NextSibling (null = at the end).
    // Fiori sends the parent change (PATCH) in the same $batch change set, which may be processed
    // concurrently - so the target parent is derived from NextSibling, not from the node itself.
    this.on('moveBefore', TestCases, async (req) => {
      const { ID } = keyOf(req)
      const nextId = (req.data as { NextSibling?: { ID?: string } | null }).NextSibling?.ID ?? null
      type Row = TreeNode & { modifiedAt: string; modifiedBy: string }
      const cols = ['ID', 'parent_ID', 'kind', 'name', 'sortOrder', 'modifiedAt', 'modifiedBy']
      const node = (await SELECT.one.from('aem.suite.TestCases').columns(...cols).where({ ID })) as Row | undefined
      if (!node) return req.error(404, 'Node not found')
      const keep = (r: Row) => ({ modifiedAt: r.modifiedAt, modifiedBy: r.modifiedBy }) // reordering is no content change

      if (!nextId) {
        // last position in whatever folder the node ends up in
        const max = (await SELECT.one.from('aem.suite.TestCases').columns('max(sortOrder) as max')) as { max: number | null }
        await UPDATE('aem.suite.TestCases', ID).with({ sortOrder: (max?.max ?? 0) + 10, ...keep(node) })
        return
      }
      const next = (await SELECT.one.from('aem.suite.TestCases').columns('ID', 'parent_ID').where({ ID: nextId })) as
        | { ID: string; parent_ID: string | null }
        | undefined
      if (!next) return req.error(404, 'Next sibling not found')
      const siblings = ((await SELECT.from('aem.suite.TestCases')
        .columns(...cols)
        .where({ parent_ID: next.parent_ID ?? null })) as Row[])
        .filter((x) => x.ID !== ID)
        .sort(compareSiblings)
      const order: Row[] = [...siblings]
      order.splice(Math.max(0, siblings.findIndex((x) => x.ID === nextId)), 0, node)
      for (const [i, row] of order.entries()) {
        await UPDATE('aem.suite.TestCases', row.ID).with({ sortOrder: (i + 1) * 10, ...keep(row) })
      }
    })

    this.on('runTest', TestCases, async (req) => {
      const { brokerIds, credentials } = req.data as { brokerIds: string[]; credentials?: BrokerCredential[] }
      return startRun(req, [keyOf(req).ID], brokerIds, credentials)
    })

    this.on('currentUser', (req) => req.user.id)

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

    // copy of a test case or a folder (with everything below it), placed right after the original
    this.on('duplicate', TestCases, async (req) => {
      const [copy] = await copyNodes([keyOf(req).ID])
      return SELECT.one.from(TestCases, copy.ID)
    })

    this.on('copyNodes', async (req) => copyNodes((req.data as { ids: string[] }).ids))

    return super.init()
  }
}

async function startRun(req: cds.Request, testCaseIds: string[], brokerIds: string[], credentials?: BrokerCredential[]) {
  // passwords (and entered usernames) stay in memory of this run only - never persisted or logged
  const entered = toCredentials(credentials)
  const runId = await createRun(testCaseIds, brokerIds, entered)
  const jwt = currentJwt()
  // execute after the run rows are committed
  req.on('succeeded', () => void executeRunInBackground(runId, jwt, entered))
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
