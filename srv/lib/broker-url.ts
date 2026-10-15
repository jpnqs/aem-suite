/**
 * Broker URLs: completing what the user typed, mapping to the SMF schemes solclientjs accepts,
 * and reading the broker settings of a destination.
 */

const SMF_SCHEMES = ['ws', 'wss', 'tcp', 'tcps']

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

/** http(s) is the scheme of a destination URL; the broker speaks SMF over websockets there. */
const fromHttp = (scheme: string) => (scheme === 'https' ? 'wss' : scheme === 'http' ? 'ws' : scheme)

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
  const [, given, host, port] = m
  const scheme = given ? fromHttp(given.toLowerCase()) : (port && PORT_SCHEMES[port]) || 'wss'
  if (!SMF_SCHEMES.includes(scheme)) return raw
  return `${scheme}://${host}:${port || DEFAULT_PORTS[scheme]}`
}

/** Maps http(s) URLs to ws(s), keeps ws/wss/tcp/tcps. */
export function toSmfUrl(url: string): string {
  const trimmed = url.trim()
  const m = /^([a-z]+):\/\//i.exec(trimmed)
  const scheme = m && fromHttp(m[1].toLowerCase())
  if (!scheme || !SMF_SCHEMES.includes(scheme))
    throw new Error(`Unsupported broker URL "${url}" (expected wss://, ws://, tcps:// or tcp://)`)
  return scheme + trimmed.slice(m[1].length)
}

/** True if the URL can be used for an SMF connection. */
export function isBrokerUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    toSmfUrl(url)
    return true
  } catch {
    return false
  }
}

/**
 * Broker settings of a destination: additional properties `smfUrl` (optional override of the URL)
 * and `msgVpn` - each also accepted with the prefix "aem.".
 */
export function readBrokerProps(props: Record<string, string | undefined>, destinationUrl?: string | null): { url: string | null; msgVpn: string | null } {
  return {
    url: props.smfUrl || props['aem.smfUrl'] || destinationUrl || null,
    msgVpn: props.msgVpn || props['aem.msgVpn'] || null
  }
}
