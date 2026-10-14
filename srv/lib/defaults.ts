/**
 * "Smart defaults": completes user input so less has to be typed.
 */

/** Port -> scheme for Solace / AEM endpoints without an explicit scheme. */
const PORT_SCHEMES: Record<string, string> = {
  '443': 'wss',
  '8443': 'wss',
  '8008': 'ws',
  '80': 'ws',
  '55443': 'tcps',
  '55555': 'tcp',
  '55003': 'tcp'
}
const DEFAULT_PORTS: Record<string, string> = { wss: '443', ws: '80', tcps: '55443', tcp: '55555' }

/**
 * Completes a broker URL:
 *   mr-xyz.messaging.solace.cloud          -> wss://mr-xyz.messaging.solace.cloud:443
 *   mr-xyz.messaging.solace.cloud:55443    -> tcps://mr-xyz.messaging.solace.cloud:55443
 *   https://mr-xyz.messaging.solace.cloud  -> wss://mr-xyz.messaging.solace.cloud:443
 *   localhost:55555                        -> tcp://localhost:55555
 * Paths, query strings and trailing slashes are removed. Returns the input unchanged if it cannot be parsed.
 */
export function normalizeBrokerUrl(input: string | null | undefined): string | null | undefined {
  if (!input) return input
  const raw = input.trim()
  const m = /^(?:([a-z]+):\/\/)?([^/:?#\s]+)(?::(\d+))?(?:[/?#].*)?$/i.exec(raw)
  if (!m) return raw
  let [, scheme, host, port] = m
  scheme = scheme?.toLowerCase()
  if (scheme === 'https') scheme = 'wss'
  else if (scheme === 'http') scheme = 'ws'
  if (!scheme) scheme = (port && PORT_SCHEMES[port]) || 'wss'
  if (!['ws', 'wss', 'tcp', 'tcps'].includes(scheme)) return raw
  return `${scheme}://${host}:${port || DEFAULT_PORTS[scheme]}`
}

/** application/json if the payload looks like JSON ({ or [), otherwise text/plain. */
export function detectContentType(payload: string | null | undefined): string {
  const t = (payload ?? '').trim()
  return !t || t.startsWith('{') || t.startsWith('[') ? 'application/json' : 'text/plain'
}

/** INT for integers, BOOL for true/false, STRING otherwise (also for templated values). */
export function inferPropertyType(value: string | null | undefined): 'STRING' | 'INT' | 'BOOL' {
  const v = (value ?? '').trim()
  if (/^-?\d{1,15}$/.test(v)) return 'INT'
  if (/^(true|false)$/i.test(v)) return 'BOOL'
  return 'STRING'
}

export const STARTER_PAYLOAD = `{
  "id": "{{uuid}}",
  "createdAt": "{{now}}",
  "data": {}
}`

export const STARTER_CORRELATION_ID = '{{uuid}}'
