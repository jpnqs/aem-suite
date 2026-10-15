import cds from '@sap/cds'
import { BrokerRecord, currentJwt, loadBroker, needsPassword, needsUsername, resolveConnection } from './credentials/resolve'
import { errMsg, httpError, truncate } from './errors'
import type { Publisher } from './solace/session'
import { connect } from './solace/connector'
import { buildSpec, loadTestCases, loadVariableScopes, scopeFor, TestCaseRecord } from './test-case-spec'
import { loadTree } from './tree'
import { TemplateError } from './template/resolve'

const LOG = cds.log('aem-runner')

/** length of RunResults.errorMessage */
const MAX_ERROR = 2000

const activeRuns = new Map<string, Promise<void>>()

/** Resolves once the given run finished (tests / graceful shutdown). */
export function waitForRun(runId: string): Promise<void> {
  return activeRuns.get(runId) ?? Promise.resolve()
}

interface PendingResult {
  ID: string
  testCase_ID: string
  broker_ID: string
  brokerName: string
}

/** "A, B +3 more -> broker1, broker2" */
function runSummary(testCaseNames: string[], brokerNames: string[]): string {
  const list = (names: string[], max: number) =>
    names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max} more` : names.join(', ')
  return truncate(`${list(testCaseNames, 3)} → ${list(brokerNames, 3)}`, 500)
}

/**
 * Password (and username, if the broker has none maintained) entered by the user for a DIRECT broker -
 * kept in memory for the run only.
 */
export interface BrokerCredential {
  brokerId: string
  username?: string | null
  password?: string | null
}

/** brokerId -> credentials entered for this run; never persisted. */
export type Credentials = Map<string, { username?: string; password?: string }>

export function toCredentials(credentials?: BrokerCredential[] | null): Credentials {
  const m: Credentials = new Map()
  for (const c of credentials ?? []) {
    if (c?.brokerId) m.set(c.brokerId, { username: c.username?.trim() || undefined, password: c.password || undefined })
  }
  return m
}

/**
 * Creates a TestRun with one PENDING result per (test case x broker) within the
 * current transaction. Call executeRunInBackground() after the transaction committed.
 */
export async function createRun(testCaseIds: string[], brokerIds: string[], credentials: Credentials = new Map()): Promise<string> {
  const selected = [...new Set(testCaseIds ?? [])]
  const brIds = [...new Set(brokerIds ?? [])]
  if (!selected.length) throw httpError(400, 'Select at least one test case or folder')
  if (!brIds.length) throw httpError(400, 'Select at least one broker')

  // folders run all test cases below them (tree order)
  const tree = await loadTree()
  if (selected.some((id) => !tree.byId.has(id))) throw httpError(404, 'One or more test cases not found (save drafts first)')
  const tcIds = tree.expandToTests(selected)
  if (!tcIds.length) throw httpError(400, 'The selected folders contain no test cases')
  const testCases = tcIds.map((id) => ({ ID: id, name: tree.byId.get(id)!.name ?? id }))
  const brokers = (await SELECT.from('aem.suite.Brokers').columns('ID', 'name', 'active', 'credentialMode', 'username').where({
    ID: { in: brIds }
  })) as { ID: string; name: string; active: boolean; credentialMode: string; username?: string | null }[]
  if (brokers.length !== brIds.length) throw httpError(404, 'One or more brokers not found')
  // keep the user's selection order (summary, results)
  brokers.sort((a, b) => brIds.indexOf(a.ID) - brIds.indexOf(b.ID))
  const inactive = brokers.filter((b) => b.active === false).map((b) => b.name)
  if (inactive.length) throw httpError(400, `Broker(s) inactive: ${inactive.join(', ')}`)
  const noUser = brokers.filter((b) => needsUsername(b) && !credentials.get(b.ID)?.username).map((b) => b.name)
  if (noUser.length) throw httpError(400, `Username required for broker(s): ${noUser.join(', ')}`)
  const missing = brokers.filter((b) => needsPassword(b) && !credentials.get(b.ID)?.password).map((b) => b.name)
  if (missing.length) throw httpError(400, `Password required for broker(s): ${missing.join(', ')}`)

  const runId = cds.utils.uuid()
  const tcById = new Map(testCases.map((t) => [t.ID, t]))
  const results = brokers.flatMap((b) =>
    tcIds.map((tcId) => ({
      ID: cds.utils.uuid(),
      run_ID: runId,
      testCase_ID: tcId,
      testCaseName: tcById.get(tcId)!.name,
      broker_ID: b.ID,
      brokerName: b.name,
      status: 'PENDING'
    }))
  )
  await INSERT.into('aem.suite.TestRuns').entries({
    ID: runId,
    summary: runSummary(
      tcIds.map((id) => tcById.get(id)!.name),
      brokers.map((b) => b.name)
    ),
    startedAt: new Date().toISOString(),
    status: 'RUNNING',
    totalCount: results.length,
    passedCount: 0,
    failedCount: 0
  })
  await INSERT.into('aem.suite.RunResults').entries(results)
  return runId
}

/**
 * Creates a run for the request and executes it once the request's transaction is committed.
 * Passwords (and entered usernames) stay in memory of this run only - never persisted or logged.
 */
export async function startRun(req: cds.Request, testCaseIds: string[], brokerIds: string[], credentials: Credentials): Promise<string> {
  const runId = await createRun(testCaseIds, brokerIds, credentials)
  const jwt = currentJwt()
  req.on('succeeded', () => void executeRunInBackground(runId, jwt, credentials))
  return runId
}

/** Starts execution in the background (do not await in a request). */
export function executeRunInBackground(runId: string, jwt?: string, credentials: Credentials = new Map()): Promise<void> {
  const p = executeRun(runId, jwt, credentials)
    .catch(async (e) => {
      LOG.error(`Run ${runId} crashed`, e)
      await failRuns({ ID: runId }, `Run aborted: ${errMsg(e)}`)
    })
    .finally(() => {
      credentials.clear()
      activeRuns.delete(runId)
    })
  activeRuns.set(runId, p)
  return p
}

type Outcome = { status: 'PASSED' | 'FAILED' | 'ERROR'; broker: string; error?: string }

/** Counts of a run, the outcome per test case (for TestCaseStats), and the live progress events. */
class RunProgress {
  private readonly counts = { done: 0, passed: 0, failed: 0 }
  /** per test case: outcome over all brokers */
  private readonly perTestCase = new Map<string, Outcome[]>()

  constructor(
    private readonly runId: string,
    private readonly total: number,
    private readonly live: cds.Service | undefined
  ) {}

  /** Stores the result of one test case on one broker. */
  async finish(r: PendingResult, status: Outcome['status'], data: Record<string, unknown>): Promise<void> {
    const outcomes = this.perTestCase.get(r.testCase_ID) ?? []
    outcomes.push({ status, broker: r.brokerName, error: data.errorMessage as string | undefined })
    this.perTestCase.set(r.testCase_ID, outcomes)
    this.counts.done++
    if (status === 'PASSED') this.counts.passed++
    else this.counts.failed++
    await cds.db.tx(() => UPDATE('aem.suite.RunResults', r.ID).with({ status, executedAt: new Date().toISOString(), ...data }))
    await this.emit(r.ID)
  }

  /** Marks the run DONE once every result is stored. */
  async complete(): Promise<void> {
    const { passed, failed } = this.counts
    await cds.db.tx(() =>
      UPDATE('aem.suite.TestRuns', this.runId).with({ status: 'DONE', finishedAt: new Date().toISOString(), passedCount: passed, failedCount: failed })
    )
    await updateTestCaseStats(this.runId, this.perTestCase)
    await this.emit(undefined, 'DONE')
    LOG.info(`Run ${this.runId} finished: ${passed}/${this.total} passed`)
  }

  private async emit(resultId?: string, status = 'RUNNING'): Promise<void> {
    try {
      await this.live?.emit('runProgress', { runId: this.runId, status, total: this.total, ...this.counts, resultId })
    } catch (e) {
      LOG.debug('progress emit failed', e)
    }
  }
}

interface RunContext {
  jwt: string | undefined
  credentials: Credentials
  testCases: Map<string, TestCaseRecord>
  vars: Awaited<ReturnType<typeof loadVariableScopes>>
  progress: RunProgress
}

async function executeRun(runId: string, jwt: string | undefined, credentials: Credentials): Promise<void> {
  const live = await cds.connect.to('LiveService').catch(() => undefined)
  const pending = (await cds.db.tx(() =>
    SELECT.from('aem.suite.RunResults').columns('ID', 'testCase_ID', 'broker_ID', 'brokerName').where({ run_ID: runId })
  )) as PendingResult[]

  const tcIds = [...new Set(pending.map((p) => p.testCase_ID))]
  const brokerIds = [...new Set(pending.map((p) => p.broker_ID))]
  const { testCases, vars } = await cds.db.tx(async () => ({
    testCases: await loadTestCases(tcIds),
    vars: await loadVariableScopes(brokerIds)
  }))
  const ctx: RunContext = {
    jwt,
    credentials,
    testCases: new Map(testCases.map((t) => [t.ID, t])),
    vars,
    progress: new RunProgress(runId, pending.length, live)
  }

  // brokers in parallel, the test cases of one broker one after the other
  await Promise.allSettled(brokerIds.map((brokerId) => runBroker(brokerId, pending.filter((p) => p.broker_ID === brokerId), ctx)))
  await ctx.progress.complete()
}

/** Connects to one broker and publishes its test cases; every result ends PASSED, FAILED or ERROR. */
async function runBroker(brokerId: string, results: PendingResult[], ctx: RunContext): Promise<void> {
  const { progress } = ctx
  let broker: BrokerRecord
  let publisher: Publisher
  try {
    broker = await cds.db.tx(() => loadBroker(brokerId))
    const entered = ctx.credentials.get(brokerId)
    publisher = await connect(await resolveConnection(broker, ctx.jwt, entered?.password, entered?.username))
  } catch (e) {
    for (const r of results) await progress.finish(r, 'ERROR', { errorMessage: truncate(errMsg(e), MAX_ERROR) })
    return
  }

  try {
    for (const r of results) {
      const tc = ctx.testCases.get(r.testCase_ID)
      if (!tc) {
        await progress.finish(r, 'ERROR', { errorMessage: 'Test case was deleted' })
        continue
      }
      let spec
      try {
        spec = buildSpec(tc, scopeFor(tc, broker, ctx.vars))
      } catch (e) {
        await progress.finish(r, 'ERROR', { errorMessage: truncate(errMsg(e), MAX_ERROR), deliveryMode: tc.deliveryMode })
        continue
      }
      const sent = { deliveryMode: spec.deliveryMode, resolvedTopic: spec.topic, resolvedPayload: spec.payload, correlationId: spec.correlationId ?? null }
      try {
        const res = await publisher.publish(spec)
        await progress.finish(r, 'PASSED', { ...sent, ackLatencyMs: res.latencyMs })
      } catch (e) {
        await progress.finish(r, e instanceof TemplateError ? 'ERROR' : 'FAILED', { ...sent, errorMessage: truncate(errMsg(e), MAX_ERROR) })
      }
    }
  } finally {
    await publisher.close().catch(() => undefined)
  }
}

/**
 * RUNNING while in progress, then FAILED if anything failed or the run was aborted, otherwise PASSED.
 * Keep in sync with TestRuns.outcome in srv/test-service.cds.
 */
export function runOutcome(run: { status: string; failedCount: number }): 'RUNNING' | 'FAILED' | 'PASSED' {
  if (run.status === 'RUNNING') return 'RUNNING'
  return run.status === 'FAILED' || run.failedCount > 0 ? 'FAILED' : 'PASSED'
}

/**
 * Ends runs that can no longer finish (crashed, or the server stopped while they ran): the run gets FAILED,
 * its results without outcome ERROR - so it no longer shows as running or counts against the agent's limit.
 */
export async function failRuns(where: Record<string, unknown>, reason: string): Promise<void> {
  try {
    await cds.db.tx(async () => {
      const runs = (await SELECT.from('aem.suite.TestRuns').columns('ID').where({ ...where, status: 'RUNNING' })) as { ID: string }[]
      for (const { ID } of runs) {
        await UPDATE('aem.suite.RunResults')
          .with({ status: 'ERROR', errorMessage: truncate(reason, MAX_ERROR), executedAt: new Date().toISOString() })
          .where({ run_ID: ID, status: 'PENDING' })
        const results = (await SELECT.from('aem.suite.RunResults').columns('status').where({ run_ID: ID })) as { status: string }[]
        const passed = results.filter((r) => r.status === 'PASSED').length
        await UPDATE('aem.suite.TestRuns', ID).with({
          status: 'FAILED',
          finishedAt: new Date().toISOString(),
          passedCount: passed,
          failedCount: results.length - passed
        })
        LOG.warn(`Run ${ID} marked as FAILED: ${reason}`)
      }
    })
  } catch (e) {
    LOG.error('Cannot mark runs as failed', e)
  }
}

/** Stores the latest outcome per test case: PASSED only if all brokers passed. */
async function updateTestCaseStats(runId: string, perTestCase: Map<string, Outcome[]>) {
  const runAt = new Date().toISOString()
  const rows = [...perTestCase].map(([testCaseId, outcomes]) => {
    const bad = outcomes.filter((o) => o.status !== 'PASSED')
    const status = !bad.length ? 'PASSED' : bad.some((o) => o.status === 'FAILED') ? 'FAILED' : 'ERROR'
    return {
      testCase_ID: testCaseId,
      status,
      runAt,
      run_ID: runId,
      brokers: truncate(outcomes.map((o) => o.broker).join(', '), 500),
      message: bad.length ? truncate(bad.map((o) => `${o.broker}: ${o.error ?? o.status}`).join('; '), 1000) : null
    }
  })
  try {
    await cds.db.tx(() => UPSERT.into('aem.suite.TestCaseStats').entries(rows))
  } catch (e) {
    LOG.warn('Cannot update test case stats', e)
  }
}
