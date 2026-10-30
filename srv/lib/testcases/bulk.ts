import { TestCases } from '#cds-models/aem/suite'
import { httpError } from '../core/errors'
import { assertValid, NodeData, validateEnums, validateNode } from './node-validation'
import { selectNodesDeep } from './nodes'
import { joinTags, tagsOf } from './tags'
import { loadTree } from './tree'
import { DRAFTS, recordVersion } from './versions'

/** What "Edit Selected" changes - everything optional, empty = unchanged. */
export interface BulkChanges {
  deliveryMode?: string | null
  ackTimeoutMs?: number | null
  /** replaced in the topics (all occurrences, as typed - no pattern) */
  topicFind?: string | null
  topicReplace?: string | null
  addTags?: string | null
  removeTags?: string | null
}

export interface BulkResult {
  /** nodes that changed */
  updated: number
  /** names of nodes that are being edited (a draft): left alone */
  skipped: string[]
}

/**
 * Changes many test cases at once. Tags apply to the selected nodes themselves (folders too); the other changes
 * to the test cases - a selected folder stands for every test case below it. All or nothing: if one changed
 * test case breaks a rule, nothing is changed. Each changed node gets a version.
 */
export async function bulkUpdate(ids: string[], changes: BulkChanges): Promise<BulkResult> {
  const selected = [...new Set(ids ?? [])]
  if (!selected.length) throw httpError(400, 'Select at least one test case or folder')
  const c = changes ?? {}
  const testChanges = !!(c.deliveryMode || c.ackTimeoutMs != null || c.topicFind)
  const add = tagsOf(c.addTags)
  const remove = tagsOf(c.removeTags)
  if (!testChanges && !add.length && !remove.length) throw httpError(400, 'Choose at least one change')
  if (c.topicFind === '') throw httpError(400, 'Enter the text to find in the topics')

  const tree = await loadTree()
  if (selected.some((id) => !tree.byId.has(id))) throw httpError(404, 'One or more test cases not found (save drafts first)')
  const testIds = testChanges ? tree.expandToTests(selected) : []
  const tagIds = add.length || remove.length ? selected : []
  const all = [...new Set([...testIds, ...tagIds])]
  const rows = await selectNodesDeep({ ID: { in: all } })
  const drafts = new Set(((await SELECT.from(DRAFTS).columns('ID').where({ ID: { in: all } })) as { ID: string }[]).map((d) => d.ID))

  const updates: { id: string; data: Partial<NodeData> }[] = []
  const skipped: string[] = []
  for (const row of rows) {
    if (drafts.has(row.ID)) {
      skipped.push(row.name ?? row.ID)
      continue
    }
    const data: Partial<NodeData> = {}
    if (testIds.includes(row.ID) && row.kind === 'TEST') {
      if (c.deliveryMode) data.deliveryMode = c.deliveryMode as NodeData['deliveryMode']
      if (c.ackTimeoutMs != null) data.ackTimeoutMs = c.ackTimeoutMs
      if (c.topicFind && row.topic?.includes(c.topicFind)) data.topic = row.topic.split(c.topicFind).join(c.topicReplace ?? '')
    }
    if (tagIds.includes(row.ID)) {
      const tags = joinTags([...tagsOf(row.tags).filter((t) => !remove.includes(t)), ...add])
      if (tags !== (row.tags ?? null)) data.tags = tags
    }
    const changed = Object.entries(data).filter(([k, v]) => (row as Record<string, unknown>)[k] !== v)
    if (changed.length) updates.push({ id: row.ID, data: Object.fromEntries(changed) })
  }

  // the rules of a save, on the result as a whole
  const byId = new Map(rows.map((r) => [r.ID, r]))
  await assertValid((reject) => {
    for (const u of updates) {
      const merged = { ...byId.get(u.id)!, ...u.data } as NodeData
      const where = merged.name ?? merged.topic ?? u.id
      const prefixed = (status: number, message: string) => reject(status, `${where}: ${message}`)
      validateEnums(merged, prefixed)
      validateNode(merged, 'UPDATE', prefixed)
    }
  })
  for (const u of updates) {
    await UPDATE(TestCases, u.id).with({ ...u.data, modifiedAt: new Date().toISOString() })
    await recordVersion(u.id)
  }
  return { updated: updates.length, skipped }
}
