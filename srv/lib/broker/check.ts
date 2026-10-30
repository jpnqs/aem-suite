import { loadBroker, resolveConnection } from './resolve'
import { Brokers, type ConnectionStatus } from '#cds-models/aem/suite'
import { errMsg, masked, truncate } from '../core/errors'
import { columnLength } from '../core/model'
import { connect } from '../solace/connector'

export interface ConnectionCheck {
  ok: boolean
  message: string
  latencyMs: number
  lastConnectionStatus: ConnectionStatus
  lastConnectionAt: string
  lastConnectionMessage: string
}

/**
 * Opens and closes a session and stores the outcome on the broker
 * (runs in the current transaction).
 * @param maxTimeoutMs optional cap for the connect timeout (used for the automatic check on save)
 */
export async function checkConnection(
  brokerId: string,
  opts: { jwt?: string; password?: string; username?: string; maxTimeoutMs?: number } = {}
): Promise<ConnectionCheck> {
  const { jwt, password, username, maxTimeoutMs } = opts
  const started = Date.now()
  let ok = false
  let message: string
  let resolvedPassword: string | undefined
  try {
    const broker = await loadBroker(brokerId)
    const conn = await resolveConnection(broker, jwt, password, username)
    resolvedPassword = conn.password
    if (maxTimeoutMs) conn.connectTimeoutMs = Math.min(conn.connectTimeoutMs ?? maxTimeoutMs, maxTimeoutMs)
    const session = await connect(conn)
    await session.close()
    ok = true
    message = `Connected to ${conn.url} (VPN ${conn.vpnName}) as ${conn.userName}`
  } catch (e) {
    // never a password in the stored message, whatever the broker library put into its error
    message = masked(masked(errMsg(e), password), resolvedPassword)
  }
  const status = {
    lastConnectionStatus: ok ? ('OK' as const) : ('ERROR' as const),
    lastConnectionAt: new Date().toISOString(),
    lastConnectionMessage: truncate(message, columnLength('Brokers', 'lastConnectionMessage'))
  }
  await UPDATE(Brokers, brokerId).with(status)
  return { ok, message, latencyMs: Date.now() - started, ...status }
}
