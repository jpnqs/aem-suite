import type { CheckOperator, CheckTarget, ExpectMode } from '#cds-models/aem/suite'
import type { ReceivedMessage } from '../solace/session'

/**
 * Expected outcome of a test case: after sending, a message has to arrive (on a topic subscription, a queue, or as
 * the reply to the sent message) and the checks of the test case have to hold for it. The templates of source and
 * check values are resolved together with the sent message (lib/runs/test-case-spec.ts#buildSpec), so {{uuid}} in a
 * check is the uuid that was sent.
 */

export interface ResolvedCheck {
  target: CheckTarget
  path?: string | null
  operator: CheckOperator
  value?: string | null
}

export interface Expectation {
  mode: Exclude<ExpectMode, 'NONE'>
  /** topic subscription, queue name or reply-to topic (resolved) */
  source: string
  timeoutMs: number
  /** only messages with this correlation id count (undefined = any message) */
  correlationId?: string
  checks: ResolvedCheck[]
}

export interface CheckOutcome {
  description: string
  passed: boolean
  /** the value found, undefined = not there */
  actual?: string
}

/** A label of a check for the result list, e.g. "JSON path order.id equals 4711". */
export function describeCheck(c: ResolvedCheck): string {
  const what: Record<CheckTarget, string> = {
    PAYLOAD: 'payload',
    JSON_PATH: `JSON path ${c.path ?? ''}`,
    PROPERTY: `user property ${c.path ?? ''}`,
    TOPIC: 'topic',
    CORRELATION_ID: 'correlation id',
    CONTENT_TYPE: 'content type'
  }
  const op: Record<CheckOperator, string> = {
    EQUALS: 'equals',
    NOT_EQUALS: 'does not equal',
    CONTAINS: 'contains',
    MATCHES: 'matches',
    EXISTS: 'exists',
    NOT_EXISTS: 'does not exist'
  }
  const needsValue = c.operator !== 'EXISTS' && c.operator !== 'NOT_EXISTS'
  return `${what[c.target]} ${op[c.operator]}${needsValue ? ` ${c.value ?? ''}` : ''}`.trim()
}

/** Evaluates all checks on the received message. */
export function evaluateChecks(checks: ResolvedCheck[], msg: ReceivedMessage): CheckOutcome[] {
  let json: unknown
  let jsonParsed = false
  const payloadJson = () => {
    if (!jsonParsed) {
      jsonParsed = true
      try {
        json = JSON.parse(msg.payload)
      } catch {
        json = undefined
      }
    }
    return json
  }
  return checks.map((c) => {
    const actual = valueOf(c, msg, payloadJson)
    return { description: describeCheck(c), passed: holds(c, actual), actual }
  })
}

function valueOf(c: ResolvedCheck, msg: ReceivedMessage, payloadJson: () => unknown): string | undefined {
  switch (c.target) {
    case 'PAYLOAD':
      return msg.payload
    case 'TOPIC':
      return msg.topic
    case 'CORRELATION_ID':
      return msg.correlationId ?? undefined
    case 'CONTENT_TYPE':
      return msg.contentType ?? undefined
    case 'PROPERTY': {
      const v = msg.userProperties[c.path ?? '']
      return v === undefined || v === null ? undefined : String(v)
    }
    case 'JSON_PATH': {
      const v = jsonPath(payloadJson(), c.path ?? '')
      if (v === undefined) return undefined
      return typeof v === 'string' ? v : JSON.stringify(v)
    }
  }
}

function holds(c: ResolvedCheck, actual: string | undefined): boolean {
  const expected = c.value ?? ''
  switch (c.operator) {
    case 'EXISTS':
      return actual !== undefined
    case 'NOT_EXISTS':
      return actual === undefined
    case 'EQUALS':
      return actual !== undefined && actual === expected
    case 'NOT_EQUALS':
      return actual !== expected
    case 'CONTAINS':
      return actual !== undefined && actual.includes(expected)
    case 'MATCHES':
      return actual !== undefined && regexOf(expected).test(actual)
  }
}

/** A regular expression of a check; an invalid one is reported when the test case is saved (checkProblem). */
function regexOf(source: string): RegExp {
  try {
    return new RegExp(source)
  } catch {
    return /(?!)/ // matches nothing
  }
}

/**
 * A value in parsed JSON: dots for properties, [n] for list positions, an optional leading "$." -
 * e.g. order.items[0].id, $.lines[2], ["odd key"]. undefined = not there.
 */
export function jsonPath(root: unknown, path: string): unknown {
  const steps = parsePath(path)
  if (!steps) return undefined
  let cur = root
  for (const step of steps) {
    if (cur === null || typeof cur !== 'object') return undefined
    if (typeof step === 'number') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[step < 0 ? cur.length + step : step]
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, step)) return undefined
      cur = (cur as Record<string, unknown>)[step]
    }
  }
  return cur
}

/** The steps of a path, undefined if it cannot be read. */
export function parsePath(path: string): (string | number)[] | undefined {
  let rest = path.trim().replace(/^\$\.?/, '')
  const steps: (string | number)[] = []
  while (rest) {
    let m: RegExpMatchArray | null
    if ((m = rest.match(/^\[(-?\d+)\]/))) steps.push(Number(m[1]))
    else if ((m = rest.match(/^\[\s*"((?:[^"\\]|\\.)*)"\s*\]/) ?? rest.match(/^\[\s*'([^']*)'\s*\]/))) steps.push(m[1].replace(/\\(.)/g, '$1'))
    else if ((m = rest.match(/^\.?([^.[\]]+)/))) steps.push(m[1])
    else return undefined
    rest = rest.slice(m[0].length)
  }
  return steps
}

/** What is wrong with a check as entered, undefined = fine (saving a test case). Templates are not resolved here. */
export function checkProblem(c: { target?: string | null; path?: string | null; operator?: string | null; value?: string | null }): string | undefined {
  if (!c.target) return 'choose what the check looks at'
  if (!c.operator) return 'choose an operator'
  if ((c.target === 'JSON_PATH' || c.target === 'PROPERTY') && !c.path?.trim()) return c.target === 'JSON_PATH' ? 'enter a JSON path' : 'enter the name of the user property'
  if (c.target === 'JSON_PATH' && !parsePath(c.path!)) return `the JSON path "${c.path}" cannot be read`
  if (c.operator === 'MATCHES' && !/\{\{/.test(c.value ?? '')) {
    try {
      new RegExp(c.value ?? '')
    } catch {
      return `"${c.value}" is not a valid regular expression`
    }
  }
  return undefined
}

/** A received message matches the expectation's correlation id (if it has one). */
export function isExpectedMessage(e: Pick<Expectation, 'correlationId'>, msg: Pick<ReceivedMessage, 'correlationId'>): boolean {
  return !e.correlationId || msg.correlationId === e.correlationId
}
