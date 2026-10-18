import cds from '@sap/cds'
import { NumberRanges as NumberRangeRows } from '#cds-models/aem/suite'
import { checkConnection } from './lib/broker/check'
import { normalizeBrokerUrl } from './lib/broker/url'
import { config } from './lib/core/config'
import { listDestinations } from './lib/broker/destinations'
import { currentJwt, needsPassword } from './lib/broker/resolve'
import { VAR_NAME, VAR_NAME_RULE } from './lib/testcases/node-validation'
import { checkBroker, checkNumberRange } from './lib/config/checks'
import { exportConfig, importConfig, isConfigKind } from './lib/config/export-import'
import { idOf, keyOf, keyValue } from './lib/core/request'
import { nameTaken } from './lib/core/unique-name'
import { currentBeforeLast, currentForNext, formatNumber, issueNext, nextExample } from './lib/template/number-ranges'
import { TemplateError } from './lib/template/resolve'

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
    const { Brokers, GlobalVariables, Destinations, NumberRanges } = this.entities

    // ---------------------------------------------------------------- number ranges
    this.before(['CREATE', 'UPDATE'], NumberRanges, validateNumberRange)

    // the formatted numbers need these columns, also when the client asks for the numbers only (side effects)
    this.before('READ', [NumberRanges, NumberRanges.drafts!], (req) => {
      const columns = (req.query as { SELECT?: { columns?: { ref?: string[] }[] } }).SELECT?.columns
      const asked = columns?.map((c) => c.ref?.[0])
      if (!columns || !asked?.some((n) => n === 'nextNumber' || n === 'lastNumber')) return
      for (const n of ['name', 'prefix', 'suffix', 'length', 'start', 'step', 'current']) if (!asked.includes(n)) columns.push({ ref: [n] })
    })

    // last and next number as the range formats them (also while editing)
    this.after('READ', [NumberRanges, NumberRanges.drafts!], (rows) => {
      for (const r of (Array.isArray(rows) ? rows : [rows]) as NumberRangeRow[]) {
        if (!r || r.name === undefined) continue
        // nothing issued yet (also after setting the next number to the start of the range)
        const issued = r.current !== null && r.current !== undefined && BigInt(r.current) >= BigInt(r.start ?? 1)
        r.lastNumber = issued ? formatNumber(r, BigInt(r.current!)) : ''
        r.nextNumber = nextExample(r)
      }
    })

    this.on('reset', NumberRanges, async (req) => {
      const ID = idOf(req)
      const { nextNumber } = req.data as { nextNumber?: number | string | null }
      const range = (await SELECT.one.from(NumberRangeRows).where({ ID })) as NumberRangeRow | undefined
      if (!range) return req.reject(404, 'Number range not found')
      if (nextNumber !== undefined && nextNumber !== null && BigInt(nextNumber) < 0n) return req.reject(400, 'The next number must not be negative')
      // empty: back to the start of the range
      const current = nextNumber === undefined || nextNumber === null ? null : currentForNext(range, nextNumber)
      // by name: cds-typer types Integer64 as number, `current` is written as text (no precision lost)
      await UPDATE('aem.suite.NumberRanges').set({ current }).where({ ID })
      req.info(200, 'Number range reset')
    })

    // try a range out without a run: issue the next number, or give the last one back (success = a toast, no dialog)
    this.on('countUp', NumberRanges, async (req) => {
      const range = (await SELECT.one.from(NumberRangeRows).columns('name').where({ ID: idOf(req) })) as NumberRangeRow | undefined
      if (!range) return req.reject(404, 'Number range not found')
      try {
        req.notify(200, `Number ${await issueNext(range.name!)} issued`)
      } catch (e) {
        // exhausted or busy
        if (e instanceof TemplateError) return req.reject(400, e.message)
        throw e
      }
    })

    this.on('countDown', NumberRanges, async (req) => {
      const ID = idOf(req)
      const range = (await SELECT.one.from(NumberRangeRows).where({ ID })) as NumberRangeRow | undefined
      if (!range) return req.reject(404, 'Number range not found')
      const current = currentBeforeLast(range)
      if (current === undefined) return req.reject(400, 'No number of this range has been issued yet')
      // compare-and-set like a run: a number a run took meanwhile is not given back by mistake
      const changed = await UPDATE('aem.suite.NumberRanges').set({ current }).where({ ID, current: range.current })
      if (!changed) return req.reject(409, 'A run used the number range meanwhile - try again')
      req.notify(200, `Number ${formatNumber(range, BigInt(range.current!))} given back, it is the next number again`)
    })

    // complete URLs while editing, so the user sees the result right away
    this.before(['NEW', 'UPDATE'], Brokers.drafts!, (req) => {
      const d = req.data as BrokerData
      if (d.url) d.url = normalizeBrokerUrl(d.url)
    })

    // ---------------------------------------------------------------- save (draft activation)
    this.before(['CREATE', 'UPDATE'], Brokers, (req) => {
      const d = req.data as BrokerData
      if (d.url) d.url = normalizeBrokerUrl(d.url)

      checkBroker(d, req.event === 'CREATE' ? 'CREATE' : 'UPDATE', (status, message, target) => req.error(status, message, target))
    })

    // automatic connection test on save - only possible for destination brokers
    // (direct brokers have no stored password; use "Test Connection" and enter it)
    this.after(['CREATE', 'UPDATE'], Brokers, async (res, req) => {
      const result = (Array.isArray(res) ? res[0] : res) as BrokerData | undefined
      const data = { ...(req.data as BrokerData), ...result }
      if (!config().autoTestConnection || data.active === false || needsPassword(data)) return

      const id = data.ID ?? idOf(req)
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
        if (await nameTaken('Variables', d.name, d.ID ?? keyOf(req).ID, { broker_ID: null })) req.error(409, `Global variable "${d.name}" already exists`, 'in/name')
      }
    })

    // ---------------------------------------------------------------- actions
    this.on('testConnection', Brokers, async (req) => {
      const { password, username } = req.data as { password?: string; username?: string }
      const check = await checkConnection(idOf(req), {
        jwt: currentJwt(),
        password: password || undefined,
        username: username || undefined
      })
      if (check.ok) req.info(200, `Connection successful (${check.latencyMs} ms)`)
      else req.warn(200, `Connection failed: ${check.message}`)
      return { ok: check.ok, message: check.message, latencyMs: check.latencyMs }
    })

    // ---------------------------------------------------------------- export / import of the configuration
    this.on('exportConfig', (req) => {
      const { kind, ids } = req.data as { kind: unknown; ids?: string[] }
      if (!isConfigKind(kind)) return req.reject(400, 'Unknown kind of configuration')
      return exportConfig(kind, ids)
    })
    this.on('importConfig', (req) => {
      const { kind, content, dryRun } = req.data as { kind: unknown; content: string; dryRun?: boolean }
      if (!isConfigKind(kind)) return req.reject(400, 'Unknown kind of configuration')
      return importConfig(kind, content, { dryRun: !!dryRun })
    })

    // ---------------------------------------------------------------- value help
    this.on('READ', Destinations, async (req) => {
      const search = String((req.query as { SELECT?: { search?: { val?: string }[] } }).SELECT?.search?.[0]?.val ?? '')
        .toLowerCase()
        .replace(/"/g, '')
      let list = await listDestinations(currentJwt())
      if (search) list = list.filter((d) => `${d.name} ${d.url} ${d.msgVpn}`.toLowerCase().includes(search))
      const name = keyValue(req, 'name')
      if (name) return list.find((d) => d.name === name)
      return Object.assign(list, { $count: list.length })
    })

    return super.init()
  }
}

interface NumberRangeRow {
  ID?: string
  name?: string
  prefix?: string | null
  suffix?: string | null
  length?: number | null
  start?: number | string | null
  step?: number | null
  maximum?: number | string | null
  current?: number | string | null
  lastNumber?: string
  nextNumber?: string
  lastUsedAt?: string | null
}

/** Name (unique, as used in the template), sizes and limits of a number range. */
async function validateNumberRange(req: cds.Request): Promise<void> {
  const d = req.data as NumberRangeRow
  // the counter is moved by runs only (and by "Reset"): a draft that was open meanwhile must not set it back
  if (req.event === 'UPDATE') {
    delete d.current
    delete d.lastUsedAt
  }
  const checkName = req.event === 'CREATE' || d.name !== undefined
  if (checkName) d.name = (d.name ?? '').trim()
  // the first problem is reported (reject throws)
  checkNumberRange(d, checkName, (status, message, target) => req.reject(status, message, target))
  if (checkName && (await nameTaken('NumberRanges', d.name!, d.ID))) return req.reject(400, `A number range named "${d.name}" exists already`, 'in/name')
}
