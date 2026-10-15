import { assertValid, nextSortOrder, NodeData, validateEnums, validateNode, validateParent } from './node-validation'

/**
 * Reading and writing test cases / folders outside of the OData CRUD path (agent, live view, copy, export).
 */

export const TABLE = 'aem.suite.TestCases'

export type NodeRow = NodeData & Record<string, unknown>

/** Test cases / folders with their user properties and variables (all columns). */
export async function selectNodesDeep(where?: Record<string, unknown>, from: unknown = TABLE): Promise<NodeRow[]> {
  const query = SELECT.from(from as string, (t: any) => {
    t`.*`
    t.userProperties((p: any) => p`.*`)
    t.variables((v: any) => v`.*`)
  })
  return (await (where ? query.where(where) : query)) as NodeRow[]
}

export async function selectNodeDeep(id: string, from: unknown = TABLE): Promise<NodeRow | undefined> {
  const [row] = await selectNodesDeep({ ID: id }, from)
  return row
}

/**
 * Creates a test case or folder with the same rules as the UI (throws a 400 with all problems),
 * placed behind the last node of its folder.
 */
export async function createNode(d: NodeData): Promise<{ ID: string; name: string; kind: string }> {
  await assertValid(async (reject) => {
    validateEnums(d, reject)
    validateNode(d, 'CREATE', reject)
    await validateParent(d, undefined, reject)
  })
  d.sortOrder = await nextSortOrder(d.parent_ID)
  await INSERT.into(TABLE).entries(d)
  return { ID: d.ID, name: d.name, kind: d.kind as string }
}
