import cds from '@sap/cds'
import { TestCases } from '#cds-models/aem/suite'
import { httpError } from '../core/errors'
import { columnLength } from '../core/model'
import { selectNodesDeep } from './nodes'
import { loadTree, renumberSiblings, TreeNode } from './tree'

const MANAGED = ['createdAt', 'createdBy', 'modifiedAt', 'modifiedBy']
/** keys of the child rows (user properties, variables) that must be new for the copy */
const CHILD_KEYS = ['ID', 'testCase_ID']

export interface CopyResult {
  ID: string
  name: string
}

/**
 * Copies test cases and folders. A folder is copied with everything below it (subfolders, test cases,
 * user properties, variables). Nodes that lie below another selected node are copied with that node only.
 * Every copy is named "<name> (Copy)" and placed right after its original.
 */
export async function copyNodes(ids: string[]): Promise<CopyResult[]> {
  const wanted = [...new Set(ids ?? [])]
  if (!wanted.length) throw httpError(400, 'Select at least one test case or folder')
  const tree = await loadTree()
  const unknown = wanted.filter((id) => !tree.byId.has(id))
  if (unknown.length) throw httpError(404, 'One or more test cases not found (save drafts first)')

  const roots = wanted.filter((id) => !tree.ancestors(id).some((a) => wanted.includes(a.ID)))
  const results: CopyResult[] = []
  for (const rootId of roots) results.push(await copySubtree(rootId, tree.children))
  return results
}

async function copySubtree(rootId: string, children: Map<string | null, TreeNode[]>): Promise<CopyResult> {
  // original and everything below it, level by level (parents before children)
  const levels: string[][] = []
  for (let level = [rootId]; level.length; level = level.flatMap((id) => (children.get(id) ?? []).map((c) => c.ID))) levels.push(level)
  const order = levels.flat()
  const rows = await selectNodesDeep({ ID: { in: order } })
  const byId = new Map(rows.map((r) => [r.ID, r]))

  const newIds = new Map(order.map((id) => [id, cds.utils.uuid()]))
  const original = byId.get(rootId)!
  const copyName = `${original.name ?? ''} (Copy)`.slice(0, columnLength('TestCases', 'name'))
  const copyOf = (id: string) => {
    const row = byId.get(id)
    if (!row) return undefined // deleted meanwhile
    const isRoot = id === rootId
    return {
      ...omit(row, [...MANAGED, 'userProperties', 'variables']),
      ID: newIds.get(id),
      parent_ID: isRoot ? row.parent_ID : newIds.get(row.parent_ID as string),
      name: isRoot ? copyName : row.name,
      // right behind the original; the siblings are renumbered below
      ...(isRoot ? { sortOrder: (row.sortOrder ?? 0) + 1 } : {}),
      userProperties: (row.userProperties ?? []).map((p) => omit(p, CHILD_KEYS)),
      variables: (row.variables ?? []).map((v) => omit(v, CHILD_KEYS))
    }
  }
  // one (deep) INSERT per level
  for (const level of levels) {
    const entries = level.map(copyOf).filter((e) => e !== undefined)
    if (entries.length) await INSERT.into(TestCases).entries(entries)
  }
  await renumberSiblings(original.parent_ID ?? null)
  return { ID: newIds.get(rootId)!, name: copyName }
}

function omit<T extends Record<string, unknown>>(row: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)))
}
