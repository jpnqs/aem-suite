import cds from '@sap/cds'
import { buildPreview } from './lib/preview'
import { BrokerCredential, cancelRun, RunOptions, startRun, toCredentials } from './lib/test-runner'
import { STARTER_CORRELATION_ID, STARTER_PAYLOAD } from './lib/defaults'
import { copyNodes } from './lib/copy-nodes'
import { exportNodes, importNodes } from './lib/export-import'
import { nextSortOrder, NodeData, Reject, validateNode, validateParent } from './lib/node-validation'
import { selectNodeDeep } from './lib/nodes'
import { columnLength } from './lib/model'
import { keyOf } from './lib/request'
import type { TestCaseRecord } from './lib/test-case-spec'
import { moveBefore } from './lib/tree'

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

    // the rules live in lib/node-validation.ts - the AI agent service, the import and the live view apply the same ones:
    // parent must be a folder and must not be the node itself or below it; new nodes go to the end
    this.before(['CREATE', 'UPDATE'], TestCases, async (req) => {
      const d = req.data as NodeData
      const reject: Reject = (status, message, target) => req.error(status, message, target)
      const parentOk = await validateParent(d, d.ID ?? keyOf(req).ID, reject)
      if (parentOk && req.event === 'CREATE' && !d.sortOrder) d.sortOrder = await nextSortOrder(d.parent_ID)
      validateNode(d, req.event, reject)
    })

    // drag & drop: place the node before NextSibling (null = at the end)
    this.on('moveBefore', TestCases, async (req) => {
      const nextId = (req.data as { NextSibling?: { ID?: string } | null }).NextSibling?.ID ?? null
      await moveBefore(keyOf(req).ID, nextId)
    })

    this.on('runTest', TestCases, async (req) => {
      const { brokerIds, credentials, options } = req.data as { brokerIds: string[]; credentials?: BrokerCredential[]; options?: RunOptions }
      return runFromUi(req, [keyOf(req).ID], brokerIds, credentials, options)
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
      const { ID, IsActiveEntity } = keyOf(req)
      const { brokerId } = req.data as { brokerId?: string }
      const tc = await selectNodeDeep(ID, IsActiveEntity === false ? TestCases.drafts! : TestCases)
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

async function runFromUi(req: cds.Request, testCaseIds: string[], brokerIds: string[], credentials?: BrokerCredential[], options?: RunOptions) {
  const run = await startRun(req, testCaseIds, brokerIds, toCredentials(credentials), options)
  req.info(200, 'Test run started - see "Test Runs" for results')
  return run
}
