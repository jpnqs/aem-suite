import cds from '@sap/cds'
import { copyNodes } from './lib/copy-nodes'
import { exportNodes, importNodes } from './lib/export-import'
import { STARTER_CORRELATION_ID, STARTER_PAYLOAD } from './lib/defaults'
import { nextSortOrder, NodeData, validateEnums, validateNode, validateParent } from './lib/node-validation'
import { buildPreview } from './lib/preview'
import { currentJwt } from './lib/credentials/resolve'
import { TestCaseRecord } from './lib/test-case-spec'
import { BrokerCredential, createRun, executeRunInBackground, toCredentials } from './lib/test-runner'
import { loadTree } from './lib/tree'

const LOG = cds.log('agent')
const TABLE = 'aem.suite.TestCases'
const MAX_WAIT_SECONDS = 30
const MAX_FAILURES = 25

/** Limits for agents - the MCP adapter itself has no rate limiting or audit (see docs). */
const limits = () =>
  ({
    /** test cases x brokers of one run */
    maxRunResults: 100,
    /** runs of one user that may be RUNNING at the same time */
    maxActiveRuns: 2,
    /** development only: accept broker passwords in runTests (they would pass through the AI conversation) */
    allowDirectCredentials: false,
    ...(cds.env as unknown as { aemSuite?: { agent?: Record<string, unknown> } }).aemSuite?.agent
  }) as { maxRunResults: number; maxActiveRuns: number; allowDirectCredentials: boolean }

interface PropertyInput {
  name: string
  type?: string | null
  value?: string | null
}
interface VariableInput {
  name: string
  value?: string | null
}

/** Fields of a test case that an agent may set (undefined / null = not given). */
const TEST_FIELDS = [
  'name',
  'topic',
  'payload',
  'contentType',
  'deliveryMode',
  'timeToLiveMs',
  'dmqEligible',
  'priority',
  'correlationId',
  'ackTimeoutMs',
  'description'
] as const

