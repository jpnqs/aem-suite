import cds from '@sap/cds'
import { normalizeBrokerUrl } from '../broker/url'
import { errMsg, httpError } from '../core/errors'
import { elementOf } from '../core/model'
import { collectProblems, VAR_NAME, VAR_NAME_RULE, type Reject } from '../testcases/node-validation'
import { checkBroker, checkNumberRange } from './checks'

/**
 * Export / import of the admin configuration - number ranges, brokers, global variables - as a JSON file, to move
 * a setup from one system to another or keep it in Git:
 *   { "format": "aem-suite.number-ranges", "version": 1, "exportedAt": "...", "numberRanges": [ { "name": "ORDERS", ... } ] }
 *
 * Entries are matched by name (ignoring case): a new name is created, an existing one is updated with the fields
 * of the file; nothing is deleted. What belongs to one system stays out of the file: IDs, authors, the counter of a
 * number range, the connection status of a broker. There are no passwords to export (they are never stored).
 * Import applies the rules of the apps and either imports everything or - if anything is wrong - nothing.
 */

export type ConfigKind = 'NUMBER_RANGES' | 'BROKERS' | 'VARIABLES'

export const VERSION = 1
const MAX_ENTRIES = 1000
const MAX_PROBLEMS_SHOWN = 20

type FieldType = 'text' | 'int' | 'int64' | 'bool'

interface KindSpec {
  /** entity of db/schema.cds, without namespace */
  entity: string
  /** only these rows belong to the kind (global variables: no broker) */
  where?: Record<string, unknown>
  format: string
  /** key of the list in the file */
  list: string
  /** file name of a whole export */
  file: string
  one: string
  many: string
  /** fields besides the name, in file order */
  fields: Record<string, FieldType>
  /** broker variables travel with the broker */
  variables?: boolean
  /** the rules of the app; d is the complete entity */
  check(d: Row, event: 'CREATE' | 'UPDATE', reject: Reject): void
}

export const KINDS: Record<ConfigKind, KindSpec> = {
  NUMBER_RANGES: {
    entity: 'NumberRanges',
    format: 'aem-suite.number-ranges',
    list: 'numberRanges',
    file: 'aem-suite-number-ranges',
    one: 'number range',
    many: 'number ranges',
    fields: { description: 'text', prefix: 'text', suffix: 'text', length: 'int', start: 'int64', step: 'int', maximum: 'int64' },
    check: (d, _event, reject) => checkNumberRange(d, true, reject)
  },
  BROKERS: {
    entity: 'Brokers',
    format: 'aem-suite.brokers',
    list: 'brokers',
    file: 'aem-suite-brokers',
    one: 'broker',
    many: 'brokers',
    fields: {
      description: 'text',
      credentialMode: 'text',
      destinationName: 'text',
      url: 'text',
      msgVpn: 'text',
      username: 'text',
      clientNamePrefix: 'text',
      connectTimeoutMs: 'int',
      active: 'bool',
      agentAllowed: 'bool'
    },
    variables: true,
    check: (d, event, reject) => checkBroker(d as Parameters<typeof checkBroker>[0], event, reject)
  },
  VARIABLES: {
    entity: 'Variables',
    where: { broker_ID: null },
    format: 'aem-suite.variables',
    list: 'variables',
    file: 'aem-suite-global-variables',
    one: 'global variable',
    many: 'global variables',
    fields: { value: 'text' },
    check: (d, _event, reject) => {
      if (!VAR_NAME.test(String(d.name ?? ''))) reject(400, VAR_NAME_RULE, 'in/name')
    }
  }
}

type Row = Record<string, unknown> & { ID?: string; name?: string; variables?: VariableDoc[] }

export interface VariableDoc {
  name: string
  value?: string
}

export interface ExportResult {
  filename: string
  content: string
  count: number
}

export interface ImportResult {
  dryRun: boolean
  created: number
  updated: number
}

export const isConfigKind = (kind: unknown): kind is ConfigKind => typeof kind === 'string' && Object.hasOwn(KINDS, kind)

// ------------------------------------------------------------------------------------------------ export

