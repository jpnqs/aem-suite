import cds from '@sap/cds'
import { BrokerRecord, loadBroker, needsPassword, needsUsername, resolveConnection } from './credentials/resolve'
import type { Publisher } from './solace/session'
import { connect, Connector, setConnector } from './solace/connector'
import { buildSpec, loadTestCases, loadVariableScopes, scopeFor, TestCaseRecord } from './test-case-spec'
import { loadTree } from './tree'
import { TemplateError } from './template/resolve'

const LOG = cds.log('aem-runner')

export type PublisherFactory = Connector

/** Replaces the broker connection (runs and connection checks) - used by tests. */
export function setPublisherFactory(factory?: PublisherFactory): void {
  setConnector(factory)
}

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
  return `${list(testCaseNames, 3)} → ${list(brokerNames, 3)}`.slice(0, 500)
}

/**
 * Creates a TestRun with one PENDING result per (test case x broker) within the
 * current transaction. Call executeRun() after the transaction committed.
 */
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

/** Starts execution in the background (do not await in a request). */
export function executeRunInBackground(runId: string, jwt?: string, credentials: Credentials = new Map()): Promise<void> {
  const p = executeRun(runId, jwt, credentials)
    .catch((e) => LOG.error(`Run ${runId} crashed`, e))
    .finally(() => {
      credentials.clear()
      activeRuns.delete(runId)
    })
  activeRuns.set(runId, p)
  return p
}

async function executeRun(runId: string, jwt: string | undefined, credentials: Credentials): Promise<void> {
  const live = await cds.connect.to('LiveService').catch(() => undefined)
  const pending = (await cds.db.tx(() =>
    SELECT.from('aem.suite.RunResults').columns('ID', 'testCase_ID', 'broker_ID', 'brokerName').where({ run_ID: runId })
  )) as PendingResult[]

  const total = pending.length
  const counts = { done: 0, passed: 0, failed: 0 }
  const progress = async (resultId?: string, status = 'RUNNING') => {
    try {
      await live?.emit('runProgress', { runId, status, total, ...counts, resultId })
    } catch (e) {
      LOG.debug('progress emit failed', e)
    }
  }

  const tcIds = [...new Set(pending.map((p) => p.testCase_ID))]
  const brokerIds = [...new Set(pending.map((p) => p.broker_ID))]
  const { testCases, vars } = await cds.db.tx(async () => ({
    testCases: await loadTestCases(tcIds),
    vars: await loadVariableScopes(brokerIds)
  }))
  const tcById = new Map(testCases.map((t) => [t.ID, t]))

  // per test case: outcome over all brokers, for TestCaseStats
  const perTestCase = new Map<string, { status: string; broker: string; error?: string }[]>()

  const finish = async (r: PendingResult, status: 'PASSED' | 'FAILED' | 'ERROR', data: Record<string, unknown>) => {
    const outcomes = perTestCase.get(r.testCase_ID) ?? []
    outcomes.push({ status, broker: r.brokerName, error: data.errorMessage as string | undefined })
    perTestCase.set(r.testCase_ID, outcomes)
    counts.done++
    if (status === 'PASSED') counts.passed++
    else counts.failed++
    await cds.db.tx(() =>
      UPDATE('aem.suite.RunResults', r.ID).with({ status, executedAt: new Date().toISOString(), ...data })
    )
    await progress(r.ID)
  }

  await Promise.allSettled(
    brokerIds.map(async (brokerId) => {
      const mine = pending.filter((p) => p.broker_ID === brokerId)
      let broker: BrokerRecord | undefined
      let publisher: Publisher | undefined
      try {
        broker = await cds.db.tx(() => loadBroker(brokerId))
        const entered = credentials.get(brokerId)
        const conn = await resolveConnection(broker, jwt, entered?.password, entered?.username)
        publisher = await connect(conn)
      } catch (e) {
        for (const r of mine) await finish(r, 'ERROR', { errorMessage: truncate(errMsg(e)) })
        return
      }

      try {
        for (const r of mine) {
          const tc = tcById.get(r.testCase_ID) as TestCaseRecord | undefined
          if (!tc) {
            await finish(r, 'ERROR', { errorMessage: 'Test case was deleted' })
            continue
          }
          let spec
          try {
            spec = buildSpec(tc, scopeFor(tc, broker, vars))
          } catch (e) {
            await finish(r, 'ERROR', { errorMessage: truncate(errMsg(e)), deliveryMode: tc.deliveryMode })
            continue
          }
          const base = {
            deliveryMode: spec.deliveryMode,
            resolvedTopic: spec.topic,
            resolvedPayload: spec.payload,
            correlationId: spec.correlationId ?? null
          }
          try {
            const res = await publisher.publish(spec)
            await finish(r, 'PASSED', { ...base, ackLatencyMs: res.latencyMs })
          } catch (e) {
            await finish(r, e instanceof TemplateError ? 'ERROR' : 'FAILED', {
              ...base,
              errorMessage: truncate(errMsg(e))
            })
          }
        }
      } finally {
        await publisher.close().catch(() => undefined)
      }
    })
  )

  await cds.db.tx(() =>
    UPDATE('aem.suite.TestRuns', runId).with({
      status: 'DONE',
      finishedAt: new Date().toISOString(),
      passedCount: counts.passed,
      failedCount: counts.failed
    })
  )
  await updateTestCaseStats(runId, perTestCase)
  await progress(undefined, 'DONE')
  LOG.info(`Run ${runId} finished: ${counts.passed}/${total} passed`)
}

/** Stores the latest outcome per test case: PASSED only if all brokers passed. */
async function updateTestCaseStats(runId: string, perTestCase: Map<string, { status: string; broker: string; error?: string }[]>) {
  const runAt = new Date().toISOString()
  const rows = [...perTestCase].map(([testCaseId, outcomes]) => {
    const bad = outcomes.filter((o) => o.status !== 'PASSED')
    const status = !bad.length ? 'PASSED' : bad.some((o) => o.status === 'FAILED') ? 'FAILED' : 'ERROR'
    return {
      testCase_ID: testCaseId,
      status,
      runAt,
      run_ID: runId,
      brokers: outcomes.map((o) => o.broker).join(', ').slice(0, 500),
      message: bad.length ? truncate(bad.map((o) => `${o.broker}: ${o.error ?? o.status}`).join('; '), 1000) : null
    }
  })
  try {
    await cds.db.tx(() => UPSERT.into('aem.suite.TestCaseStats').entries(rows))
  } catch (e) {
    LOG.warn('Cannot update test case stats', e)
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function truncate(s: string, max = 2000): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s
}

function httpError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code, status: code })
}