export default class TestAgentService extends cds.ApplicationService {
  async init() {
    // ---------------------------------------------------------------- audit: who asked for what (no payloads, no secrets)
    this.before(['createFolder', 'createTestCase', 'updateTestCase', 'updateFolder', 'moveNode', 'copyNodes', 'importNodes', 'runTests'], (req) => {
      LOG.info('audit', { user: req.user.id, action: req.event, ...auditData(req.data as Record<string, unknown>) })
    })

    // ---------------------------------------------------------------- plan: create and change
    this.on('createFolder', async (req) => {
      const { name, description, parentId, variables } = req.data as {
        name: string
        description?: string
        parentId?: string
        variables?: VariableInput[]
      }
      const d = {
        ID: cds.utils.uuid(),
        kind: 'FOLDER',
        name,
        description: description ?? null,
        parent_ID: parentId ?? null,
        variables: toVariables(variables)
      }
      return createNode(req, d as unknown as NodeData)
    })

    this.on('createTestCase', async (req) => {
      const input = req.data as Record<string, unknown> & {
        parentId?: string
        userProperties?: PropertyInput[]
        variables?: VariableInput[]
      }
      const d = { ID: cds.utils.uuid(), kind: 'TEST', parent_ID: input.parentId ?? null } as Record<string, unknown>
      for (const f of TEST_FIELDS) if (input[f] !== undefined && input[f] !== null) d[f] = input[f]
      // same starting point as the UI
      d.deliveryMode ??= 'PERSISTENT'
      d.payload ??= STARTER_PAYLOAD
      d.correlationId ??= STARTER_CORRELATION_ID
      d.userProperties = toProperties(input.userProperties)
      d.variables = toVariables(input.variables)
      return createNode(req, d as unknown as NodeData)
    })

    this.on('updateTestCase', async (req) => {
      const input = req.data as Record<string, unknown> & { id: string; userProperties?: PropertyInput[]; variables?: VariableInput[] }
      const current = await loadNode(input.id)
      if (!current) return req.reject(404, 'Test case not found')
      if (current.kind !== 'TEST') return req.reject(400, 'This is a folder - use updateFolder')

      const changes: Record<string, unknown> = {}
      for (const f of TEST_FIELDS) if (input[f] !== undefined && input[f] !== null) changes[f] = input[f]
      const userProperties = input.userProperties ? toProperties(input.userProperties) : undefined
      const variables = input.variables ? toVariables(input.variables) : undefined

      // check the result as a whole, with the same rules as for new test cases
      const merged = { ...current, ...changes, userProperties: userProperties ?? current.userProperties, variables: variables ?? current.variables }
      problemsOf(req, (reject) => {
        validateEnums(merged as unknown as NodeData, reject)
        validateNode(merged as unknown as NodeData, 'UPDATE', reject)
      })
      return saveChanges(input.id, changes, userProperties, variables)
    })

    this.on('updateFolder', async (req) => {
      const input = req.data as { id: string; name?: string; description?: string; variables?: VariableInput[] }
      const current = await loadNode(input.id)
      if (!current) return req.reject(404, 'Folder not found')
      if (current.kind !== 'FOLDER') return req.reject(400, 'This is a test case - use updateTestCase')

      const changes: Record<string, unknown> = {}
      if (input.name != null) changes.name = input.name
      if (input.description != null) changes.description = input.description
      const variables = input.variables ? toVariables(input.variables) : undefined
      const merged = { ...current, ...changes, variables: variables ?? current.variables }
      problemsOf(req, (reject) => validateNode(merged as unknown as NodeData, 'UPDATE', reject))
      return saveChanges(input.id, changes, undefined, variables)
    })

    this.on('moveNode', async (req) => {
      const { id, parentId } = req.data as { id: string; parentId?: string | null }
      const current = await loadNode(id)
      if (!current) return req.reject(404, 'Test case or folder not found')
      await problemsOfAsync(req, (reject) => validateParent({ parent_ID: parentId ?? null } as NodeData, id, reject))
      await UPDATE(TABLE, id).with({ parent_ID: parentId ?? null, sortOrder: await nextSortOrder(parentId) })
      return { ID: id, name: current.name, kind: current.kind }
    })

    this.on('exportNodes', async (req) => exportNodes((req.data as { ids?: string[] }).ids))

    this.on('importNodes', async (req) => {
      const { content, parentId, dryRun } = req.data as { content: string; parentId?: string; dryRun?: boolean }
      return importNodes(content, { parentId, dryRun: !!dryRun })
    })

    this.on('copyNodes', async (req) => {
      const copies = await copyNodes((req.data as { ids: string[] }).ids)
      const tree = await loadTree()
      return copies.map((c) => ({ ...c, kind: tree.byId.get(c.ID)?.kind }))
    })

    // ---------------------------------------------------------------- check a message before it is sent
    this.on('previewTestCase', async (req) => {
      const { testCaseId, brokerId } = req.data as { testCaseId: string; brokerId?: string }
      const tc = await loadNode(testCaseId)
      if (!tc) return req.reject(404, 'Test case not found')
      if (tc.kind !== 'TEST') return req.reject(400, 'Folders have no message - preview a test case')
      return buildPreview(tc as unknown as TestCaseRecord, brokerId)
    })

    // ---------------------------------------------------------------- execute
    this.on('runTests', async (req) => {
      const { testCaseIds, brokerIds, credentials } = req.data as {
        testCaseIds: string[]
        brokerIds: string[]
        credentials?: BrokerCredential[]
      }
      const max = limits()

      // secrets stay out of AI conversations: only brokers whose credentials come from a BTP destination
      const brokers = (await SELECT.from('aem.suite.Brokers')
        .columns('ID', 'name', 'credentialMode')
        .where({ ID: { in: [...new Set(brokerIds)] } })) as { ID: string; name: string; credentialMode: string }[]
      const needCredentials = brokers.filter((b) => b.credentialMode !== 'DESTINATION').map((b) => b.name)
      if (needCredentials.length && !max.allowDirectCredentials)
        return req.reject(
          403,
          `Broker(s) ${needCredentials.join(', ')} need credentials that a person enters (password is never stored). ` +
            'Agents can only run tests on brokers that use a BTP destination - run these tests in the UI, or use another broker.'
        )

      // limits: size of one run and parallel runs of this user
      const tree = await loadTree()
      const unknown = testCaseIds.filter((id) => !tree.byId.has(id))
      if (unknown.length) return req.reject(404, 'One or more test cases not found')
      const total = tree.expandToTests(testCaseIds).length * new Set(brokerIds).size
      if (total > max.maxRunResults)
        return req.reject(400, `A run may have at most ${max.maxRunResults} results (test cases x brokers) - this one would have ${total}. Run fewer test cases or brokers.`)
      const active = (await SELECT.from('aem.suite.TestRuns').columns('ID').where({ createdBy: req.user.id, status: 'RUNNING' })) as unknown[]
      if (active.length >= max.maxActiveRuns)
        return req.reject(429, `You already have ${active.length} runs in progress (limit ${max.maxActiveRuns}). Wait for one to finish (getRunSummary).`)

      const entered = max.allowDirectCredentials ? toCredentials(credentials) : toCredentials([])
      const runId = await createRun(testCaseIds, brokerIds, entered)
      const jwt = currentJwt()
      // execute after the run rows are committed
      req.on('succeeded', () => void executeRunInBackground(runId, jwt, entered))
      return { runId, total }
    })

    // ---------------------------------------------------------------- check the result
    this.on('getRunSummary', async (req) => {
      const { runId, waitSeconds } = req.data as { runId: string; waitSeconds?: number | null }
      const deadline = Date.now() + Math.min(Math.max(waitSeconds ?? 0, 0), MAX_WAIT_SECONDS) * 1000
      type Run = { status: string; totalCount: number; passedCount: number; failedCount: number; summary: string }
      let run: Run | undefined
      // short transactions: a long one would hold the database connection the running tests need
      for (;;) {
        run = (await cds.db.tx(() => SELECT.one.from('aem.suite.TestRuns', runId))) as Run | undefined
        if (!run) return req.reject(404, 'Run not found')
        if (run.status !== 'RUNNING' || Date.now() >= deadline) break
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      const failures = (await cds.db.tx(() =>
        SELECT.from('aem.suite.RunResults')
          .columns('testCaseName', 'brokerName', 'status', 'resolvedTopic', 'errorMessage')
          .where({ run_ID: runId, status: { '!=': 'PASSED' } })
          .limit(MAX_FAILURES)
      )) as { testCaseName: string; brokerName: string; status: string; resolvedTopic: string; errorMessage: string }[]
      const finished = run.status !== 'RUNNING'
      return {
        runId,
        status: run.status,
        outcome: !finished ? 'RUNNING' : run.failedCount > 0 ? 'FAILED' : 'PASSED',
        finished,
        total: run.totalCount,
        passed: run.passedCount,
        failed: run.failedCount,
        summary: run.summary,
        failures: failures
          .filter((f) => f.status !== 'PENDING')
          .map((f) => ({ testCase: f.testCaseName, broker: f.brokerName, status: f.status, topic: f.resolvedTopic, error: f.errorMessage }))
      }
    })

    return super.init()
  }
}

// ------------------------------------------------------------------ helpers

type Rejector = (status: number, message: string, target?: string) => void

/** Runs the checks and rejects the request with all findings in one message (nothing is written yet). */
function problemsOf(req: cds.Request, check: (reject: Rejector) => void): void {
  const problems: string[] = []
  check((_status, message, target) => problems.push(target ? `${target.replace(/^in\//, '')}: ${message}` : message))
  if (problems.length) req.reject(400, problems.join('; '))
}

async function problemsOfAsync(req: cds.Request, check: (reject: Rejector) => Promise<unknown>): Promise<void> {
  const problems: string[] = []
  await check((_status, message, target) => problems.push(target ? `${target.replace(/^in\//, '')}: ${message}` : message))
  if (problems.length) req.reject(400, problems.join('; '))
}

async function createNode(req: cds.Request, d: NodeData): Promise<{ ID: string; name: string; kind: string }> {
  await problemsOfAsync(req, async (reject) => {
    validateEnums(d, reject)
    validateNode(d, 'CREATE', reject)
    await validateParent(d, undefined, reject)
  })
  d.sortOrder = await nextSortOrder(d.parent_ID)
  await INSERT.into(TABLE).entries(d)
  return { ID: d.ID, name: d.name, kind: d.kind as string }
}

async function saveChanges(
  id: string,
  changes: Record<string, unknown>,
  userProperties: PropertyInput[] | undefined,
  variables: VariableInput[] | undefined
): Promise<{ ID: string; name: string; kind: string }> {
  if (Object.keys(changes).length) await UPDATE(TABLE, id).with(changes)
  else await UPDATE(TABLE, id).with({ modifiedAt: new Date().toISOString() })
  if (userProperties) {
    await DELETE.from('aem.suite.TestCaseProperties').where({ testCase_ID: id })
    if (userProperties.length) await INSERT.into('aem.suite.TestCaseProperties').entries(userProperties.map((p) => ({ ...p, testCase_ID: id })))
  }
  if (variables) {
    await DELETE.from('aem.suite.TestCaseVariables').where({ testCase_ID: id })
    if (variables.length) await INSERT.into('aem.suite.TestCaseVariables').entries(variables.map((v) => ({ ...v, testCase_ID: id })))
  }
  const row = (await SELECT.one.from(TABLE, id).columns('ID', 'name', 'kind')) as { ID: string; name: string; kind: string }
  return row
}

async function loadNode(id: string): Promise<(Record<string, any> & { kind: string; name: string }) | undefined> {
  return (await SELECT.one.from(TABLE, (t: any) => {
    t`.*`
    t.userProperties((p: any) => p`.*`)
    t.variables((v: any) => v`.*`)
  }).where({ ID: id })) as (Record<string, any> & { kind: string; name: string }) | undefined
}

const toProperties = (list?: PropertyInput[] | null): PropertyInput[] =>
  (list ?? []).map((p) => ({ name: p.name, type: p.type ?? undefined, value: p.value ?? '' }))

const toVariables = (list?: VariableInput[] | null): VariableInput[] => (list ?? []).map((v) => ({ name: v.name, value: v.value ?? '' }))

/** What is worth logging about a request: names and IDs, never payloads or credentials. */
function auditData(data: Record<string, unknown>): Record<string, unknown> {
  const keep = ['id', 'ids', 'name', 'topic', 'parentId', 'testCaseId', 'testCaseIds', 'brokerIds', 'dryRun']
  return Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => keep.includes(k)))
}