/** The given entries (no IDs: all of the kind) as the content of a JSON file, sorted by name. */
export async function exportConfig(kind: ConfigKind, ids?: string[] | null): Promise<ExportResult> {
  const spec = KINDS[kind]
  const rows = await selectRows(spec)
  const wanted = new Set(ids ?? [])
  const chosen = wanted.size ? rows.filter((r) => wanted.has(r.ID!)) : rows
  if (chosen.length < wanted.size) throw httpError(404, `One or more ${spec.many} not found`)

  const entries = chosen.map((r) => {
    const entry: Row = { name: r.name }
    for (const [field, type] of Object.entries(spec.fields)) {
      const value = r[field]
      if (value === null || value === undefined) continue
      // Integer64 comes as text: a number in the file, unless it is too big for JSON readers
      entry[field] = type === 'int64' && Number.isSafeInteger(Number(value)) ? Number(value) : value
    }
    if (spec.variables && r.variables?.length) entry.variables = r.variables.map((v) => (v.value === null || v.value === undefined ? { name: v.name } : { name: v.name, value: v.value }))
    return entry
  })

  const exportedAt = new Date().toISOString()
  const only = chosen.length === 1 ? fileNameOf(chosen[0].name!) : ''
  return {
    filename: `${only ? `${spec.file}-${only}` : `${spec.file}-${exportedAt.slice(0, 10)}`}.json`,
    content: JSON.stringify({ format: spec.format, version: VERSION, exportedAt, [spec.list]: entries }, null, 2),
    count: entries.length
  }
}

// ------------------------------------------------------------------------------------------------ import

interface Entry {
  /** readable position for messages, e.g. 'broker "aem-dev"' */
  where: string
  /** the fields of the file, as they will be stored */
  d: Row
  existing?: Row
}

/**
 * Checks a file and, unless dryRun, creates and updates its entries. All or nothing.
 * `isDraft` tells which saved entries are being edited in the app - they are not changed underneath the user.
 */
export async function importConfig(
  kind: ConfigKind,
  content: string,
  opts: { dryRun?: boolean; isDraft?: (ids: string[]) => Promise<string[]> } = {}
): Promise<ImportResult> {
  const spec = KINDS[kind]
  const list = parseDocument(spec, content)
  const problems: string[] = []
  const entries = readEntries(spec, list, problems)

  // match by name; a name twice in the file or in the system cannot be matched
  const byName = new Map<string, Row[]>()
  for (const r of await selectRows(spec)) byName.set(key(r.name), [...(byName.get(key(r.name)) ?? []), r])
  const seen = new Set<string>()
  for (const e of entries) {
    const name = key(e.d.name)
    if (seen.has(name)) problems.push(`${e.where}: the name is in the file more than once`)
    seen.add(name)
    const matches = byName.get(name) ?? []
    if (matches.length > 1) problems.push(`${e.where}: ${matches.length} ${spec.many} with this name exist - rename them first`)
    else e.existing = matches[0]
  }
  const editing = new Set(opts.isDraft ? await opts.isDraft(entries.flatMap((e) => (e.existing ? [e.existing.ID!] : []))) : [])
  for (const e of entries) if (e.existing && editing.has(e.existing.ID!)) problems.push(`${e.where}: is being edited in the app - save or discard the changes first`)

  for (const e of entries) {
    if (problems.some((p) => p.startsWith(`${e.where}:`))) continue
    const merged = { ...e.existing, ...e.d, variables: mergeVariables(e.existing?.variables, e.d.variables) }
    problems.push(...(await collectProblems((reject) => spec.check(merged, e.existing ? 'UPDATE' : 'CREATE', reject), e.where)))
  }

  if (problems.length) {
    const shown = problems.slice(0, MAX_PROBLEMS_SHOWN).join('; ')
    const more = problems.length > MAX_PROBLEMS_SHOWN ? ` (and ${problems.length - MAX_PROBLEMS_SHOWN} more)` : ''
    throw httpError(400, `Nothing was imported: ${shown}${more}`)
  }

  const created = entries.filter((e) => !e.existing).length
  if (!opts.dryRun) await write(spec, entries)
  return { dryRun: !!opts.dryRun, created, updated: entries.length - created }
}

