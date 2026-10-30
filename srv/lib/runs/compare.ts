import { RunResults, TestRuns } from '#cds-models/aem/suite'
import { httpError } from '../core/errors'

/** How a test case on a broker changed from one run to the other. */
export type Change = 'FIXED' | 'BROKEN' | 'STILL_FAILING' | 'STILL_PASSING' | 'NEW' | 'GONE'

export interface Comparison {
  testCase: string
  broker: string
  baseStatus: string | null
  otherStatus: string | null
  change: Change
  baseAckLatencyMs: number | null
  otherAckLatencyMs: number | null
}

interface Row {
  testCase_ID?: string | null
  testCaseName?: string | null
  broker_ID?: string | null
  brokerName?: string | null
  status?: string | null
  ackLatencyMs?: number | null
}

/** worst first: one failed repetition makes the test case failed in that run */
const RANK: Record<string, number> = { ERROR: 0, FAILED: 1, PENDING: 2, SKIPPED: 3, PASSED: 4 }

/**
 * Compares two runs per test case and broker (repetitions folded: the worst outcome, the average latency).
 * Changes first (BROKEN, FIXED, NEW, GONE), then the rest; by test case and broker.
 */
export async function compareRuns(baseRunId: string, otherRunId: string): Promise<Comparison[]> {
  const runs = await SELECT.from(TestRuns).columns('ID').where({ ID: { in: [baseRunId, otherRunId] } })
  if (runs.length < new Set([baseRunId, otherRunId]).size) throw httpError(404, 'Run not found')
  const load = async (runId: string) => {
    const rows = (await SELECT.from(RunResults)
      .columns('testCase_ID', 'testCaseName', 'broker_ID', 'brokerName', 'status', 'ackLatencyMs')
      .where({ run_ID: runId })) as Row[]
    const folded = new Map<string, { name: string; broker: string; status: string; latencies: number[] }>()
    for (const r of rows) {
      const key = `${r.testCase_ID ?? r.testCaseName}|${r.broker_ID ?? r.brokerName}`
      const f = folded.get(key) ?? { name: r.testCaseName ?? '', broker: r.brokerName ?? '', status: 'PASSED', latencies: [] }
      if ((RANK[r.status ?? ''] ?? 2) < (RANK[f.status] ?? 2)) f.status = r.status ?? f.status
      if (typeof r.ackLatencyMs === 'number') f.latencies.push(r.ackLatencyMs)
      folded.set(key, f)
    }
    return folded
  }
  const [base, other] = await Promise.all([load(baseRunId), load(otherRunId)])
  const avg = (v?: number[]) => (v?.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null)
  const out: Comparison[] = []
  for (const key of new Set([...base.keys(), ...other.keys()])) {
    const b = base.get(key)
    const o = other.get(key)
    const passed = (s?: string) => s === 'PASSED'
    const change: Change = !b ? 'NEW' : !o ? 'GONE' : passed(b.status) ? (passed(o.status) ? 'STILL_PASSING' : 'BROKEN') : passed(o.status) ? 'FIXED' : 'STILL_FAILING'
    out.push({
      testCase: (o ?? b)!.name,
      broker: (o ?? b)!.broker,
      baseStatus: b?.status ?? null,
      otherStatus: o?.status ?? null,
      change,
      baseAckLatencyMs: avg(b?.latencies),
      otherAckLatencyMs: avg(o?.latencies)
    })
  }
  const order: Change[] = ['BROKEN', 'FIXED', 'NEW', 'GONE', 'STILL_FAILING', 'STILL_PASSING']
  return out.sort((x, y) => order.indexOf(x.change) - order.indexOf(y.change) || x.testCase.localeCompare(y.testCase) || x.broker.localeCompare(y.broker))
}
