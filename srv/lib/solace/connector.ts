import type { BrokerConnection } from '../credentials/resolve'
import { Publisher, SolaceSession } from './session'

/** Opens a publishing connection. Replaceable in tests (no broker needed). */
export type Connector = (conn: BrokerConnection) => Promise<Publisher>

const defaultConnector: Connector = (conn) => SolaceSession.connect(conn)
let current: Connector = defaultConnector

export function connect(conn: BrokerConnection): Promise<Publisher> {
  return current(conn)
}

export function setConnector(connector?: Connector): void {
  current = connector ?? defaultConnector
}