/** The file's top level: JSON, format, version and the list. */
function parseDocument(spec: KindSpec, content: string): unknown[] {
  let doc: unknown
  try {
    doc = JSON.parse(content)
  } catch (e) {
    throw httpError(400, `Nothing was imported: the file is not valid JSON (${errMsg(e)})`)
  }
  const file = doc as Record<string, unknown> | null
  if (!file || typeof file !== 'object' || file.format !== spec.format) {
    const other = Object.values(KINDS).find((k) => k.format === file?.format)
    throw httpError(400, `Nothing was imported: ${other ? `this file holds ${other.many}, not ${spec.many}` : `this is not an AEM Test Suite export of ${spec.many} (format "${spec.format}" expected)`}`)
  }
  if (typeof file.version !== 'number' || file.version > VERSION)
    throw httpError(400, `Nothing was imported: the file has format version ${file.version}, this system understands up to ${VERSION} - update the application first`)
  const list = file[spec.list]
  if (!Array.isArray(list) || !list.length) throw httpError(400, `Nothing was imported: the file contains no ${spec.many}`)
  if (list.length > MAX_ENTRIES) throw httpError(400, `Nothing was imported: the file has more than ${MAX_ENTRIES} ${spec.many} - split it`)
  return list
}

/** The entries of the file with the problems of their types and sizes. Fields that are missing stay as they are. */
function readEntries(spec: KindSpec, list: unknown[], problems: string[]): Entry[] {
  const entries: Entry[] = []
  list.forEach((raw, i) => {
    const item = raw as Record<string, unknown> | null
    const name = typeof item?.name === 'string' ? item.name.trim() : ''
    const where = name ? `${spec.one} "${name}"` : `${spec.one} #${i + 1}`
    if (!item || typeof item !== 'object' || Array.isArray(item)) return void problems.push(`${where}: not an object`)
    if (!name) return void problems.push(`${where}: needs a name`)

    const d: Row = { name }
    const own: string[] = []
    for (const [field, type] of Object.entries(spec.fields)) {
      const value = item[field]
      if (value === undefined) continue
      const problem = readField(type, value)
      if (problem) own.push(`${where}: ${field}: ${problem}`)
      // Integer64 as text: no precision lost
      else d[field] = type === 'int64' && value !== null ? String(value) : value
    }
    if (typeof d.url === 'string' && d.url) d.url = normalizeBrokerUrl(d.url)
    if (spec.variables && item.variables !== undefined) d.variables = readVariables(item.variables, where, own)
    own.push(...columnProblems(spec.entity, d, where))
    problems.push(...own)
    entries.push({ where, d })
  })
  return entries
}

/** What is wrong with a value of the file for a field of this type, if anything (null = empty the field). */
function readField(type: FieldType, value: unknown): string | undefined {
  if (value === null) return undefined
  if (type === 'text') return typeof value === 'string' ? undefined : 'must be text'
  if (type === 'bool') return typeof value === 'boolean' ? undefined : 'must be true or false'
  if (type === 'int') return Number.isInteger(value) ? undefined : 'must be a whole number'
  // Integer64: a number, or digits as text for numbers too big for JSON readers
  return Number.isSafeInteger(value) || (typeof value === 'string' && /^-?\d+$/.test(value)) ? undefined : 'must be a whole number'
}

