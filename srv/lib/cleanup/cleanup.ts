import cds from '@sap/cds'
import { applyTo, CATEGORY_LABELS, CategoryId, CleanupRequest, Selection, selectionsOf } from './categories'
import { errMsg, httpError, truncate } from '../core/errors'

/** rows per statement - keeps the IN lists of the deletes small */
export const CHUNK_SIZE = 500
const SAMPLES = 10

export interface CategoryCount {
  category: CategoryId
  count: number
}

export interface CategoryResult extends CategoryCount {
  cutoff: string | null
  samples: { ID: string; title: string | null; info: string | null; date: string | null }[]
}

export interface ExecuteResult {
  logId: string
  totalCount: number
  counts: CategoryCount[]
}

const countOf = async (s: Selection): Promise<number> => {
  const row = (await applyTo(SELECT.one.from(s.entity).columns('count(1) as n'), s.conds)) as { n: number | string } | undefined
  return Number(row?.n ?? 0)
}

/** What execute would clean up: count, cutoff and the newest rows per category. Writes nothing. */
export async function preview(request: CleanupRequest | null | undefined, now = new Date()): Promise<CategoryResult[]> {
  const out: CategoryResult[] = []
  for (const s of await selectionsOf(request, now)) {
    const { title, info, date } = s.sample
    const columns = [`${s.key} as ID`, `${title} as title`, `${info} as info`, ...(date ? [`${date} as date`] : [])]
    let q = applyTo(SELECT.from(s.entity).columns(...columns), s.conds).limit(SAMPLES)
    if (date) q = q.orderBy(`${date} desc`)
    const rows = (await q) as { ID: string; title: unknown; info: unknown; date?: string }[]
    out.push({
      category: s.category,
      count: await countOf(s),
      cutoff: s.cutoff?.toISOString() ?? null,
      samples: rows.map((r) => ({ ID: String(r.ID), title: text(r.title), info: text(r.info), date: r.date ?? null }))
    })
  }
  return out
}

const text = (v: unknown) => (v === null || v === undefined ? null : truncate(String(v), 500))

/**
 * Cleans up. Refuses (409) if a category matches more rows than `expected` says (the counts of the preview the
 * user confirmed), and (400) if a category has no expected count. Each category is cleaned up in its own
 * transaction, in chunks; an error stops the cleanup, the categories done before stay done (log status PARTIAL).
 * Every execution is logged in CleanupLogs, failed ones too.
 */
export async function execute(
  request: CleanupRequest | null | undefined,
  expected: CategoryCount[] | null | undefined,
  ruleName?: string | null,
  now = new Date()
): Promise<ExecuteResult> {
  // every statement runs in an own root transaction (none in the request's): the categories commit one by one,
  // the log is written also after an error - and SQLite (one connection) does not wait for the request's
  const { selections, counts } = await cds.tx(async () => {
    const selections = await selectionsOf(request, now)
    const confirmed = new Map((expected ?? []).map((e) => [e.category, Number(e.count)]))
    const counts: CategoryCount[] = []
    for (const s of selections) {
      const allowed = confirmed.get(s.category)
      if (allowed === undefined || Number.isNaN(allowed)) throw httpError(400, `No confirmed count for ${CATEGORY_LABELS[s.category]} - preview first`)
      const count = await countOf(s)
      if (count > allowed)
        throw httpError(409, `${CATEGORY_LABELS[s.category]}: ${count} rows match now, ${allowed} were previewed - the data changed, preview again`)
      counts.push({ category: s.category, count })
    }
    return { selections, counts }
  })

  const started = Date.now()
  const done: CategoryCount[] = []
  let error: unknown
  for (const [i, s] of selections.entries()) {
    try {
      done.push({ category: s.category, count: await cleanUp(s, counts[i].count) })
    } catch (e) {
      error = e
      break
    }
  }

  const totalCount = done.reduce((n, c) => n + c.count, 0)
  const logId = cds.utils.uuid()
  await cds.tx(async () => {
    await INSERT.into('aem.suite.CleanupLogs').entries({
      ID: logId,
      summary: truncate(done.map((c) => `${CATEGORY_LABELS[c.category]} ${c.count}`).join(', ') || 'Nothing cleaned up', 500),
      status: !error ? 'DONE' : done.length ? 'PARTIAL' : 'FAILED',
      request: JSON.stringify(request),
      counts: JSON.stringify(selections.map((s, i) => ({ category: s.category, count: done[i]?.count ?? 0, cutoff: s.cutoff?.toISOString() ?? null }))),
      totalCount,
      durationMs: Date.now() - started,
      ruleName: ruleName || null,
      errorMessage: error ? truncate(errMsg(error), 1000) : null
    })
    if (ruleName) await UPDATE('aem.suite.CleanupRules').set({ lastRunAt: now.toISOString() }).where({ name: ruleName })
  })
  if (error) {
    const partly = done.length ? ` (partly done: ${done.map((c) => `${CATEGORY_LABELS[c.category]} ${c.count}`).join(', ')})` : ''
    throw httpError(500, `The cleanup failed: ${errMsg(error)}${partly}`)
  }
  return { logId, totalCount, counts: done }
}

/** Cleans up the rows of one category in chunks, in one transaction; at most `max` rows (the confirmed count). */
async function cleanUp(s: Selection, max: number): Promise<number> {
  let cleaned = 0
  await cds.tx(async () => {
    while (cleaned < max) {
      const rows = (await applyTo(SELECT.from(s.entity).columns(s.key), s.conds).limit(Math.min(CHUNK_SIZE, max - cleaned))) as Record<string, string>[]
      if (!rows.length) break
      await s.clean(rows.map((r) => r[s.key]))
      cleaned += rows.length
    }
  })
  return cleaned
}
