import cds from '@sap/cds'
import { SORT_STEP } from '../core/defaults'
import { errMsg, httpError } from '../core/errors'
import { collectProblems, nextSortOrder, NodeData, validateEnums, validateNode, validateParent } from './node-validation'
import { TestCases } from '#cds-models/aem/suite'
import { selectNodesDeep } from './nodes'
import { FOLDER_FIELDS, TEST_FIELDS } from './test-fields'
import { Tree, TreeNode } from './tree'
import type { NodeKind } from '#cds-models/aem/suite'

/**
 * Export / import of test cases and folders as a JSON file.
 *
 * The file is a nested tree without IDs (so it moves between systems and reads well in Git):
 *   { "format": "aem-suite.test-cases", "version": 1, "exportedAt": "...", "nodes": [ { "kind": "FOLDER", "name": "...", "children": [ ... ] }, ... ] }
 * Import always creates new nodes (nothing existing is changed), applies the validation of the UI, and either
 * imports everything or - if anything is wrong - nothing.
 */

export const FORMAT = 'aem-suite.test-cases'
export const VERSION = 1
const MAX_NODES = 5000
const MAX_DEPTH = 20
const MAX_PROBLEMS_SHOWN = 20

export interface PropertyDoc {
  name: string
  type?: string
  value?: string
}
export interface VariableDoc {
  name: string
  value?: string
}
export interface NodeDoc {
  kind: NodeKind
  name?: string
  description?: string
  topic?: string
  payload?: string
  contentType?: string
  deliveryMode?: string
  timeToLiveMs?: number
  dmqEligible?: boolean
  priority?: number
  correlationId?: string
  ackTimeoutMs?: number
  userProperties?: PropertyDoc[]
  variables?: VariableDoc[]
  children?: NodeDoc[]
}
export interface ExportDocument {
  format: string
  version: number
  exportedAt: string
  nodes: NodeDoc[]
}

export interface ExportResult {
  filename: string
  content: string
  folders: number
  testCases: number
}

export interface ImportResult {
  dryRun: boolean
  folders: number
  testCases: number
  userProperties: number
  variables: number
  /** the top-level nodes of the file (IDs only for a real import) */
  roots: { ID?: string; name: string; kind: string }[]
  /** name of the folder the nodes go into, empty = top level */
  target: string | null
}

// ------------------------------------------------------------------------------------------------ export

/**
 * Builds the export of the given nodes (a folder comes with everything below it; nodes below another selected
 * node are part of that node only). Without IDs the whole tree is exported.
 */
export async function exportNodes(ids?: string[] | null): Promise<ExportResult> {
  const rows = await selectNodesDeep()
  const tree = new Tree(rows)
  const byId = new Map(rows.map((r) => [r.ID, r]))

  const wanted = [...new Set(ids ?? [])]
  const unknown = wanted.filter((id) => !byId.has(id))
  if (unknown.length) throw httpError(404, 'One or more test cases or folders not found')

  // roots in tree order (folders first, manual order)
  const order: string[] = []
  const walk = (n: TreeNode) => {
    order.push(n.ID)
    for (const c of tree.children.get(n.ID) ?? []) walk(c)
  }
  for (const n of tree.children.get(null) ?? []) walk(n)
  const roots = wanted.length
    ? order.filter((id) => wanted.includes(id) && !tree.ancestors(id).some((a) => wanted.includes(a.ID)))
    : (tree.children.get(null) ?? []).map((n) => n.ID)

  let folders = 0
  let testCases = 0
  const toDoc = (id: string): NodeDoc => {
    const r = byId.get(id)!
    const variables = sorted(r.variables)?.map((v) => compact({ name: v.name, value: v.value ?? '' }) as VariableDoc)
    const fields = (names: readonly string[]) => Object.fromEntries(names.map((f) => [f, r[f]]))
    if (r.kind === 'FOLDER') {
      folders++
      return compact({
        kind: 'FOLDER',
        ...fields(FOLDER_FIELDS),
        variables: variables?.length ? variables : undefined,
        children: (tree.children.get(id) ?? []).map((c) => toDoc(c.ID))
      }) as NodeDoc
    }
    testCases++
    const props = sorted(r.userProperties)?.map((p) => compact({ name: p.name, type: p.type, value: p.value ?? '' }) as PropertyDoc)
    return compact({
      kind: 'TEST',
      ...fields(Object.keys(TEST_FIELDS)),
      userProperties: props?.length ? props : undefined,
      variables: variables?.length ? variables : undefined
    }) as NodeDoc
  }

  const document: ExportDocument = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), nodes: roots.map(toDoc) }
  const only = roots.length === 1 ? byId.get(roots[0])!.name : null
  return {
    filename: `${only ? fileNameOf(only) : 'aem-suite-test-cases'}${only ? '' : `-${document.exportedAt.slice(0, 10)}`}.json`,
    content: JSON.stringify(document, null, 2),
    folders,
    testCases
  }
}

