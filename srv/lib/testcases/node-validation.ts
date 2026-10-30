import { TestCases } from '#cds-models/aem/suite'
import { detectContentType, SORT_STEP } from '../core/defaults'
import { errMsg, httpError } from '../core/errors'
import { inferPropertyType, propertyValueProblem } from './property-types'
import { TEST_FIELDS } from './test-fields'
import type { TestCaseRecord } from '../runs/test-case-spec'
import { loadTree } from './tree'
import { columnLength, elementOf, enumValues, rangeOf } from '../core/model'
import { config } from '../core/config'

/**
 * Rules for creating / changing test cases and folders - shared by the UI service (TestService),
 * the AI agent service (TestAgentService), the import and "create test case from message",
 * so all ways in apply the same checks. Enum values and numeric limits are @assert.range in db/schema.cds:
 * CAP checks them on OData requests, validateEnums and validateNode do it for the direct database writes.
 */

/** Reports a validation problem (req.error of the calling service). */
export type Reject = (status: number, message: string, target?: string) => void

export type NodeData = TestCaseRecord & { sortOrder?: number | null }

export const VAR_NAME = /^[A-Za-z_][\w.-]*$/
export const VAR_NAME_RULE = 'Variable names must start with a letter or _ and contain only letters, digits, _ . -'

/**
 * Runs the checks and returns all findings as readable texts ("userProperties(0)/name: ..."),
 * each prefixed with `where` if given (e.g. the position in an import file).
 */
export async function collectProblems(check: (reject: Reject) => unknown, where?: string): Promise<string[]> {
  const problems: string[] = []
  await check((_status, message, target) => {
    const text = target ? `${target.replace(/^in\//, '')}: ${message}` : message
    problems.push(where ? `${where}: ${text}` : text)
  })
  return problems
}

/** Like collectProblems, but throws a 400 with all findings in one message. */
export async function assertValid(check: (reject: Reject) => unknown): Promise<void> {
  const problems = await collectProblems(check)
  if (problems.length) throw httpError(400, problems.join('; '))
}

/** The parent must be an existing folder and must not be the node itself or lie below it. Returns false if rejected. */
export async function validateParent(d: Pick<NodeData, 'parent_ID'>, id: string | undefined, reject: Reject): Promise<boolean> {
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
  const siblings = (await SELECT.from(TestCases)
    .columns('sortOrder')
    .where({ parent_ID: parentId ?? null })) as { sortOrder: number | null }[]
  return Math.max(0, ...siblings.map((x) => x.sortOrder ?? 0)) + SORT_STEP
}

// ------------------------------------------------------------------ enums and lengths from db/schema.cds

/** Enum values for direct database writes (OData requests are checked by CAP through @assert.range). */
export function validateEnums(d: NodeData, reject: Reject): void {
  const deliveryModes = enumValues('TestCases', 'deliveryMode')
  if (d.deliveryMode && !deliveryModes.includes(d.deliveryMode))
    reject(400, `deliveryMode must be ${deliveryModes.join(' or ')}`, 'in/deliveryMode')
  const propertyTypes = enumValues('TestCaseProperties', 'type')
  d.userProperties?.forEach((p, i) => {
    if (p.type && !propertyTypes.includes(p.type)) reject(400, `type must be ${propertyTypes.join(', ')}`, `in/userProperties(${i})/type`)
  })
}

/** Column sizes of db/schema.cds: OData requests are checked by CAP, direct database writes (copy, import, agent, from message) are not. */
function validateLengths(d: NodeData, reject: Reject): void {
  const max = (entity: string, element: string, value: string | null | undefined, field: string, target: string) => {
    const limit = elementOf(entity, element)?.length
    if (limit && typeof value === 'string' && value.length > limit)
      reject(400, `${field} is too long (${value.length} characters, maximum ${limit})`, target)
  }
  for (const [f, type] of Object.entries(TEST_FIELDS)) if (type === 'text') max('TestCases', f, d[f as keyof NodeData] as string | null | undefined, f, `in/${f}`)
  d.userProperties?.forEach((p, i) => {
    max('TestCaseProperties', 'name', p.name, 'user property name', `in/userProperties(${i})/name`)
    max('TestCaseProperties', 'value', p.value, `user property "${p.name}" value`, `in/userProperties(${i})/value`)
  })
  d.variables?.forEach((v, i) => {
    max('TestCaseVariables', 'name', v.name, 'variable name', `in/variables(${i})/name`)
    max('TestCaseVariables', 'value', v.value, `variable "${v.name}" value`, `in/variables(${i})/value`)
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
  const nameLength = columnLength('TestCases', 'name')
  if (!d.name && d.topic) d.name = d.topic.slice(0, nameLength)
  if (!d.contentType && d.payload !== undefined) d.contentType = detectContentType(d.payload)
  d.userProperties?.forEach((p) => {
    if (!p.type) p.type = inferPropertyType(p.value)
  })
  if (d.payload) {
    const maxBytes = config().runs.maxPayloadBytes
    const bytes = Buffer.byteLength(d.payload, 'utf8')
    if (bytes > maxBytes) reject(400, `The payload has ${bytes} bytes - at most ${maxBytes} are allowed`, 'in/payload')
    // placeholders are replaced by 0 so templated numbers ({{count}}) stay valid JSON
    const probe = d.payload.replace(/\{\{[^}]*\}\}/g, '0')
    const isJson = !d.contentType || /json/i.test(d.contentType)
    if (isJson) {
      try {
        JSON.parse(probe)
      } catch (e) {
        reject(400, `Payload is not valid JSON: ${errMsg(e)}`, 'in/payload')
      }
    }
  }
  // the limits are @assert.range in db/schema.cds (CAP checks them for OData requests, this for direct writes)
  const outside = (value: number | null | undefined, element: string) => {
    const range = rangeOf('TestCases', element)
    return value != null && range && (value < range[0] || value > range[1]) ? range : undefined
  }
  const ack = outside(d.ackTimeoutMs, 'ackTimeoutMs')
  if (ack) reject(400, `ACK timeout must be between ${ack[0]} and ${ack[1]} ms`, 'in/ackTimeoutMs')
  const priority = outside(d.priority, 'priority')
  if (priority) reject(400, `Priority must be between ${priority[0]} and ${priority[1]}`, 'in/priority')

  const seen = new Set<string>()
  d.userProperties?.forEach((p, i) => {
    if (seen.has(p.name)) reject(400, `Duplicate user property "${p.name}"`, `in/userProperties(${i})/name`)
    seen.add(p.name)
    if (/\{\{/.test(p.value ?? '')) return // checked after the templates are resolved
    const problem = propertyValueProblem(p.type, p.value)
    if (problem) reject(400, `User property "${p.name}" ${problem}`, `in/userProperties(${i})/value`)
  })
  validateVariables(d.variables, reject)
}

/**
 * Names of a variable list (test case, folder or broker): only names a template can reference ({{name}}),
 * each once - otherwise whichever row loads last would win.
 */
export function validateVariables(list: { name?: string | null }[] | null | undefined, reject: Reject, targetPrefix = 'in/variables'): void {
  const seen = new Set<string>()
  list?.forEach((v, i) => {
    const name = v.name ?? ''
    if (!VAR_NAME.test(name)) reject(400, `Invalid variable name "${name}"`, `${targetPrefix}(${i})/name`)
    if (seen.has(name)) reject(400, `Duplicate variable "${name}"`, `${targetPrefix}(${i})/name`)
    seen.add(name)
  })
}
