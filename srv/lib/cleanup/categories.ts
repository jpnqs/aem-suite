import { Age, cutoffOf } from './cutoff'
import { httpError } from '../core/errors'
import { activeRunIds } from '../runs/test-runner'

export type CategoryId =
  | 'RUNS'
  | 'RUN_PAYLOADS'
  | 'MESSAGES'
  | 'PRESETS'
  | 'ORPHAN_MESSAGES'
  | 'ORPHAN_PRESETS'
  | 'ORPHAN_STATS'
  | 'ORPHAN_VARIABLES'

/** Labels for the log summary (the app has its own texts). */
export const CATEGORY_LABELS: Record<CategoryId, string> = {
  RUNS: 'Test runs',
  RUN_PAYLOADS: 'Run payloads',
  MESSAGES: 'Saved messages',
  PRESETS: 'Subscriber setups',
  ORPHAN_MESSAGES: 'Orphaned saved messages',
  ORPHAN_PRESETS: 'Orphaned subscriber setups',
  ORPHAN_STATS: 'Orphaned last results',
  ORPHAN_VARIABLES: 'Orphaned broker variables'
}

type List = string[] | null | undefined

export interface RunCriteria {
  age?: Age | null
  outcomes?: List
  startedBy?: List
  brokerIds?: List
  summaryContains?: string | null
  keepNewest?: number | null
}

export interface MessageCriteria {
  age?: Age | null
  brokerIds?: List
  savedBy?: List
  sourceTypes?: List
  topicContains?: string | null
}

export interface PresetCriteria {
  age?: Age | null
  users?: List
  brokerIds?: List
  inactiveBroker?: boolean | null
}

export interface OrphanCriteria {
  messages?: boolean | null
  presets?: boolean | null
  stats?: boolean | null
  variables?: boolean | null
}

/** CleanupService.CleanupRequest */
export interface CleanupRequest {
  runs?: RunCriteria | null
  runPayloads?: RunCriteria | null
  messages?: MessageCriteria | null
  presets?: PresetCriteria | null
  orphans?: OrphanCriteria | null
}

/** One condition: the arguments of a cds.ql where() - a tagged template [strings, ...values] or a CXL string */
type Cond = unknown[]
const cond = (s: TemplateStringsArray, ...v: unknown[]): Cond => [s, ...v]

interface Filterable<Q> {
  where(...args: unknown[]): Q
}

/** A selected category: which rows of which entity it cleans up, and how. */
export interface Selection {
  category: CategoryId
  /** empty for orphans */
  cutoff: Date | null
  entity: string
  key: string
  conds: Cond[]
  /** sample columns (title, info, date) and their order: newest first */
  sample: { title: string; info: string; date?: string }
  /** cleans up the rows with these keys (in the caller's transaction) */
  clean(keys: string[]): Promise<void>
}

/** Adds conditions to a query. */
export function applyTo<Q extends Filterable<Q>>(q: Q, conds: Cond[]): Q {
  for (const c of conds) q = q.where(...c)
  return q
}

const E = (name: string) => `aem.suite.${name}`
const filled = (l: List): l is string[] => Array.isArray(l) && l.length > 0
const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/** outcome of a run as the Test Runs app shows it (TestService.TestRuns.outcome) - RUNNING runs are excluded anyway */
const OUTCOMES: Record<string, string> = {
  PASSED: `(status = 'DONE' and coalesce(failedCount, 0) = 0)`,
  FAILED: `(status = 'FAILED' or coalesce(failedCount, 0) > 0)`,
  STOPPED: `(status = 'STOPPED' and coalesce(failedCount, 0) = 0)`
}

/** the conditions on TestRuns of RUNS and RUN_PAYLOADS */
async function runConds(c: RunCriteria, cutoff: Date): Promise<Cond[]> {
  const conds: Cond[] = [cond`status != 'RUNNING'`, cond`coalesce(startedAt, createdAt) < ${cutoff.toISOString()}`]
  // a run that just ended can still have its last writes ahead
  const active = activeRunIds()
  if (active.length) conds.push(cond`ID not in ${active}`)
  if (filled(c.outcomes)) {
    const unknown = c.outcomes.filter((o) => !OUTCOMES[o])
    if (unknown.length) throw httpError(400, `Unknown outcome ${unknown.join(', ')} - use ${Object.keys(OUTCOMES).join(', ')}`)
    // (a or b) as one expression, so it stays apart from the other conditions
    conds.push(['(' + c.outcomes.map((o) => OUTCOMES[o]).join(' or ') + ')'])
  }
  if (filled(c.startedBy)) conds.push(cond`createdBy in ${c.startedBy}`)
  if (filled(c.brokerIds)) conds.push(cond`ID in ${SELECT('run_ID').from(E('RunResults')).where({ broker_ID: { in: c.brokerIds } })}`)
  if (lower(c.summaryContains)) conds.push(cond`contains(tolower(summary), ${lower(c.summaryContains)})`)
  const keep = c.keepNewest ?? 0
  if (!Number.isInteger(keep) || keep < 0) throw httpError(400, '"Keep newest" must be 0 or more')
  if (keep > 0) {
    // the newest N of all runs - read first, HANA does not take a LIMIT in an IN sub-select everywhere
    const newest = (await SELECT.from(E('TestRuns')).columns('ID').orderBy('createdAt desc').limit(keep)) as { ID: string }[]
    if (newest.length) conds.push(cond`ID not in ${newest.map((r) => r.ID)}`)
  }
  return conds
}

