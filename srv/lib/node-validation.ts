import { detectContentType, inferPropertyType } from './defaults'
import type { TestCaseRecord } from './test-case-spec'
import { loadTree } from './tree'

/**
 * Rules for creating / changing test cases and folders - shared by the UI service (TestService)
 * and the AI agent service (TestAgentService), so both ways in apply exactly the same checks.
 */

/** Reports a validation problem (req.error of the calling service). */
export type Reject = (status: number, message: string, target?: string) => void

export type NodeData = TestCaseRecord & { sortOrder?: number | null }

const VAR_NAME = /^[A-Za-z_][\w.-]*$/

/** The parent must be an existing folder and must not be the node itself or lie below it. Returns false if rejected. */
export async function validateParent(d: NodeData, id: string | undefined, reject: Reject): Promise<boolean> {
  if (d.parent_ID === undefined || d.parent_ID === null) return true
  const tree = await loadTree()
  const parent = tree.byId.get(d.parent_ID)
  if (!parent) return reject(400, 'Parent folder not found', 'in/parent_ID'), false
  if (parent.kind !== 'FOLDER') return reject(400, 'Test cases can only be placed in folders', 'in/parent_ID'), false
  if (id && tree.isWithin(d.parent_ID, id)) return reject(400, 'A folder cannot be moved into itself', 'in/parent_ID'), false
  return true
}

/** Position behind the last sibling of the given parent. */
export async function nextSortOrder(parentId: string | null | undefined): Promise<number> {
  const siblings = (await SELECT.from('aem.suite.TestCases')
    .columns('sortOrder')
    .where({ parent_ID: parentId ?? null })) as { sortOrder: number | null }[]
  return Math.max(0, ...siblings.map((x) => x.sortOrder ?? 0)) + 10
}

const DELIVERY_MODES = ['PERSISTENT', 'DIRECT']
const PROPERTY_TYPES = ['STRING', 'INT', 'BOOL']

/** Enum values the UI offers as dropdowns - the database does not check them. */
export function validateEnums(d: NodeData, reject: Reject): void {
  if (d.deliveryMode && !DELIVERY_MODES.includes(d.deliveryMode))
    reject(400, `deliveryMode must be ${DELIVERY_MODES.join(' or ')}`, 'in/deliveryMode')
  d.userProperties?.forEach((p, i) => {
    if (p.type && !PROPERTY_TYPES.includes(p.type)) reject(400, `type must be ${PROPERTY_TYPES.join(', ')}`, `in/userProperties(${i})/type`)
  })
}

/** Column sizes of db/schema.cds: OData requests are checked by CAP, direct database writes (copy, import, agent) are not. */
function validateLengths(d: NodeData, reject: Reject): void {
  const max = (value: string | null | undefined, limit: number, field: string, target: string) => {
    if (typeof value === 'string' && value.length > limit) reject(400, `${field} is too long (${value.length} characters, maximum ${limit})`, target)
  }
  max(d.name, 200, 'name', 'in/name')
  max((d as { description?: string | null }).description, 1000, 'description', 'in/description')
  max(d.topic, 500, 'topic', 'in/topic')
  max(d.contentType, 100, 'contentType', 'in/contentType')
  max(d.correlationId, 200, 'correlationId', 'in/correlationId')
  d.userProperties?.forEach((p, i) => {
    max(p.name, 100, 'user property name', `in/userProperties(${i})/name`)
    max(p.value, 1000, `user property "${p.name}" value`, `in/userProperties(${i})/value`)
  })
  d.variables?.forEach((v, i) => {
    max(v.name, 100, 'variable name', `in/variables(${i})/name`)
    max(v.value, 2000, `variable "${v.name}" value`, `in/variables(${i})/value`)
  })
}

/** Field rules of a folder / test case; also fills what was left empty (name, content type, property types). */
export function validateNode(d: NodeData, event: string, reject: Reject): void {
  validateLengths(d, reject)
  const isFolder = d.kind === 'FOLDER'
  if (isFolder) {
    if ((event === 'CREATE' || d.name !== undefined) && !d.name?.trim()) reject(400, 'Folder name is required', 'in/name')
  } else if (d.kind === 'TEST' || event === 'CREATE') {
    if (!d.topic?.trim()) reject(400, 'Topic is required', 'in/topic')
  }
  // fill what was left empty
  if (!d.name && d.topic) d.name = d.topic.slice(0, 200)
  if (!d.contentType && d.payload !== undefined) d.contentType = detectContentType(d.payload)
  d.userProperties?.forEach((p) => {
    if (!p.type) p.type = inferPropertyType(p.value) as string
  })
  if (d.payload) {
    // placeholders are replaced by 0 so templated numbers ({{count}}) stay valid JSON
    const probe = d.payload.replace(/\{\{[^}]*\}\}/g, '0')
    const isJson = !d.contentType || /json/i.test(d.contentType)
    if (isJson) {
      try {
        JSON.parse(probe)
      } catch (e) {
        reject(400, `Payload is not valid JSON: ${(e as Error).message}`, 'in/payload')
      }
    }
  }
  if (d.ackTimeoutMs != null && (d.ackTimeoutMs < 100 || d.ackTimeoutMs > 120000))
    reject(400, 'ACK timeout must be between 100 and 120000 ms', 'in/ackTimeoutMs')
  if (d.priority != null && (d.priority < 0 || d.priority > 255)) reject(400, 'Priority must be between 0 and 255', 'in/priority')

  const seen = new Set<string>()
  d.userProperties?.forEach((p, i) => {
    if (seen.has(p.name)) reject(400, `Duplicate user property "${p.name}"`, `in/userProperties(${i})/name`)
    seen.add(p.name)
    const templated = /\{\{/.test(p.value ?? '')
    if (p.type === 'INT' && !templated && !/^-?\d+$/.test(p.value ?? ''))
      reject(400, `User property "${p.name}" must be an integer`, `in/userProperties(${i})/value`)
    if (p.type === 'BOOL' && !templated && !/^(true|false|1|0|yes|no)$/i.test(p.value ?? ''))
      reject(400, `User property "${p.name}" must be true or false`, `in/userProperties(${i})/value`)
  })
  const seenVars = new Set<string>()
  d.variables?.forEach((v, i) => {
    if (!VAR_NAME.test(v.name ?? '')) reject(400, `Invalid variable name "${v.name}"`, `in/variables(${i})/name`)
    if (seenVars.has(v.name)) reject(400, `Duplicate variable "${v.name}"`, `in/variables(${i})/name`)
    seenVars.add(v.name)
  })
}
