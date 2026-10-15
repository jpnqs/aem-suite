import { loadBroker } from './credentials/resolve'
import { buildSpec, loadVariableScopes, scopeFor, TestCaseRecord } from './test-case-spec'

export interface Preview {
  valid: boolean
  message: string
  topic?: string
  payload?: string
  correlationId?: string | null
  userProperties?: string
}

/**
 * Resolves topic, payload, correlation ID and user properties of a test case against the variables of a broker
 * (global variables only without broker) - nothing is sent. Never throws: problems end up in `valid` / `message`.
 */
export async function buildPreview(tc: TestCaseRecord, brokerId?: string | null): Promise<Preview> {
  try {
    const broker = brokerId ? await loadBroker(brokerId) : undefined
    const vars = await loadVariableScopes(broker ? [broker.ID] : [])
    const spec = buildSpec(tc, scopeFor(tc, broker, vars))
    return {
      topic: spec.topic,
      payload: prettyJson(spec.payload),
      correlationId: spec.correlationId ?? null,
      userProperties: JSON.stringify(Object.fromEntries((spec.userProperties ?? []).map((p) => [p.name, p.value])), null, 2),
      valid: true,
      message: broker ? `Resolved for broker ${broker.name}` : 'Resolved with global variables only'
    }
  } catch (e) {
    return { valid: false, message: (e as Error).message }
  }
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}