const runSample = { title: 'summary', info: 'createdBy', date: 'startedAt' }

/**
 * The selections of a request, in the order execute cleans them up (runs before their payloads, so payloads of
 * deleted runs are not first cleared). Throws a 400 error for invalid criteria or an empty request.
 */
export async function selectionsOf(r: CleanupRequest | null | undefined, now = new Date()): Promise<Selection[]> {
  const out: Selection[] = []
  if (r?.runs) {
    const cutoff = cutoffOf(r.runs.age, now)
    out.push({
      category: 'RUNS',
      cutoff,
      entity: E('TestRuns'),
      key: 'ID',
      conds: await runConds(r.runs, cutoff),
      sample: runSample,
      async clean(ids) {
        // the last result of a test case stays, it only loses the link to its run
        await UPDATE(E('TestCaseStats')).set({ run_ID: null }).where({ run_ID: { in: ids } })
        await DELETE.from(E('RunResults')).where({ run_ID: { in: ids } })
        await DELETE.from(E('TestRuns')).where({ ID: { in: ids } })
      }
    })
  }
  if (r?.runPayloads) {
    const cutoff = cutoffOf(r.runPayloads.age, now)
    const runs = applyTo(SELECT('ID').from(E('TestRuns')), await runConds(r.runPayloads, cutoff))
    out.push({
      category: 'RUN_PAYLOADS',
      cutoff,
      entity: E('RunResults'),
      key: 'ID',
      conds: [cond`resolvedPayload is not null`, cond`run_ID in ${runs}`],
      sample: { title: 'testCaseName', info: 'brokerName', date: 'executedAt' },
      async clean(ids) {
        await UPDATE(E('RunResults')).set({ resolvedPayload: null }).where({ ID: { in: ids } })
      }
    })
  }
  if (r?.messages) {
    const c = r.messages
    const cutoff = cutoffOf(c.age, now)
    const conds: Cond[] = [cond`coalesce(receivedAt, createdAt) < ${cutoff.toISOString()}`]
    if (filled(c.brokerIds)) conds.push(cond`broker_ID in ${c.brokerIds}`)
    if (filled(c.savedBy)) conds.push(cond`createdBy in ${c.savedBy}`)
    if (filled(c.sourceTypes)) conds.push(cond`sourceType in ${c.sourceTypes}`)
    if (lower(c.topicContains)) conds.push(cond`contains(tolower(topic), ${lower(c.topicContains)})`)
    out.push(deleting('MESSAGES', cutoff, 'ReceivedMessages', conds, { title: 'topic', info: 'brokerName', date: 'receivedAt' }))
  }
  if (r?.presets) {
    const c = r.presets
    const cutoff = cutoffOf(c.age, now)
    const conds: Cond[] = [cond`coalesce(modifiedAt, createdAt) < ${cutoff.toISOString()}`]
    if (filled(c.users)) conds.push(cond`createdBy in ${c.users}`)
    if (filled(c.brokerIds)) conds.push(cond`broker_ID in ${c.brokerIds}`)
    if (c.inactiveBroker) conds.push(cond`broker_ID in ${SELECT('ID').from(E('Brokers')).where({ active: false })}`)
    out.push(deleting('PRESETS', cutoff, 'SubscriberPresets', conds, { title: 'name', info: 'createdBy', date: 'modifiedAt' }))
  }
  const o = r?.orphans
  const brokers = () => SELECT('ID').from(E('Brokers'))
  if (o?.messages)
    out.push(deleting('ORPHAN_MESSAGES', null, 'ReceivedMessages', [cond`broker_ID is not null`, cond`broker_ID not in ${brokers()}`], { title: 'topic', info: 'brokerName', date: 'receivedAt' }))
  if (o?.presets)
    out.push(deleting('ORPHAN_PRESETS', null, 'SubscriberPresets', [cond`broker_ID is not null`, cond`broker_ID not in ${brokers()}`], { title: 'name', info: 'createdBy', date: 'modifiedAt' }))
  if (o?.stats)
    out.push(
      deleting('ORPHAN_STATS', null, 'TestCaseStats', [cond`testCase_ID not in ${SELECT('ID').from(E('TestCases'))}`], { title: 'brokers', info: 'status', date: 'runAt' }, 'testCase_ID')
    )
  if (o?.variables)
    out.push(deleting('ORPHAN_VARIABLES', null, 'Variables', [cond`broker_ID is not null`, cond`broker_ID not in ${brokers()}`], { title: 'name', info: 'value' }))
  if (!out.length) throw httpError(400, 'Choose at least one kind of data to clean up')
  return out
}

/** a category that deletes the rows of one entity */
function deleting(category: CategoryId, cutoff: Date | null, entity: string, conds: Cond[], sample: Selection['sample'], key = 'ID'): Selection {
  return {
    category,
    cutoff,
    entity: E(entity),
    key,
    conds,
    sample,
    async clean(keys) {
      await DELETE.from(E(entity)).where({ [key]: { in: keys } })
    }
  }
}
