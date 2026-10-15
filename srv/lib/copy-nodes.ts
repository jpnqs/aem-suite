import cds from '@sap/cds'
import { compareSiblings, loadTree, TreeNode } from './tree'

const TABLE = 'aem.suite.TestCases'
const MANAGED = ['createdAt', 'createdBy', 'modifiedAt', 'modifiedBy']
/** keys of the child rows (user properties, variables) that must be new for the copy */
const CHILD_KEYS = ['ID', 'testCase_ID']

type Row = Record<string, unknown> & {
  ID: string
  parent_ID: string | null
  name?: string | null
  userProperties?: Record<string, unknown>[]
  variables?: Record<string, unknown>[]
}

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
  // original and everything below it, parents before children
  const order: string[] = []
  for (let queue = [rootId]; queue.length; ) {
    const id = queue.shift()!
    order.push(id)
    queue.push(...(children.get(id) ?? []).map((c) => c.ID))
  }
  const rows = (await SELECT.from(TABLE, (t: any) => {
    t`.*`
    t.userProperties((p: any) => p`.*`)
    t.variables((v: any) => v`.*`)
  }).where({ ID: { in: order } })) as Row[]
  const byId = new Map(rows.map((r) => [r.ID, r]))

  const newIds = new Map(order.map((id) => [id, cds.utils.uuid()]))
  const original = byId.get(rootId)!
  let copyName = ''
  for (const id of order) {
    const row = byId.get(id)
    if (!row) continue // deleted meanwhile
    const isRoot = id === rootId
    const name = isRoot ? `${row.name ?? ''} (Copy)`.slice(0, 200) : row.name
    if (isRoot) copyName = name!
    await INSERT.into(TABLE).entries({
      ...omit(row, [...MANAGED, 'userProperties', 'variables']),
      ID: newIds.get(id),
      parent_ID: isRoot ? row.parent_ID : newIds.get(row.parent_ID as string),
      name,
      // right behind the original; the siblings are renumbered below
      ...(isRoot ? { sortOrder: ((row.sortOrder as number | null) ?? 0) + 1 } : {}),
      userProperties: (row.userProperties ?? []).map((p) => omit(p, CHILD_KEYS)),
      variables: (row.variables ?? []).map((v) => omit(v, CHILD_KEYS))
    })
  }
  await renumberSiblings(original.parent_ID)
  return { ID: newIds.get(rootId)!, name: copyName }
}

/** Gives the siblings a clean 10, 20, 30... order; reordering is no content change, so modified* stays. */
async function renumberSiblings(parentId: string | null): Promise<void> {
  type Sibling = TreeNode & { modifiedAt: string; modifiedBy: string }
  const siblings = (await SELECT.from(TABLE)
    .columns('ID', 'parent_ID', 'kind', 'name', 'sortOrder', 'modifiedAt', 'modifiedBy')
    .where({ parent_ID: parentId ?? null })) as Sibling[]
  siblings.sort(compareSiblings)
  for (const [i, s] of siblings.entries()) {
    await UPDATE(TABLE, s.ID).with({ sortOrder: (i + 1) * 10, modifiedAt: s.modifiedAt, modifiedBy: s.modifiedBy })
  }
}

function omit<T extends Record<string, unknown>>(row: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)))
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status, code: status })
}
