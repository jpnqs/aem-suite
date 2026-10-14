import type { BrokerRecord } from './credentials/resolve'
import type { PublishSpec, DeliveryMode } from './solace/session'
import { TemplateResolver, TemplateScope, jsonError, TemplateError } from './template/resolve'
import { detectContentType, inferPropertyType } from './defaults'
import { loadTree, Tree } from './tree'

export interface TestCaseRecord {
  ID: string
  kind?: string
  parent_ID?: string | null
  name: string
  topic: string
  payload?: string | null
  contentType?: string | null
  deliveryMode: DeliveryMode | string
  timeToLiveMs?: number | null
  dmqEligible?: boolean | null
  priority?: number | null
  correlationId?: string | null
  ackTimeoutMs?: number | null
  userProperties?: { name: string; type?: string | null; value?: string | null }[]
  variables?: { name: string; value?: string | null }[]
}

interface VariableRow {
  name: string
  value?: string | null
  broker_ID?: string | null
}

/** Loads active test cases including properties and variables. */
export async function loadTestCases(ids: string[]): Promise<TestCaseRecord[]> {
  if (!ids.length) return []
  const rows = (await SELECT.from('aem.suite.TestCases', (tc: any) => {
    tc`.*`
    tc.userProperties((p: any) => p`.*`)
    tc.variables((v: any) => v`.*`)
  }).where({ ID: { in: ids } })) as TestCaseRecord[]
  // keep requested order
  const byId = new Map(rows.map((r) => [r.ID, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is TestCaseRecord => !!r)
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
  const rows = ((await SELECT.from('aem.suite.Variables').columns('name', 'value', 'broker_ID')) as VariableRow[]).filter(
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
    const folderVars = (await SELECT.from('aem.suite.TestCaseVariables')
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
    ackTimeoutMs: tc.ackTimeoutMs ?? 5000,
    userProperties: (tc.userProperties ?? []).map((p) => ({
      name: p.name,
      type: p.type || inferPropertyType(p.value),
      value: r.resolve(p.value)
    }))
  }
}
