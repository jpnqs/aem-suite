import { loadBroker } from '../broker/resolve'
import { buildSpec, loadVariableScopes, scopeFor, TestCaseRecord, withGenerated } from './test-case-spec'
import { errMsg } from '../core/errors'
import { describeCheck, type Expectation } from './expectations'

export interface Preview {
  valid: boolean
  message: string
  topic?: string
  payload?: string
  correlationId?: string | null
  userProperties?: string
  expectation?: string | null
}

/**
 * Resolves topic, payload, correlation ID and user properties of a test case against the variables of a broker
 * (global variables only without broker) - nothing is sent. Never throws: problems end up in `valid` / `message`.
 */
export async function buildPreview(tc: TestCaseRecord, brokerId?: string | null): Promise<Preview> {
  try {
    const broker = brokerId ? await loadBroker(brokerId) : undefined
    const vars = await loadVariableScopes(broker ? [broker.ID] : [])
    // peek: the preview shows the next numbers of number ranges without using them up
    const spec = buildSpec(tc, await withGenerated(tc, scopeFor(tc, broker, vars), 'peek'))
    return {
      topic: spec.topic,
      payload: prettyJson(spec.payload),
      correlationId: spec.correlationId ?? null,
      userProperties: JSON.stringify(Object.fromEntries((spec.userProperties ?? []).map((p) => [p.name, p.value])), null, 2),
      expectation: spec.expect ? describeExpectation(spec.expect) : null,
      valid: true,
      message: broker ? `Resolved for broker ${broker.name}` : 'Resolved with global variables only'
    }
  } catch (e) {
    return { valid: false, message: errMsg(e) }
  }
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

/** "Message on orders/> with correlation id 42 within 5000 ms; checks: JSON path id equals 42" */
export function describeExpectation(e: Expectation): string {
  const where = e.mode === 'QUEUE' ? `Message on queue ${e.source}` : e.mode === 'REPLY' ? `Reply on ${e.source}` : `Message on ${e.source}`
  const filter = e.correlationId ? ` with correlation id ${e.correlationId}` : ''
  const checks = e.checks.length ? `; checks: ${e.checks.map(describeCheck).join('; ')}` : ''
  return `${where}${filter} within ${e.timeoutMs} ms${checks}`
}
