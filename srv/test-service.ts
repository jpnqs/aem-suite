import cds from '@sap/cds'
import { currentJwt } from './lib/credentials/resolve'
import { TestCaseRecord } from './lib/test-case-spec'
import { buildPreview } from './lib/preview'
import { BrokerCredential, createRun, executeRunInBackground, toCredentials } from './lib/test-runner'
import { STARTER_CORRELATION_ID, STARTER_PAYLOAD } from './lib/defaults'
import { copyNodes } from './lib/copy-nodes'
import { exportNodes, importNodes } from './lib/export-import'
import { nextSortOrder, NodeData, Reject, validateNode, validateParent } from './lib/node-validation'
import { compareSiblings, TreeNode } from './lib/tree'

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
    // (the rules live in lib/node-validation.ts - the AI agent service applies the same ones)
    this.before(['CREATE', 'UPDATE'], TestCases, async (req) => {
      const d = req.data as NodeData
      const reject: Reject = (status, message, target) => req.error(status, message, target)
      if (!(await validateParent(d, d.ID ?? keyOf(req).ID, reject))) return
      if (req.event === 'CREATE' && !d.sortOrder) d.sortOrder = await nextSortOrder(d.parent_ID)
    })

    this.before(['CREATE', 'UPDATE'], TestCases, (req) => {
      validateNode(req.data as NodeData, req.event, (status, message, target) => req.error(status, message, target))
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
      return buildPreview(tc, brokerId)
    })

    // copy of a test case or a folder (with everything below it), placed right after the original
    this.on('duplicate', TestCases, async (req) => {
      const [copy] = await copyNodes([keyOf(req).ID])
      return SELECT.one.from(TestCases, copy.ID)
    })

    this.on('copyNodes', async (req) => copyNodes((req.data as { ids: string[] }).ids))

    // export / import as JSON file (the file content travels in the action, the browser saves / reads the file)
    this.on('exportNodes', async (req) => exportNodes((req.data as { ids?: string[] }).ids))
    this.on('importNodes', async (req) => {
      const { content, parentId, dryRun } = req.data as { content: string; parentId?: string; dryRun?: boolean }
      return importNodes(content, { parentId, dryRun: !!dryRun })
    })

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
