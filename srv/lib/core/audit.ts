import cds from '@sap/cds'
import { truncate } from './errors'
import { columnLength } from './model'

/**
 * The audit log (aem.suite.AuditLog, Audit Log app): every successful change and action of the services, written in
 * the transaction of the request (a request that fails leaves no entry). Never values - the names of the changed
 * fields, and of an action only the parameters that tell what it was done to.
 */

const SERVICES = ['AdminService', 'TestService', 'CleanupService', 'SubscribeService', 'TestAgentService']

/** actions that change nothing (or would flood the log) */
const NOT_LOGGED = new Set(['preview', 'templateHints', 'heartbeat', 'draftEdit', 'draftPrepare', 'moveBefore', 'exportNodes', 'exportConfig', 'previewTestCase'])

/** parameters of actions that are worth a line: what was run, imported, cleaned up (values short, lists counted) */
const ACTION_PARAMS = ['ids', 'testCaseIds', 'brokerIds', 'runId', 'parentId', 'dryRun', 'sourceType', 'queue', 'topics', 'name', 'ruleName', 'id']

/** never in the log, not even their names' values */
const SECRET = /password|credential|secret|token/i

/** request data that is no user input */
const TECHNICAL = new Set(['ID', 'IsActiveEntity', 'HasActiveEntity', 'HasDraftEntity', 'DraftAdministrativeData_DraftUUID', 'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy'])

export function registerAudit(srv: cds.Service): void {
  if (!SERVICES.includes(srv.name)) return
  srv.after('*', async (result: unknown, req: cds.Request) => {
    const entry = entryOf(srv, req, result)
    if (!entry) return
    try {
      await INSERT.into('aem.suite.AuditLog').entries(entry)
    } catch (e) {
      cds.log('aem-audit').warn('Cannot write the audit log', e)
    }
  })
}

type Entry = { user: string; action: string; target: string | null; targetId: string | null; name: string | null; details: string | null; service: string }

function entryOf(srv: cds.Service, req: cds.Request, result: unknown): Entry | undefined {
  const event = req.event
  const target = req.target as { name?: string; actions?: Record<string, { kind?: string }> } | undefined
  const targetName = target?.name?.split('.').pop() ?? null
  // drafts are not saved yet: their activation is the CREATE / UPDATE of the active entity
  if (target?.name?.endsWith('.drafts') || (req.data as { IsActiveEntity?: boolean })?.IsActiveEntity === false) return
  if (['READ', 'NEW', 'PATCH', 'CANCEL', 'EDIT', 'DISCARD'].includes(event)) return
  const data = (req.data ?? {}) as Record<string, unknown>
  const row = (Array.isArray(result) ? result[0] : result) as Record<string, unknown> | undefined
  const isWrite = ['CREATE', 'UPDATE', 'UPSERT', 'DELETE'].includes(event)
  if (!isWrite) {
    if (NOT_LOGGED.has(event) || event.startsWith('draft')) return
    const operation = target?.actions?.[event] ?? (srv as unknown as { operations?: Record<string, { kind?: string }> }).operations?.[event]
    const def = operation ?? (cds.model?.definitions[`${srv.name}.${event}`] as { kind?: string } | undefined)
    if (def?.kind === 'function') return
  }
  const params = (req.params?.[0] ?? {}) as Record<string, unknown> | string
  const key = typeof params === 'string' ? params : ((params.ID as string | undefined) ?? (data.ID as string | undefined) ?? (row?.ID as string | undefined) ?? null)
  const name = (row?.name ?? data.name ?? null) as string | null
  const details = isWrite
    ? event === 'DELETE'
      ? null
      : Object.keys(data)
          .filter((k) => !TECHNICAL.has(k) && !SECRET.test(k))
          .join(', ')
    : actionDetails(data, row)
  return {
    user: req.user?.id ?? 'unknown',
    action: event,
    target: targetName,
    targetId: key ? String(key) : null,
    name: name ? truncate(String(name), columnLength('AuditLog', 'name')) : null,
    details: details ? truncate(details, columnLength('AuditLog', 'details')) : null,
    service: srv.name
  }
}

function actionDetails(data: Record<string, unknown>, row: Record<string, unknown> | undefined): string {
  const parts: string[] = []
  for (const k of ACTION_PARAMS) {
    const v = data[k]
    if (v === undefined || v === null || v === '') continue
    parts.push(Array.isArray(v) ? `${k}: ${v.length}` : `${k}: ${truncate(String(v), 100)}`)
  }
  // what an action returned that identifies its outcome (a run, a log)
  for (const k of ['runId', 'logId', 'subscriptionId', 'total', 'totalCount']) if (row?.[k] !== undefined && row[k] !== null) parts.push(`${k}: ${row[k]}`)
  return parts.join(', ')
}
