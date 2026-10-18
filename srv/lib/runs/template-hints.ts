import { Brokers, NumberRanges } from '#cds-models/aem/suite'
import { fakerMethods } from '../template/fake-data'
import { nextExample, type NumberRange } from '../template/number-ranges'
import { loadVariableScopes, type TestCaseRecord } from './test-case-spec'

/**
 * What a template of a test case can use, for the suggestions of the payload editor: its variables (with where
 * they come from), the number ranges and the faker.js expressions. The built-ins are known to the UI (its help
 * popover lists them).
 */

export type HintKind = 'VARIABLE' | 'NUMBER_RANGE' | 'FAKER'

export interface TemplateHint {
  /** what goes between {{ and }} */
  expression: string
  kind: HintKind
  /** where the value comes from, e.g. 'Folder "Orders"' */
  source: string
  /** the value it resolves to (or an example); empty if it depends on the broker */
  value?: string | null
  /** more about it: all definitions of a variable in lookup order, the description of a number range */
  details?: string | null
}

interface Definition {
  source: string
  value: string
}

/** The hints for a test case (saved or draft: its own variables and folder come from the record). */
export async function templateHints(tc: TestCaseRecord): Promise<TemplateHint[]> {
  const brokers = (await SELECT.from(Brokers).columns('ID', 'name').where({ active: true }).orderBy('name')) as { ID: string; name: string }[]
  const vars = await loadVariableScopes(brokers.map((b) => b.ID))
  return [...variableHints(tc, vars, brokers), ...(await rangeHints()), ...fakerHints()]
}

/**
 * One hint per variable name. The definitions are listed in the lookup order of a run (test case > broker > folder,
 * inner first > global): the first one wins - but a broker variable only for that broker.
 */
function variableHints(tc: TestCaseRecord, vars: Awaited<ReturnType<typeof loadVariableScopes>>, brokers: { ID: string; name: string }[]): TemplateHint[] {
  const parentId = tc.parent_ID ?? undefined
  const folders = parentId ? [...vars.tree.ancestors(parentId), vars.tree.byId.get(parentId)].filter((f) => !!f).reverse() : []

  const byName = new Map<string, { own: Definition[]; broker: Definition[] }>()
  const add = (name: string, value: string | null | undefined, source: string, broker = false) => {
    const entry = byName.get(name) ?? { own: [], broker: [] }
    ;(broker ? entry.broker : entry.own).push({ source, value: value ?? '' })
    byName.set(name, entry)
  }
  for (const v of tc.variables ?? []) if (v.name) add(v.name, v.value, 'Test case')
  for (const f of folders) for (const [name, value] of Object.entries(vars.byFolder.get(f.ID) ?? {})) add(name, value, `Folder "${f.name}"`)
  for (const [name, value] of Object.entries(vars.global)) add(name, value, 'Global')
  for (const b of brokers) for (const [name, value] of Object.entries(vars.byBroker.get(b.ID) ?? {})) add(name, value, `Broker "${b.name}"`, true)

  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { own, broker }]) => {
      // a test case variable wins everywhere; otherwise a broker variable wins for its broker
      const testCase = own[0]?.source === 'Test case' ? own[0] : undefined
      const ordered = testCase ? [testCase, ...broker, ...own.slice(1)] : [...broker, ...own]
      const first = testCase ?? (broker.length ? undefined : own[0])
      return {
        expression: name,
        kind: 'VARIABLE' as const,
        source: first ? first.source : broker.length === 1 && !own.length ? broker[0].source : 'Depends on the broker',
        value: first ? first.value : broker.length === 1 && !own.length ? broker[0].value : null,
        details: ordered.map((d) => `${d.source}: ${d.value}`).join('\n')
      }
    })
}

async function rangeHints(): Promise<TemplateHint[]> {
  const ranges = (await SELECT.from(NumberRanges).orderBy('name')) as (NumberRange & { name: string; description?: string | null })[]
  return ranges.map((r) => ({ expression: `numberRange.${r.name}`, kind: 'NUMBER_RANGE', source: 'Number range', value: nextExample(r), details: r.description ?? null }))
}

function fakerHints(): TemplateHint[] {
  return fakerMethods().map((m) => ({ expression: m.expression, kind: 'FAKER', source: 'faker.js', value: m.example ?? null, details: null }))
}
