import cds from '@sap/cds'
import { execute, preview } from './cleanup'
import type { CleanupRequest } from './categories'
import { errMsg } from '../core/errors'

const LOG = cds.log('aem-retention')
const DAY_MS = 24 * 60 * 60 * 1000
/** the first run after a start: not while the server is still busy starting (and a restart loop cleans up once) */
const FIRST_RUN_MS = 10 * 60 * 1000
/** the user the cleanup logs and the audit log name */
export const RETENTION_USER = 'automatic cleanup'

let timer: NodeJS.Timeout | undefined

/**
 * Retention: the cleanup rules an administrator marked "automatic" are applied once a day by the server - the same
 * cleanup as in the Data Cleanup app (preview, then execute with the previewed counts), logged in CleanupLogs.
 * The backend runs as one instance (mta.yaml), so no two servers clean up at the same time.
 */
export function startRetention(): void {
  if (timer) return
  const run = () => void applyAutomaticRules().catch((e) => LOG.error('Automatic cleanup failed', e))
  timer = setTimeout(() => {
    run()
    timer = setInterval(run, DAY_MS)
    timer.unref()
  }, FIRST_RUN_MS)
  timer.unref()
}

export function stopRetention(): void {
  clearTimeout(timer)
  clearInterval(timer)
  timer = undefined
}

/** Applies every automatic rule; a broken rule is logged and skipped. Returns the number of rows cleaned up. */
export async function applyAutomaticRules(now = new Date()): Promise<number> {
  const user = new cds.User(RETENTION_USER)
  const rules = (await cds.tx({ user }, () =>
    SELECT.from('aem.suite.CleanupRules').columns('name', 'request').where({ automatic: true })
  )) as { name: string; request: string }[]
  let total = 0
  for (const rule of rules) {
    try {
      const request = JSON.parse(rule.request) as CleanupRequest
      // the counts of this moment are the confirmation (execute refuses if more rows match by then)
      const counts = await cds.tx({ user }, () => preview(request, now))
      if (!counts.some((c) => c.count > 0)) continue
      const result = await cds.tx({ user }, () =>
        execute(
          request,
          counts.map((c) => ({ category: c.category, count: c.count })),
          rule.name,
          now
        )
      )
      total += result.totalCount
      LOG.info(`Rule "${rule.name}": ${result.totalCount} rows cleaned up`)
    } catch (e) {
      LOG.warn(`Rule "${rule.name}" could not be applied: ${errMsg(e)}`)
    }
  }
  return total
}
