/**
 * Helpers for the test case tree (folders + test cases in aem.suite.TestCases).
 */

export interface TreeNode {
  ID: string
  parent_ID: string | null
  kind: 'FOLDER' | 'TEST' | string
  name: string | null
  sortOrder: number | null
}

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
  const nodes = (await SELECT.from('aem.suite.TestCases').columns(
    'ID',
    'parent_ID',
    'kind',
    'name',
    'sortOrder'
  )) as TreeNode[]
  return new Tree(nodes)
}
