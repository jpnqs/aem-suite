import type { BrokerRecord } from './credentials/resolve'
import type { PublishSpec, DeliveryMode } from './solace/session'
import { TemplateResolver, TemplateScope, jsonError, TemplateError } from './template/resolve'
import { detectContentType, inferPropertyType } from './defaults'

export interface TestCaseRecord {
  ID: string
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

/** Global variables and per-broker variables for the given brokers. */
export async function loadVariableScopes(brokerIds: string[]): Promise<{
  global: Record<string, string>
  byBroker: Map<string, Record<string, string>>
}> {
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
  return { global, byBroker }
}

export function scopeFor(
  tc: TestCaseRecord,
  broker: Pick<BrokerRecord, 'ID' | 'name' | 'msgVpn'> | undefined,
  vars: { global: Record<string, string>; byBroker: Map<string, Record<string, string>> }
): TemplateScope {
  return {
    global: vars.global,
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
