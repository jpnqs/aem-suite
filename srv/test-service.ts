import cds from '@sap/cds'
import { TestCases as TestCaseRows, TestCaseStats } from '#cds-models/aem/suite'
import { buildPreview } from './lib/runs/preview'
import { templateHints } from './lib/runs/template-hints'
import { BrokerCredential, cancelRun, RunOptions, startRun, toCredentials } from './lib/runs/test-runner'
import { STARTER_CORRELATION_ID, STARTER_PAYLOAD } from './lib/core/defaults'
import { copyNodes } from './lib/testcases/copy-nodes'
import { documentationFromHtml, renderDocumentation } from './lib/testcases/documentation'
import { exportNodes, importNodes } from './lib/testcases/export-import'
import { compareRuns } from './lib/runs/compare'
import { nextSortOrder, NodeData, Reject, validateNode, validateParent } from './lib/testcases/node-validation'
import { selectNodeDeep } from './lib/testcases/nodes'
import { columnLength } from './lib/core/model'
import { idOf, keyOf } from './lib/core/request'
import type { TestCaseRecord } from './lib/runs/test-case-spec'
import { moveBefore } from './lib/testcases/tree'

type Documented = { description?: string | null; descriptionHtml?: string | null }

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
    // (the UI refreshes the name through the side effect in app/testcases/annotations.cds)
    this.before('UPDATE', TestCases.drafts!, async (req) => {
      const d = req.data as Partial<TestCaseRecord>
      if (d.topic === undefined || d.name !== undefined) return
      const draft = (await SELECT.one
        .from(TestCases.drafts!)
        .columns('name', 'topic', 'kind')
        .where({ ID: d.ID ?? keyOf(req).ID })) as { name?: string | null; topic?: string | null; kind?: string } | undefined
      if (draft?.kind === 'FOLDER') return
      if (!draft?.name || draft.name === draft.topic) d.name = (d.topic ?? '').slice(0, columnLength('TestCases', 'name'))
    })

    // the rules live in lib/testcases/node-validation.ts - the AI agent service, the import and the live view apply the same ones:
    // parent must be a folder and must not be the node itself or below it; new nodes go to the end
    this.before(['CREATE', 'UPDATE'], TestCases, async (req) => {
      const d = req.data as NodeData
      const reject: Reject = (status, message, target) => req.error(status, message, target)
      const parentOk = await validateParent(d, d.ID ?? keyOf(req).ID, reject)
      if (parentOk && req.event === 'CREATE' && !d.sortOrder) d.sortOrder = await nextSortOrder(d.parent_ID)
      validateNode(d, req.event, reject)
    })

    // documentation: stored as Markdown (description), edited as HTML in the rich text editor of the object page
    // (descriptionHtml) - lib/testcases/documentation.ts converts both ways
    this.before('UPDATE', TestCases.drafts!, (req) => {
      const d = req.data as Documented
      if (d.descriptionHtml === undefined) return
      d.description = documentationFromHtml(d.descriptionHtml)
      delete d.descriptionHtml
    })
    this.before('READ', [TestCases, TestCases.drafts!], (req) => {
      const columns = (req.query as { SELECT?: { columns?: { ref?: string[] }[] } }).SELECT?.columns
      const has = (name: string) => columns?.some((c) => c.ref?.length === 1 && c.ref[0] === name)
      if (columns && has('descriptionHtml') && !has('description')) columns.push({ ref: ['description'] })
    })
    this.after(['READ', 'UPDATE'], [TestCases, TestCases.drafts!], (rows) => {
      for (const row of (Array.isArray(rows) ? rows : [rows]) as (Documented | undefined)[])
        if (row && typeof row === 'object' && row.description !== undefined) row.descriptionHtml = renderDocumentation(row.description)
    })

    // the latest outcome of a test case is an association (not part of the draft): remove the stats of deleted nodes
    // (a folder deletes everything below it)
    this.after('DELETE', TestCases, async () => {
      await DELETE.from(TestCaseStats).where({ testCase_ID: { 'not in': SELECT('ID').from(TestCaseRows) } })
    })

    // drag & drop: place the node before NextSibling (null = at the end)
    this.on('moveBefore', TestCases, async (req) => {
      const nextId = (req.data as { NextSibling?: { ID?: string } | null }).NextSibling?.ID ?? null
      await moveBefore(idOf(req), nextId)
    })

    this.on('runTest', TestCases, async (req) => {
      const { brokerIds, credentials, options } = req.data as { brokerIds: string[]; credentials?: BrokerCredential[]; options?: RunOptions }
      return runFromUi(req, [idOf(req)], brokerIds, credentials, options)
    })

    this.on('currentUser', (req) => req.user.id)

    this.on('runTests', async (req) => {
      const { testCaseIds, brokerIds, credentials, options } = req.data as {
        testCaseIds: string[]
        brokerIds: string[]
        credentials?: BrokerCredential[]
        options?: RunOptions
      }
      return runFromUi(req, testCaseIds, brokerIds, credentials, options)
    })

    this.on('cancelRun', async (req) => {
      const { runId } = req.data as { runId: string }
      await cancelRun(runId, req.user)
      req.info(200, 'The run is being stopped - messages not sent yet are skipped')
    })

    // preview works on saved test cases and on drafts (lean draft routes draft calls to TestCases.drafts)
    this.on('preview', [TestCases, TestCases.drafts!], async (req) => {
      const { IsActiveEntity } = keyOf(req)
      const { brokerId } = req.data as { brokerId?: string }
      const tc = await selectNodeDeep(idOf(req), IsActiveEntity === false ? TestCases.drafts! : TestCases)
      if (!tc) return req.reject(404, 'Test case not found')
      return buildPreview(tc, brokerId)
    })

    // suggestions of the payload editor - for drafts too: their own variables are the ones being edited
    this.on('templateHints', [TestCases, TestCases.drafts!], async (req) => {
      const { IsActiveEntity } = keyOf(req)
      const tc = await selectNodeDeep(idOf(req), IsActiveEntity === false ? TestCases.drafts! : TestCases)
      if (!tc) return req.reject(404, 'Test case not found')
      return templateHints(tc)
    })

    // copy of a test case or a folder (with everything below it), placed right after the original
    this.on('duplicate', TestCases, async (req) => {
      const [copy] = await copyNodes([idOf(req)])
      return SELECT.one.from(TestCases, copy.ID)
    })

    this.on('compareRuns', async (req) => {
      const { baseRunId, otherRunId } = req.data as { baseRunId: string; otherRunId: string }
      return compareRuns(baseRunId, otherRunId)
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

async function runFromUi(req: cds.Request, testCaseIds: string[], brokerIds: string[], credentials?: BrokerCredential[], options?: RunOptions) {
  const run = await startRun(req, testCaseIds, brokerIds, toCredentials(credentials), options)
  req.info(200, 'Test run started - see "Test Runs" for results')
  return run
}