// ------------------------------------------------------------------------------------------------ import

interface Flat {
  /** readable position for messages, e.g. "Orders / EU / created" */
  path: string
  depth: number
  parent: number | null
  d: NodeData & { description?: string | null }
  /** the node itself has a structural problem (wrong type, ...): the field rules are not run for it, so it does not produce follow-up noise */
  broken: boolean
}

/** Checks a file and, unless dryRun, creates its nodes below parentId (empty = top level). All or nothing. */
export async function importNodes(content: string, opts: { parentId?: string | null; dryRun?: boolean } = {}): Promise<ImportResult> {
  const file = parseDocument(content)
  const { flat, problems } = flatten(file.nodes)
  const parentId = opts.parentId ?? null
  problems.push(...(await validate(flat, parentId)))
  if (problems.length) {
    const shown = problems.slice(0, MAX_PROBLEMS_SHOWN).join('; ')
    const more = problems.length > MAX_PROBLEMS_SHOWN ? ` (and ${problems.length - MAX_PROBLEMS_SHOWN} more)` : ''
    throw httpError(400, `Nothing was imported: ${shown}${more}`)
  }

  const target = parentId ? ((await SELECT.one.from(TestCases).columns('name').where({ ID: parentId }))?.name ?? null) : null
  const count = (kind: string) => flat.filter((n) => n.d.kind === kind).length
  const result: ImportResult = {
    dryRun: !!opts.dryRun,
    folders: count('FOLDER'),
    testCases: count('TEST'),
    userProperties: flat.reduce((s, n) => s + (n.d.userProperties?.length ?? 0), 0),
    variables: flat.reduce((s, n) => s + (n.d.variables?.length ?? 0), 0),
    roots: flat.filter((n) => n.parent === null).map((n) => ({ ID: opts.dryRun ? undefined : n.d.ID, name: n.d.name ?? n.d.topic ?? '', kind: n.d.kind as string })),
    target
  }
  if (!opts.dryRun) await write(flat, parentId)
  return result
}

/** The file's top level: JSON, format and version. */
function parseDocument(content: string): ExportDocument {
  let doc: unknown
  try {
    doc = JSON.parse(content)
  } catch (e) {
    throw httpError(400, `Nothing was imported: the file is not valid JSON (${errMsg(e)})`)
  }
  const file = doc as Partial<ExportDocument> | null
  if (!file || typeof file !== 'object' || file.format !== FORMAT)
    throw httpError(400, `Nothing was imported: this is not an AEM Test Suite export (format "${FORMAT}" expected)`)
  if (typeof file.version !== 'number' || file.version > VERSION)
    throw httpError(400, `Nothing was imported: the file has format version ${file.version}, this system understands up to ${VERSION} - update the application first`)
  if (!Array.isArray(file.nodes) || !file.nodes.length) throw httpError(400, 'Nothing was imported: the file contains no test cases or folders')
  return file as ExportDocument
}

/** The nested nodes as a list (parents before children), with the problems of their structure and field types. */
function flatten(nodes: unknown[]): { flat: Flat[]; problems: string[] } {
  const flat: Flat[] = []
  const problems: string[] = []
  const collect = (list: unknown[], parent: number | null, depth: number, prefix: string) => {
    list.forEach((raw, i) => {
      if (flat.length >= MAX_NODES) return
      const where = `${prefix}${prefix ? ' / ' : ''}${nameOf(raw) ?? `#${i + 1}`}`
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return void problems.push(`${where}: not an object`)
      const n = raw as Record<string, unknown>
      const kind = n.kind ?? (Array.isArray(n.children) ? 'FOLDER' : 'TEST')
      if (kind !== 'FOLDER' && kind !== 'TEST') return void problems.push(`${where}: kind must be FOLDER or TEST`)
      if (depth > MAX_DEPTH) return void problems.push(`${where}: folders are nested deeper than ${MAX_DEPTH} levels`)
      const own: string[] = []
      if (kind === 'TEST' && n.children !== undefined) own.push(`${where}: a test case cannot have children`)
      const d = nodeData(n, kind, where, own)
      problems.push(...own)

      const index = flat.push({ path: where, depth, parent, d, broken: own.length > 0 }) - 1
      if (kind === 'FOLDER' && n.children !== undefined) {
        if (Array.isArray(n.children)) collect(n.children, index, depth + 1, where)
        else problems.push(`${where}: children must be a list`)
      }
    })
  }
  collect(nodes, null, 0, '')
  if (flat.length >= MAX_NODES) problems.push(`the file has more than ${MAX_NODES} test cases and folders - split it`)
  return { flat, problems }
}

