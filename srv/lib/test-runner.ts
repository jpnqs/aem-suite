import cds from '@sap/cds'
import { BrokerRecord, loadBroker, needsPassword, resolveConnection } from './credentials/resolve'
import type { Publisher } from './solace/session'
import { connect, Connector, setConnector } from './solace/connector'
import { buildSpec, loadTestCases, loadVariableScopes, scopeFor, TestCaseRecord } from './test-case-spec'
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
}

/**
 * Creates a TestRun with one PENDING result per (test case x broker) within the
 * current transaction. Call executeRun() after the transaction committed.
 */
/** Password entered by the user for a DIRECT broker - kept in memory for the run only. */
export interface BrokerCredential {
  brokerId: string
  password?: string | null
}

/** brokerId -> password; never persisted. */
export type Passwords = Map<string, string>

export function toPasswords(credentials?: BrokerCredential[] | null): Passwords {
  const m: Passwords = new Map()
  for (const c of credentials ?? []) if (c?.brokerId && c.password) m.set(c.brokerId, c.password)
  return m
}

export async function createRun(testCaseIds: string[], brokerIds: string[], passwords: Passwords = new Map()): Promise<string> {
  const tcIds = [...new Set(testCaseIds ?? [])]
  const brIds = [...new Set(brokerIds ?? [])]
  if (!tcIds.length) throw httpError(400, 'Select at least one test case')
  if (!brIds.length) throw httpError(400, 'Select at least one broker')

  const testCases = (await SELECT.from('aem.suite.TestCases').columns('ID', 'name').where({ ID: { in: tcIds } })) as {
    ID: string
    name: string
  }[]
  if (testCases.length !== tcIds.length) throw httpError(404, 'One or more test cases not found (save drafts first)')
  const brokers = (await SELECT.from('aem.suite.Brokers').columns('ID', 'name', 'active', 'credentialMode').where({
    ID: { in: brIds }
  })) as { ID: string; name: string; active: boolean; credentialMode: string }[]
  if (brokers.length !== brIds.length) throw httpError(404, 'One or more brokers not found')
  const inactive = brokers.filter((b) => b.active === false).map((b) => b.name)
  if (inactive.length) throw httpError(400, `Broker(s) inactive: ${inactive.join(', ')}`)
  const missing = brokers.filter((b) => needsPassword(b) && !passwords.get(b.ID)).map((b) => b.name)
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
export function executeRunInBackground(runId: string, jwt?: string, passwords: Passwords = new Map()): Promise<void> {
  const p = executeRun(runId, jwt, passwords)
    .catch((e) => LOG.error(`Run ${runId} crashed`, e))
    .finally(() => {
      passwords.clear()
      activeRuns.delete(runId)
    })
  activeRuns.set(runId, p)
  return p
}

async function executeRun(runId: string, jwt: string | undefined, passwords: Passwords): Promise<void> {
  const live = await cds.connect.to('LiveService').catch(() => undefined)
  const pending = (await cds.db.tx(() =>
    SELECT.from('aem.suite.RunResults').columns('ID', 'testCase_ID', 'broker_ID').where({ run_ID: runId })
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

  const finish = async (r: PendingResult, status: 'PASSED' | 'FAILED' | 'ERROR', data: Record<string, unknown>) => {
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
        const conn = await resolveConnection(broker, jwt, passwords.get(brokerId))
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
  await progress(undefined, 'DONE')
  LOG.info(`Run ${runId} finished: ${counts.passed}/${total} passed`)
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
