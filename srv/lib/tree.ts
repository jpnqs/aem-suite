import { TestCases, type TestCase } from '#cds-models/aem/suite'
import { SORT_STEP } from './defaults'
import { httpError } from './errors'

/**
 * Helpers for the test case tree (folders + test cases in aem.suite.TestCases).
 */

export type { NodeKind } from '#cds-models/aem/suite'

/** The columns of a node the tree needs (the key is always read). */
export type TreeNode = Pick<TestCase, 'parent_ID' | 'kind' | 'name' | 'sortOrder'> & { ID: string }
const TREE_COLUMNS = ['ID', 'parent_ID', 'kind', 'name', 'sortOrder'] as const

export class Tree {
  readonly byId: Map<string, TreeNode>
  readonly children = new Map<string | null, TreeNode[]>()

  constructor(nodes: TreeNode[]) {
    this.byId = new Map(nodes.map((n) => [n.ID, n]))
    for (const n of nodes) {
      const parent = n.parent_ID && this.byId.has(n.parent_ID) ? n.parent_ID : null
      const list = this.children.get(parent) ?? []
      list.push(n)
      this.children.set(parent, list)
    }
    for (const list of this.children.values()) list.sort(compareSiblings)
  }

  /** Root first, direct parent last (excluding the node itself). */
  ancestors(id: string): TreeNode[] {
    const chain: TreeNode[] = []
    const seen = new Set<string>()
    let cur = this.byId.get(id)?.parent_ID
    while (cur && !seen.has(cur) && this.byId.has(cur)) {
      seen.add(cur)
      const node = this.byId.get(cur)!
      chain.unshift(node)
      cur = node.parent_ID
    }
    return chain
  }

  /** True if `id` is `ancestorId` or lies below it. */
  isWithin(id: string, ancestorId: string): boolean {
    return id === ancestorId || this.ancestors(id).some((a) => a.ID === ancestorId)
  }

  /** Test case IDs for the given nodes - folders are expanded recursively, in tree order, without duplicates. */
  expandToTests(ids: string[]): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const visit = (node: TreeNode) => {
      if (seen.has(node.ID)) return
      seen.add(node.ID)
      if (node.kind === 'FOLDER') (this.children.get(node.ID) ?? []).forEach(visit)
      else out.push(node.ID)
    }
    for (const id of ids) {
      const node = this.byId.get(id)
      if (node) visit(node)
    }
    return out
  }
}

/** Folders first, then by manual order, then by name. */
export function compareSiblings(a: TreeNode, b: TreeNode): number {
  const kind = (a.kind === 'FOLDER' ? 0 : 1) - (b.kind === 'FOLDER' ? 0 : 1)
  if (kind) return kind
  const order = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  if (order) return order
  return (a.name ?? '').localeCompare(b.name ?? '')
}

export async function loadTree(): Promise<Tree> {
  const nodes = (await SELECT.from(TestCases).columns(...TREE_COLUMNS)) as TreeNode[]
  return new Tree(nodes)
}

// ------------------------------------------------------------------ manual order

type Sibling = TreeNode & Pick<TestCase, 'modifiedAt' | 'modifiedBy'>
const SIBLING_COLUMNS = [...TREE_COLUMNS, 'modifiedAt', 'modifiedBy'] as const

/** Reordering is no content change: modifiedAt / modifiedBy are written back unchanged. */
const unchanged = (s: Sibling) => ({ modifiedAt: s.modifiedAt, modifiedBy: s.modifiedBy })

async function siblingsOf(parentId: string | null): Promise<Sibling[]> {
  const siblings = (await SELECT.from(TestCases).columns(...SIBLING_COLUMNS).where({ parent_ID: parentId ?? null })) as Sibling[]
  return siblings.sort(compareSiblings)
}

/** Gives the nodes a clean 10, 20, 30 ... order (default: the current order of the folder's children). */
export async function renumberSiblings(parentId: string | null, order?: Sibling[]): Promise<void> {
  for (const [i, s] of (order ?? (await siblingsOf(parentId))).entries()) {
    await UPDATE(TestCases, s.ID).with({ sortOrder: (i + 1) * SORT_STEP, ...unchanged(s) })
  }
}

/**
 * Drag & drop: places the node before nextId (null = at the end).
 * Fiori sends the parent change (PATCH) in the same $batch change set, which may be processed
 * concurrently - so the target parent is derived from the next sibling, not from the node itself.
 */
export async function moveBefore(id: string, nextId: string | null): Promise<void> {
  const node = (await SELECT.one.from(TestCases).columns(...SIBLING_COLUMNS).where({ ID: id })) as Sibling | undefined
  if (!node) throw httpError(404, 'Node not found')

  if (!nextId) {
    // last position in whatever folder the node ends up in
    const max = (await SELECT.one.from(TestCases).columns('max(sortOrder) as max')) as { max: number | null }
    await UPDATE(TestCases, id).with({ sortOrder: (max?.max ?? 0) + SORT_STEP, ...unchanged(node) })
    return
  }
  const next = await SELECT.one.from(TestCases).columns('ID', 'parent_ID').where({ ID: nextId })
  if (!next) throw httpError(404, 'Next sibling not found')
  const parentId = next.parent_ID ?? null
  const siblings = (await siblingsOf(parentId)).filter((x) => x.ID !== id)
  siblings.splice(Math.max(0, siblings.findIndex((x) => x.ID === nextId)), 0, node)
  await renumberSiblings(parentId, siblings)
}
