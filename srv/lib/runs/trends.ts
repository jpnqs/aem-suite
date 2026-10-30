import cds from '@sap/cds'
import { BrokerDailyStats, RunResults } from '#cds-models/aem/suite'

/**
 * Trends kept while runs finish (cheap to read, the same on SQLite and HANA):
 * - per test case the outcomes of its last runs (TestCaseStats.history), its pass rate and whether it is flaky,
 * - per broker and day the number of messages and their latencies (BrokerDailyStats).
 */

/** how many outcomes TestCaseStats.history keeps */
export const HISTORY_LENGTH = 20
/** the outcomes "flaky" looks at */
const FLAKY_WINDOW = 10

/** P = passed, F = failed, E = error - newest last */
export type HistoryLetter = 'P' | 'F' | 'E'

export const letterOf = (status: string): HistoryLetter => (status === 'PASSED' ? 'P' : status === 'ERROR' ? 'E' : 'F')

/** The history with the newest outcome appended, cut to HISTORY_LENGTH. */
export function nextHistory(previous: string | null | undefined, status: string): string {
  return ((previous ?? '') + letterOf(status)).slice(-HISTORY_LENGTH)
}

/**
 * Pass rate (percent of the kept outcomes) and flaky: within the last FLAKY_WINDOW outcomes it passed and failed,
 * and changed between the two at least twice - one regression (or one fix) alone is not flaky.
 */
export function healthOf(history: string | null | undefined): { passRate: number | null; flaky: boolean } {
  const h = history ?? ''
  if (!h.length) return { passRate: null, flaky: false }
  const passRate = Math.round((100 * [...h].filter((c) => c === 'P').length) / h.length)
  const recent = h.slice(-FLAKY_WINDOW)
  let changes = 0
  for (let i = 1; i < recent.length; i++) if ((recent[i] === 'P') !== (recent[i - 1] === 'P')) changes++
  return { passRate, flaky: recent.includes('P') && /[FE]/.test(recent) && changes >= 2 }
}

interface LatencyRow {
  broker_ID?: string | null
  brokerName?: string | null
  status?: string | null
  ackLatencyMs?: number | null
}

/** Adds the results of a finished run to the daily figures of its brokers (the day the run finished, UTC). */
export async function addBrokerDailyStats(runId: string): Promise<void> {
  const rows = (await SELECT.from(RunResults)
    .columns('broker_ID', 'brokerName', 'status', 'ackLatencyMs')
    .where({ run_ID: runId, status: { in: ['PASSED', 'FAILED', 'ERROR'] } })) as LatencyRow[]
  const day = new Date().toISOString().slice(0, 10)
  const byBroker = new Map<string, LatencyRow[]>()
  for (const r of rows) if (r.broker_ID) byBroker.set(r.broker_ID, [...(byBroker.get(r.broker_ID) ?? []), r])
  for (const [brokerId, list] of byBroker) {
    const acks = list.map((r) => r.ackLatencyMs).filter((v): v is number => typeof v === 'number')
    const sum = (v: number[]) => v.reduce((s, x) => s + x, 0)
    const current = await SELECT.one.from(BrokerDailyStats).where({ broker_ID: brokerId, day })
    const add = {
      messages: list.length,
      passed: list.filter((r) => r.status === 'PASSED').length,
      ackCount: acks.length,
      ackSumMs: sum(acks),
      ackMaxMs: acks.length ? Math.max(...acks) : null
    }
    if (!current) {
      await INSERT.into(BrokerDailyStats).entries({ broker_ID: brokerId, day, brokerName: list[0].brokerName, ...add })
      continue
    }
    const max = (a?: number | null, b?: number | null) => (a == null ? b : b == null ? a : Math.max(a, b))
    await UPDATE(BrokerDailyStats)
      .where({ broker_ID: brokerId, day })
      .with({
        brokerName: list[0].brokerName,
        messages: (current.messages ?? 0) + add.messages,
        passed: (current.passed ?? 0) + add.passed,
        ackCount: (current.ackCount ?? 0) + add.ackCount,
        ackSumMs: (current.ackSumMs ?? 0) + add.ackSumMs,
        ackMaxMs: max(current.ackMaxMs, add.ackMaxMs)
      })
  }
}

/** Never lets a statistics problem fail a run. */
export async function safely(what: string, fn: () => Promise<void>): Promise<void> {
  try {
    await cds.db.tx(fn)
  } catch (e) {
    cds.log('aem-runner').warn(`Cannot update ${what}`, e)
  }
}
