import cds from '@sap/cds'
import { getDestination } from '@sap-cloud-sdk/connectivity'
import type { ConnectionConfig } from '../solace/session'

export interface BrokerRecord {
  ID: string
  name: string
  credentialMode: 'DESTINATION' | 'DIRECT' | string
  destinationName?: string | null
  url?: string | null
  msgVpn?: string | null
  username?: string | null
  clientNamePrefix?: string | null
  connectTimeoutMs?: number | null
  active?: boolean | null
}

export interface BrokerConnection extends ConnectionConfig {
  brokerId: string
  brokerName: string
}

/** Reads a broker (bypasses service projections). */
export async function loadBroker(brokerId: string): Promise<BrokerRecord> {
  const broker = await SELECT.one.from('aem.suite.Brokers').where({ ID: brokerId })
  if (!broker) throw new Error(`Broker ${brokerId} not found`)
  return broker as BrokerRecord
}

/**
 * Builds the SMF connection config for a broker.
 *
 * DESTINATION mode - expected destination layout (type HTTP, NoAuthentication or BasicAuthentication):
 *   URL            wss://<host>:443   (https:// is mapped to wss://, http:// to ws://)
 *   User/Password  client username / password
 *   msgVpn         additional property: message VPN name (mandatory)
 *   smfUrl         additional property: optional override of the URL (e.g. tcps://host:55443)
 */
export async function resolveConnection(
  broker: BrokerRecord,
  jwt?: string,
  /** DIRECT mode: the password entered by the user for this run / test / subscription (never stored) */
  password?: string
): Promise<BrokerConnection> {
  const base = {
    brokerId: broker.ID,
    brokerName: broker.name,
    clientName: broker.clientNamePrefix || 'aem-suite',
    connectTimeoutMs: broker.connectTimeoutMs || 10000
  }

  if (broker.credentialMode === 'DESTINATION') {
    if (!broker.destinationName) throw new Error(`Broker "${broker.name}": no destination name maintained`)
    const dest = await getDestination({ destinationName: broker.destinationName, jwt, useCache: true })
    if (!dest) throw new Error(`Destination "${broker.destinationName}" not found`)
    const props = (dest.originalProperties ?? {}) as Record<string, string>
    const vpn = props.msgVpn || props['aem.msgVpn']
    if (!vpn) throw new Error(`Destination "${broker.destinationName}": additional property "msgVpn" missing`)
    const url = props.smfUrl || props['aem.smfUrl'] || dest.url
    if (!url) throw new Error(`Destination "${broker.destinationName}": URL missing`)
    return {
      ...base,
      url: toSmfUrl(url),
      vpnName: vpn,
      userName: dest.username ?? '',
      password: dest.password ?? ''
    }
  }

  if (!broker.url) throw new Error(`Broker "${broker.name}": URL missing`)
  if (!broker.msgVpn) throw new Error(`Broker "${broker.name}": message VPN missing`)
  if (!broker.username) throw new Error(`Broker "${broker.name}": username missing`)
  if (!password) throw new MissingPasswordError(broker.name)
  return {
    ...base,
    url: toSmfUrl(broker.url),
    vpnName: broker.msgVpn,
    userName: broker.username,
    password
  }
}

export class MissingPasswordError extends Error {
  readonly status = 400
  constructor(brokerName: string) {
    super(`Password required for broker "${brokerName}"`)
  }
}

/** True if connecting to this broker needs a password from the user. */
export function needsPassword(broker: { credentialMode?: string | null }): boolean {
  return broker.credentialMode !== 'DESTINATION'
}

/** Maps http(s) URLs to ws(s), keeps ws/wss/tcp/tcps. */
export function toSmfUrl(url: string): string {
  const trimmed = url.trim()
  if (/^https:\/\//i.test(trimmed)) return trimmed.replace(/^https:/i, 'wss:')
  if (/^http:\/\//i.test(trimmed)) return trimmed.replace(/^http:/i, 'ws:')
  if (/^(wss?|tcps?):\/\//i.test(trimmed)) return trimmed
  throw new Error(`Unsupported broker URL "${url}" (expected wss://, ws://, tcps:// or tcp://)`)
}

/** Current user's JWT (if any) - used for destination lookup with user propagation. */
export function currentJwt(): string | undefined {
  const auth = (cds.context as { http?: { req?: { headers?: Record<string, string> } } } | undefined)?.http?.req
    ?.headers?.authorization
  return auth?.startsWith('Bearer ') ? auth.slice(7) : undefined
}
