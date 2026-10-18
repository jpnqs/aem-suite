import type { BrokerRecord } from '../broker/resolve'
import { TestCaseVariables, Variables, type TestCase, type TestCaseProperty, type TestCaseVariable } from '#cds-models/aem/suite'
import type { PublishSpec } from '../solace/session'
import type { TestField } from '../testcases/test-fields'
import { TemplateResolver, TemplateScope, jsonError, TemplateError, generatedSlots } from '../template/resolve'
import { allocateNumbers } from '../template/number-ranges'
import { generateFake } from '../template/fake-data'
import { config } from '../core/config'
import { DEFAULT_ACK_TIMEOUT_MS, detectContentType } from '../core/defaults'
import { NodeRow, selectNodesDeep } from '../testcases/nodes'
import { inferPropertyType } from '../testcases/property-types'
import { loadTree, Tree } from '../testcases/tree'

/**
 * A test case (or folder) with its user properties and variables, as runs, previews and the checks use it:
 * the fields of lib/testcases/test-fields.ts typed by the model (cds-typer), with the key and names that are always there.
 */
export type TestCaseRecord = Pick<TestCase, TestField | 'kind' | 'parent_ID'> & {
  ID: string
  /** filled from the topic on save */
  name: string
  topic: string
  userProperties?: (Pick<TestCaseProperty, 'type' | 'value'> & { name: string })[]
  variables?: (Pick<TestCaseVariable, 'value'> & { name: string })[]
}

interface VariableRow {
  name: string
  value?: string | null
  broker_ID?: string | null
}

/** Loads active test cases including properties and variables. */
export async function loadTestCases(ids: string[]): Promise<TestCaseRecord[]> {
  if (!ids.length) return []
  const rows = await selectNodesDeep({ ID: { in: ids } })
  // keep requested order
  const byId = new Map(rows.map((r) => [r.ID, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is NodeRow => !!r)
}

export interface VariableScopes {
  global: Record<string, string>
  byBroker: Map<string, Record<string, string>>
  /** folder ID -> its variables */
  byFolder: Map<string, Record<string, string>>
  tree: Tree
}

/** Global, per-broker and per-folder variables. */
export async function loadVariableScopes(brokerIds: string[]): Promise<VariableScopes> {
  // variables are few - filter in memory
  const wanted = new Set(brokerIds)
  const rows = ((await SELECT.from(Variables).columns('name', 'value', 'broker_ID')) as VariableRow[]).filter(
    (r) => !r.broker_ID || wanted.has(r.broker_ID)
  )
  const global: Record<string, string> = {}
  const byBroker = new Map<string, Record<string, string>>()
  for (const r of rows) {
    if (!r.broker_ID) global[r.name] = r.value ?? ''
    else {
      const m = byBroker.get(r.broker_ID) ?? {}
      m[r.name] = r.value ?? ''
      byBroker.set(r.broker_ID, m)
    }
  }

  const tree = await loadTree()
  const folderIds = [...tree.byId.values()].filter((n) => n.kind === 'FOLDER').map((n) => n.ID)
  const byFolder = new Map<string, Record<string, string>>()
  if (folderIds.length) {
    const folderVars = (await SELECT.from(TestCaseVariables)
      .columns('testCase_ID', 'name', 'value')
      .where({ testCase_ID: { in: folderIds } })) as { testCase_ID: string; name: string; value?: string | null }[]
    for (const v of folderVars) {
      const m = byFolder.get(v.testCase_ID) ?? {}
      m[v.name] = v.value ?? ''
      byFolder.set(v.testCase_ID, m)
    }
  }
  return { global, byBroker, byFolder, tree }
}

export function scopeFor(
  tc: TestCaseRecord,
  broker: Pick<BrokerRecord, 'ID' | 'name' | 'msgVpn'> | undefined,
  vars: VariableScopes
): TemplateScope {
  // folder chain: from the test case's parent (also for unsaved drafts) up to the root
  const parentId = tc.parent_ID ?? undefined
  const chain = parentId ? [...vars.tree.ancestors(parentId), vars.tree.byId.get(parentId)].filter(Boolean) : []
  return {
    global: vars.global,
    folders: chain.map((f) => vars.byFolder.get(f!.ID) ?? {}),
    broker: broker ? vars.byBroker.get(broker.ID) : undefined,
    testCase: Object.fromEntries((tc.variables ?? []).map((v) => [v.name, v.value ?? ''])),
    brokerInfo: broker ? { id: broker.ID, name: broker.name, msgVpn: broker.msgVpn ?? '' } : undefined
  }
}

/**
 * The scope plus the numbers of the number ranges this test case uses ({{numberRange.X}}). 'consume' issues them
 * (a run), 'peek' only shows what the next ones would be (Preview). Throws TemplateError for an unknown or
 * exhausted range.
 */
export async function withGenerated(tc: TestCaseRecord, scope: TemplateScope, mode: 'consume' | 'peek'): Promise<TemplateScope> {
  const templates = [tc.topic, tc.payload, tc.correlationId, ...(tc.userProperties ?? []).map((p) => p.value)]
  const slots = generatedSlots(templates, scope)
  if (!slots.length) return scope
  const generated = await allocateNumbers(slots.filter((s) => !s.faker), mode)
  // test data of faker.js: new values every time, also in the Preview
  for (const s of slots) if (s.faker) generated[s.key] = generateFake(s.faker.name, s.faker.args, config().faker.locale)
  return { ...scope, generated }
}

/**
 * Resolves all templates of a test case into a publish spec.
 * Throws TemplateError on unknown variables or invalid JSON.
 */
export function buildSpec(tc: TestCaseRecord, scope: TemplateScope): PublishSpec {
  const r = new TemplateResolver(scope)
  const topic = r.resolve(tc.topic).trim()
  if (!topic) throw new TemplateError('Topic is empty')
  if (/[*>]/.test(topic)) throw new TemplateError(`Wildcards are not allowed in a publish topic: ${topic}`)
  const payload = r.resolve(tc.payload)
  const contentType = tc.contentType || detectContentType(tc.payload)
  const err = jsonError(payload, contentType)
  if (err) throw new TemplateError(err)

  return {
    topic,
    payload,
    contentType,
    deliveryMode: tc.deliveryMode === 'DIRECT' ? 'DIRECT' : 'PERSISTENT',
    timeToLiveMs: tc.timeToLiveMs ?? 0,
    dmqEligible: tc.dmqEligible ?? undefined,
    priority: tc.priority ?? undefined,
    correlationId: tc.correlationId ? r.resolve(tc.correlationId) : undefined,
    ackTimeoutMs: tc.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS,
    userProperties: (tc.userProperties ?? []).map((p) => ({
      name: p.name,
      type: p.type || inferPropertyType(p.value),
      value: r.resolve(p.value)
    }))
  }
}