/** The fields of one node of the file, as the node will be stored (with a new ID). */
function nodeData(n: Record<string, unknown>, kind: NodeKind, where: string, problems: string[]): Flat['d'] {
  const d: Record<string, unknown> = { ID: cds.utils.uuid(), kind }
  const text = (k: string) => {
    if (n[k] === undefined || n[k] === null) return
    if (typeof n[k] === 'string') d[k] = n[k]
    else if (k === 'payload' && typeof n[k] === 'object') d[k] = JSON.stringify(n[k], null, 2)
    else problems.push(`${where}: ${k} must be text`)
  }
  const whole = (k: string) => {
    if (n[k] === undefined || n[k] === null) return
    if (typeof n[k] === 'number' && Number.isInteger(n[k])) d[k] = n[k]
    else problems.push(`${where}: ${k} must be a whole number`)
  }
  const bool = (k: string) => {
    if (n[k] === undefined || n[k] === null) return
    if (typeof n[k] === 'boolean') d[k] = n[k]
    else problems.push(`${where}: ${k} must be true or false`)
  }
  const read = { text, int: whole, bool }
  for (const [k, type] of Object.entries(TEST_FIELDS)) if (kind === 'TEST' || FOLDER_FIELDS.includes(k as keyof typeof TEST_FIELDS)) read[type](k)
  if (kind === 'TEST') d.userProperties = listOf(n.userProperties, 'userProperties', where, problems, ['name', 'type', 'value'])
  d.variables = listOf(n.variables, 'variables', where, problems, ['name', 'value'])
  return d as unknown as Flat['d']
}

/** Same rules as in the UI, all problems of the file in one go. */
async function validate(flat: Flat[], parentId: string | null): Promise<string[]> {
  const problems: string[] = []
  for (const n of flat) {
    if (n.broken) continue
    problems.push(
      ...(await collectProblems((reject) => {
        validateEnums(n.d, reject)
        validateNode(n.d, 'CREATE', reject)
      }, n.path))
    )
  }
  if (parentId)
    problems.push(...(await collectProblems((reject) => validateParent({ parent_ID: parentId }, undefined, (s, message) => reject(s, message)), 'target folder')))
  return problems
}

/** Parents before children (one INSERT per depth); the new nodes go behind the existing ones of their folder. */
async function write(flat: Flat[], parentId: string | null): Promise<void> {
  const firstOrder = await nextSortOrder(parentId)
  const position = new Map<number | null, number>()
  const rowFor = (n: Flat) => {
    const slot = position.get(n.parent) ?? 0
    position.set(n.parent, slot + 1)
    return {
      ...n.d,
      parent_ID: n.parent === null ? parentId : flat[n.parent].d.ID,
      sortOrder: n.parent === null ? firstOrder + slot * SORT_STEP : (slot + 1) * SORT_STEP,
      userProperties: n.d.userProperties?.map((p) => ({ ...p })) ?? [],
      variables: n.d.variables?.map((v) => ({ ...v })) ?? []
    }
  }
  const rowsByDepth = new Map<number, ReturnType<typeof rowFor>[]>()
  for (const n of flat) {
    const rows = rowsByDepth.get(n.depth) ?? []
    rows.push(rowFor(n))
    rowsByDepth.set(n.depth, rows)
  }
  for (const depth of [...rowsByDepth.keys()].sort((a, b) => a - b)) await INSERT.into(TestCases).entries(rowsByDepth.get(depth)!)
}

// ------------------------------------------------------------------------------------------------ helpers

function listOf(value: unknown, field: string, where: string, problems: string[], keys: string[]): { [k: string]: string }[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return void problems.push(`${where}: ${field} must be a list`), []
  const out: { [k: string]: string }[] = []
  value.forEach((item, i) => {
    if (!item || typeof item !== 'object') return void problems.push(`${where}: ${field}[${i}] must be an object`)
    const entry: { [k: string]: string } = {}
    for (const k of keys) {
      const v = (item as Record<string, unknown>)[k]
      if (v === undefined || v === null) continue
      if (typeof v === 'string') entry[k] = v
      else if (typeof v === 'number' || typeof v === 'boolean') entry[k] = String(v) // {"qty": 5} is fine in a hand-written file
      else problems.push(`${where}: ${field}[${i}].${k} must be text`)
    }
    if (!entry.name) problems.push(`${where}: ${field}[${i}] needs a name`)
    out.push(entry)
  })
  return out
}

const nameOf = (raw: unknown): string | undefined => {
  const n = (raw as { name?: unknown; topic?: unknown } | null) ?? {}
  return typeof n.name === 'string' && n.name ? n.name : typeof n.topic === 'string' && n.topic ? n.topic : undefined
}

const sorted = <T extends { name: string }>(list?: T[]): T[] | undefined => list && [...list].sort((a, b) => a.name.localeCompare(b.name))

/** Drops null / undefined so the file only holds what is set. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>
}

/** File name part from a node name: ASCII letters and digits, hyphen separated. */
const fileNameOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'aem-suite-test-cases'
