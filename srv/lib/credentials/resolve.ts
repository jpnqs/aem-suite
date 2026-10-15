import cds from '@sap/cds'
import { getDestination } from '@sap-cloud-sdk/connectivity'
import type { ConnectionConfig } from '../solace/session'
import { readBrokerProps, toSmfUrl } from '../broker-url'
import { HttpError } from '../errors'
import { DEFAULT_CLIENT_NAME_PREFIX, DEFAULT_CONNECT_TIMEOUT_MS } from '../defaults'

export type CredentialMode = 'DESTINATION' | 'DIRECT'

export interface BrokerRecord {
  ID: string
  name: string
  credentialMode: CredentialMode
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
  password?: string,
  /** DIRECT mode: username entered by the user - only used if the broker has no username maintained */
  username?: string
): Promise<BrokerConnection> {
  const base = {
    brokerId: broker.ID,
    brokerName: broker.name,
    clientName: broker.clientNamePrefix || DEFAULT_CLIENT_NAME_PREFIX,
    connectTimeoutMs: broker.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS
  }

  if (broker.credentialMode === 'DESTINATION') {
    if (!broker.destinationName) throw new Error(`Broker "${broker.name}": no destination name maintained`)
    const dest = await getDestination({ destinationName: broker.destinationName, jwt, useCache: true })
    if (!dest) throw new Error(`Destination "${broker.destinationName}" not found`)
    const { url, msgVpn: vpn } = readBrokerProps((dest.originalProperties ?? {}) as Record<string, string>, dest.url)
    if (!vpn) throw new Error(`Destination "${broker.destinationName}": additional property "msgVpn" missing`)
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
  // the maintained username wins; otherwise the one entered for this operation
  const userName = broker.username || username?.trim()
  if (!userName) throw new MissingUsernameError(broker.name)
  if (!password) throw new MissingPasswordError(broker.name)
  return {
    ...base,
    url: toSmfUrl(broker.url),
    vpnName: broker.msgVpn,
    userName,
    password
  }
}

export class MissingPasswordError extends HttpError {
  constructor(brokerName: string) {
    super(400, `Password required for broker "${brokerName}"`)
  }
}

export class MissingUsernameError extends HttpError {
  constructor(brokerName: string) {
    super(400, `Username required for broker "${brokerName}"`)
  }
}

/** True if connecting to this broker needs a password from the user. */
export function needsPassword(broker: { credentialMode?: string | null }): boolean {
  return broker.credentialMode !== 'DESTINATION'
}

/** True if the user has to enter a username too: DIRECT broker without a maintained username. */
export function needsUsername(broker: { credentialMode?: string | null; username?: string | null }): boolean {
  return broker.credentialMode !== 'DESTINATION' && !broker.username
}

/** Current user's JWT (if any) - used for destination lookup with user propagation. */
export function currentJwt(): string | undefined {
  const auth = (cds.context as { http?: { req?: { headers?: Record<string, string> } } } | undefined)?.http?.req
    ?.headers?.authorization
  return auth?.startsWith('Bearer ') ? auth.slice(7) : undefined
}