function readVariables(value: unknown, where: string, problems: string[]): VariableDoc[] {
  if (!Array.isArray(value)) return problems.push(`${where}: variables must be a list`), []
  const out: VariableDoc[] = []
  value.forEach((v, i) => {
    const item = v as Record<string, unknown> | null
    if (!item || typeof item !== 'object' || typeof item.name !== 'string') return void problems.push(`${where}: variables[${i}] needs a name`)
    const val = item.value
    if (val !== undefined && val !== null && typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean')
      return void problems.push(`${where}: variables[${i}].value must be text`)
    const variable: VariableDoc = { name: item.name.trim() }
    if (val !== undefined && val !== null) variable.value = String(val)
    if (out.some((o) => o.name === variable.name)) problems.push(`${where}: variable "${variable.name}" is in the file more than once`)
    out.push(variable)
    problems.push(...columnProblems('Variables', { ...variable }, `${where}: variable "${variable.name}"`))
  })
  return out
}

/** Length, allowed values and range of the columns (db/schema.cds) - direct writes are not checked by CAP. */
function columnProblems(entity: string, d: Record<string, unknown>, where: string): string[] {
  const problems: string[] = []
  for (const [field, value] of Object.entries(d)) {
    const element = elementOf(entity, field) as (ReturnType<typeof elementOf> & { '@mandatory'?: boolean }) | undefined
    if (!element || value === undefined) continue
    if (value === null) {
      if (element['@mandatory']) problems.push(`${where}: ${field}: must not be empty`)
      continue
    }
    if (typeof value === 'string' && element.length && value.length > element.length) problems.push(`${where}: ${field}: at most ${element.length} characters`)
    if (element.enum && !Object.hasOwn(element.enum, String(value))) problems.push(`${where}: ${field}: must be one of ${Object.keys(element.enum).join(', ')}`)
    const range = element['@assert.range']
    if (Array.isArray(range) && typeof value === 'number' && (value < Number(range[0]) || value > Number(range[1])))
      problems.push(`${where}: ${field}: must be between ${range[0]} and ${range[1]}`)
  }
  return problems
}

/** Variables of the file over the saved ones: same name = new value, others are kept. */
function mergeVariables(saved: VariableDoc[] | undefined, file: VariableDoc[] | undefined): VariableDoc[] | undefined {
  if (!file) return saved
  const merged = new Map((saved ?? []).map((v) => [v.name, v]))
  for (const v of file) merged.set(v.name, { ...merged.get(v.name), ...v })
  return [...merged.values()]
}

/** New entries are created, existing ones get the fields of the file. Runs in the transaction of the request. */
async function write(spec: KindSpec, entries: Entry[]): Promise<void> {
  const entity = `aem.suite.${spec.entity}`
  const fresh = entries.filter((e) => !e.existing)
  if (fresh.length)
    await INSERT.into(entity).entries(
      fresh.map(({ d }) => ({ ...spec.where, ...d, ID: cds.utils.uuid(), ...(spec.variables ? { variables: (d.variables ?? []).map((v) => ({ ...v })) } : {}) }))
    )
  for (const { d, existing } of entries) {
    if (!existing) continue
    const { variables, name, ...fields } = d
    // the name as in the file: "orders" in the file renames "ORDERS"
    await UPDATE(entity).set({ ...fields, name }).where({ ID: existing.ID })
    for (const v of variables ?? []) {
      const saved = existing.variables?.find((s) => s.name === v.name) as (VariableDoc & { ID?: string }) | undefined
      if (saved) await UPDATE('aem.suite.Variables').set({ value: v.value ?? null }).where({ ID: saved.ID })
      else await INSERT.into('aem.suite.Variables').entries({ ID: cds.utils.uuid(), broker_ID: existing.ID, ...v })
    }
  }
}

// ------------------------------------------------------------------------------------------------ helpers

async function selectRows(spec: KindSpec): Promise<Row[]> {
  const columns = ['ID', 'name', ...Object.keys(spec.fields)]
  const query = SELECT.from(`aem.suite.${spec.entity}`).columns(...columns)
  if (spec.where) query.where(spec.where)
  const rows = (await query) as Row[]
  if (spec.variables) {
    const variables = (await SELECT.from('aem.suite.Variables').columns('ID', 'broker_ID', 'name', 'value').where({ broker_ID: { '!=': null } })) as (VariableDoc & {
      ID: string
      broker_ID: string
    })[]
    for (const r of rows) r.variables = variables.filter((v) => v.broker_ID === r.ID).sort((a, b) => a.name.localeCompare(b.name)).map(({ broker_ID: _, ...v }) => v)
  }
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

const key = (name: unknown) => String(name ?? '').toLowerCase()

/** File name part from a name: ASCII letters and digits, hyphen separated. */
const fileNameOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
