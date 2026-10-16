import cds from '@sap/cds'
import { checkConnection } from './lib/broker-check'
import { normalizeBrokerUrl, toSmfUrl } from './lib/broker-url'
import { config } from './lib/config'
import { listDestinations } from './lib/credentials/destinations'
import { currentJwt, needsPassword } from './lib/credentials/resolve'
import { VAR_NAME, VAR_NAME_RULE } from './lib/node-validation'
import { keyOf } from './lib/request'

/** Connection check on save is capped so saving never blocks long. */
const AUTO_CHECK_TIMEOUT_MS = 5000

interface BrokerData {
  ID?: string
  credentialMode?: string
  destinationName?: string | null
  url?: string | null
  msgVpn?: string | null
  username?: string | null
  active?: boolean
  connectTimeoutMs?: number | null
  [k: string]: unknown
}

export default class AdminService extends cds.ApplicationService {
  async init() {
    const { Brokers, GlobalVariables, Destinations } = this.entities

    // complete URLs while editing, so the user sees the result right away
    this.before(['NEW', 'UPDATE'], Brokers.drafts!, (req) => {
      const d = req.data as BrokerData
      if (d.url) d.url = normalizeBrokerUrl(d.url)
    })

    // ---------------------------------------------------------------- save (draft activation)
    this.before(['CREATE', 'UPDATE'], Brokers, (req) => {
      const d = req.data as BrokerData
      if (d.url) d.url = normalizeBrokerUrl(d.url)

      if (d.credentialMode === 'DESTINATION') {
        if (!d.destinationName) req.error(400, 'Destination name is required', 'in/destinationName')
      } else if (d.credentialMode === 'DIRECT' || req.event === 'CREATE') {
        if (!d.url) req.error(400, 'URL is required', 'in/url')
        if (!d.msgVpn) req.error(400, 'Message VPN is required', 'in/msgVpn')
        // username is optional: if empty, it is asked for together with the password
      }
      if (d.url) {
        try {
          toSmfUrl(d.url)
        } catch (e) {
          req.error(400, (e as Error).message, 'in/url')
        }
      }
      if (d.connectTimeoutMs != null && (Number(d.connectTimeoutMs) < 1000 || Number(d.connectTimeoutMs) > 120000))
        req.error(400, 'Connect timeout must be between 1000 and 120000 ms', 'in/connectTimeoutMs')
    })

    // automatic connection test on save - only possible for destination brokers
    // (direct brokers have no stored password; use "Test Connection" and enter it)
    this.after(['CREATE', 'UPDATE'], Brokers, async (res, req) => {
      const result = (Array.isArray(res) ? res[0] : res) as BrokerData | undefined
      const data = { ...(req.data as BrokerData), ...result }
      if (!config().autoTestConnection || data.active === false || needsPassword(data)) return

      const id = data.ID ?? keyOf(req).ID
      const check = await checkConnection(id, { jwt: currentJwt(), maxTimeoutMs: AUTO_CHECK_TIMEOUT_MS })
      if (result && typeof result === 'object') {
        result.lastConnectionStatus = check.lastConnectionStatus
        result.lastConnectionAt = check.lastConnectionAt
        result.lastConnectionMessage = check.lastConnectionMessage
        // same as Brokers.connectionCriticality in srv/admin-service.cds (the response is built before this update)
        result.connectionCriticality = check.ok ? 3 : 1
      }
      if (check.ok) req.info(200, `Connection test successful (${check.latencyMs} ms)`)
      else req.warn(200, `Saved, but the connection test failed: ${check.message}`)
    })

    // ---------------------------------------------------------------- global variables
    this.before(['CREATE', 'UPDATE'], GlobalVariables, async (req) => {
      const d = req.data as { ID?: string; name?: string; broker_ID?: string | null }
      d.broker_ID = null
      if (d.name !== undefined) {
        if (!VAR_NAME.test(d.name ?? '')) return req.error(400, VAR_NAME_RULE, 'in/name')
        const dup = await SELECT.one
          .from('aem.suite.Variables')
          .where({ name: d.name, broker_ID: null, ID: { '!=': d.ID ?? keyOf(req).ID ?? '' } })
        if (dup) req.error(409, `Global variable "${d.name}" already exists`, 'in/name')
      }
    })

    // ---------------------------------------------------------------- actions
    this.on('testConnection', Brokers, async (req) => {
      const { password, username } = req.data as { password?: string; username?: string }
      const check = await checkConnection(keyOf(req).ID, {
        jwt: currentJwt(),
        password: password || undefined,
        username: username || undefined
      })
      if (check.ok) req.info(200, `Connection successful (${check.latencyMs} ms)`)
      else req.warn(200, `Connection failed: ${check.message}`)
      return { ok: check.ok, message: check.message, latencyMs: check.latencyMs }
    })

    // ---------------------------------------------------------------- value help
    this.on('READ', Destinations, async (req) => {
      const search = String((req.query as { SELECT?: { search?: { val?: string }[] } }).SELECT?.search?.[0]?.val ?? '')
        .toLowerCase()
        .replace(/"/g, '')
      let list = await listDestinations(currentJwt())
      if (search) list = list.filter((d) => `${d.name} ${d.url} ${d.msgVpn}`.toLowerCase().includes(search))
      const key = (req.params?.[0] as { name?: string } | string | undefined) ?? undefined
      if (key) {
        const name = typeof key === 'string' ? key : key.name
        return list.find((d) => d.name === name)
      }
      return Object.assign(list, { $count: list.length })
    })

    return super.init()
  }
}
