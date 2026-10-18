import { Brokers } from '#cds-models/aem/suite'

/** What hidden connection data is replaced with. */
export const HIDDEN = '<hidden>'

/** URLs of any scheme a broker or destination can have, and host:port (solclientjs errors name the endpoint). */
const ENDPOINTS = [/\b(?:wss?|tcps?|https?):\/\/[^\s"'<>,;)]+/gi, /\b(?:[a-z0-9-]+\.)+[a-z]{2,}:\d{2,5}\b/gi]

/** Shorter values are not hidden: "v" or "eu" would cut ordinary words apart. */
const MIN_LENGTH = 3

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function hostOf(url: string | null | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname || undefined : undefined
  } catch {
    return undefined
  }
}

/**
 * Hides the connection data of brokers in texts that go to an AI agent (error messages of results): URLs and
 * host:port of any endpoint, plus the URL, host, message VPN, username and destination name of every broker
 * maintained in the app. Loads the brokers once - create one per request.
 */
export async function brokerRedactor(): Promise<(text: string | null | undefined) => string | null | undefined> {
  const brokers = (await SELECT.from(Brokers).columns('url', 'msgVpn', 'username', 'destinationName')) as {
    url?: string | null
    msgVpn?: string | null
    username?: string | null
    destinationName?: string | null
  }[]
  const values = new Set<string>()
  for (const b of brokers) {
    for (const v of [b.url, hostOf(b.url), b.msgVpn, b.username, b.destinationName]) if (v && v.length >= MIN_LENGTH) values.add(v)
  }
  // longest first: a URL before the host inside it
  const known = values.size ? new RegExp([...values].sort((a, b) => b.length - a.length).map(escape).join('|'), 'gi') : undefined
  return (text) => {
    if (!text) return text
    let out = text
    for (const p of ENDPOINTS) out = out.replace(p, HIDDEN)
    return known ? out.replace(known, HIDDEN) : out
  }
}
