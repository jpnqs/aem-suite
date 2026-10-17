import { randomInt, randomUUID } from 'node:crypto'
import { errMsg } from '../errors'

/**
 * Template syntax: {{name}} or {{fn(arg1, arg2)}}
 *
 * Lookup order for plain names (first match wins):
 *   1. test case variables   2. broker variables   3. folder variables (inner before outer)
 *   4. global variables      5. built-ins
 *
 * Built-ins are stable within one resolver instance (= one message), so {{uuid}} in
 * topic, payload and correlation id resolves to the same value. Use {{newUuid}} for a
 * fresh value per occurrence.
 *
 *   uuid, newUuid, now (ISO), timestamp (epoch ms), date (YYYY-MM-DD),
 *   randomInt(min,max), broker.id, broker.name, broker.msgVpn
 *
 * Number ranges: {{numberRange.NAME}} is the next number of the range, the same everywhere in one message.
 * {{numberRange.NAME as orderNo}} takes a number of its own and keeps it in the temporary variable {{orderNo}}
 * (usable anywhere in the message, also before the definition); two aliases of the same range get two numbers.
 * The numbers are handed out beforehand (see number-ranges.ts), the resolver only inserts them (TemplateScope.generated).
 *
 * Test data: {{faker.person.fullName}}, {{faker.number.int(1,100)}} ... (faker.js, see fake-data.ts). Like a number,
 * the value is generated beforehand and is the same everywhere in one message; "as alias" gives a value of its own.
 */
export interface TemplateScope {
  testCase?: Record<string, string>
  /** variables of the enclosing folders, outermost first */
  folders?: Record<string, string>[]
  broker?: Record<string, string>
  global?: Record<string, string>
  brokerInfo?: { id?: string; name?: string; msgVpn?: string }
  /** values generated for this message (numbers of number ranges, faker values): slot key -> value */
  generated?: Record<string, string>
}

/**
 * A generated value this message needs, key as in TemplateScope.generated: a number of the range `range`, or (faker)
 * a faker.js value for `faker.name` with its arguments.
 */
export interface GeneratedSlot {
  key: string
  range: string
  faker?: { name: string; args?: string }
}

const RANGE_PREFIX = 'numberRange.'
export const FAKER_PREFIX = 'faker.'

/** The key of a faker expression in TemplateScope.generated: name and arguments without blanks. */
export function fakerKey(name: string, args: string | undefined): string {
  return args === undefined ? name : `${name}(${args.replace(/[ \t]+/g, '')})`
}

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly missing: string[] = []
  ) {
    super(message)
  }
}

const EXPR = /\{\{\s*([A-Za-z_][\w.-]*)\s*(?:\(([^)]*)\))?(?:\s+as\s+([A-Za-z_]\w*))?\s*\}\}/g
const MAX_DEPTH = 5

export class TemplateResolver {
  private readonly fixed: Record<string, string>
  private readonly vars: Record<string, string>
  private readonly generated: Record<string, string>

  constructor(scope: TemplateScope = {}, now = new Date()) {
    // precedence: global < folders (outer -> inner) < broker < test case
    this.vars = Object.assign({}, scope.global, ...(scope.folders ?? []), scope.broker, scope.testCase)
    this.generated = scope.generated ?? {}
    this.fixed = {
      uuid: randomUUID(),
      now: now.toISOString(),
      timestamp: String(now.getTime()),
      date: now.toISOString().slice(0, 10),
      'broker.id': scope.brokerInfo?.id ?? '',
      'broker.name': scope.brokerInfo?.name ?? '',
      'broker.msgVpn': scope.brokerInfo?.msgVpn ?? ''
    }
  }

  /** Resolves all expressions; throws TemplateError listing unknown variables. */
  resolve(template: string | null | undefined): string {
    if (template == null) return ''
    const missing = new Set<string>()
    const out = this.resolveInner(template, missing, 0)
    if (missing.size) {
      const names = [...missing]
      throw new TemplateError(`Unknown variable(s): ${names.join(', ')}`, names)
    }
    return out
  }

  private resolveInner(template: string, missing: Set<string>, depth: number): string {
    return template.replace(EXPR, (match, name: string, args: string | undefined, alias: string | undefined) => {
      const value = alias ? this.generatedValue(`as:${alias}`, `${name} as ${alias}`, name, missing) : this.lookup(name, args, missing, depth)
      return value ?? match
    })
  }

  private lookup(name: string, args: string | undefined, missing: Set<string>, depth: number): string | undefined {
    if (name.startsWith(FAKER_PREFIX)) {
      const key = fakerKey(name, args)
      return this.generatedValue(key, key, name, missing)
    }
    if (args !== undefined) return this.callFunction(name, args, missing)
    if (name.startsWith(RANGE_PREFIX)) return this.generatedValue(name, name, name, missing)
    // a temporary variable ({{numberRange.X as alias}}) wins over a variable of the same name
    if (`as:${name}` in this.generated) return this.generated[`as:${name}`]

    if (Object.prototype.hasOwnProperty.call(this.vars, name)) {
      const raw = this.vars[name] ?? ''
      // variables may reference other variables / built-ins
      if (depth >= MAX_DEPTH) throw new TemplateError(`Variable nesting too deep (cycle?) at "${name}"`)
      return this.resolveInner(raw, missing, depth + 1)
    }
    if (name === 'newUuid') return randomUUID()
    if (name in this.fixed) return this.fixed[name]
    missing.add(name)
    return undefined
  }

  private generatedValue(key: string, shown: string, name: string, missing: Set<string>): string | undefined {
    const isGenerated = name.startsWith(RANGE_PREFIX) ? name.length > RANGE_PREFIX.length : name.startsWith(FAKER_PREFIX) && name.length > FAKER_PREFIX.length
    if (!isGenerated || !(key in this.generated)) {
      missing.add(shown)
      return undefined
    }
    return this.generated[key]
  }

  private callFunction(name: string, args: string, missing: Set<string>): string | undefined {
    const parts = args.split(',').map((a) => a.trim())
    switch (name) {
      case 'randomInt': {
        const min = parts[0] ? Number(parts[0]) : 0
        const max = parts[1] ? Number(parts[1]) : 1000
        if (!Number.isInteger(min) || !Number.isInteger(max) || max < min)
          throw new TemplateError(`Invalid arguments for randomInt(${args})`)
        return String(randomInt(min, max + 1))
      }
      default:
        missing.add(`${name}()`)
        return undefined
    }
  }
}

/** Validates JSON and returns an error message (or undefined if valid). */
export function jsonError(payload: string, contentType?: string | null): string | undefined {
  if (contentType && !/json/i.test(contentType)) return undefined
  if (!payload.trim()) return undefined
  try {
    JSON.parse(payload)
    return undefined
  } catch (e) {
    return `Payload is not valid JSON after resolving variables: ${errMsg(e)}`
  }
}

/**
 * The generated values a message needs (numbers from number ranges, faker values): in the templates and in the variables they use (a variable
 * may contain {{numberRange.X}} itself). Each plain range name / faker expression and each "as alias" is one slot.
 */
export function generatedSlots(templates: (string | null | undefined)[], scope: TemplateScope = {}): GeneratedSlot[] {
  const vars: Record<string, string> = Object.assign({}, scope.global, ...(scope.folders ?? []), scope.broker, scope.testCase)
  const slots = new Map<string, GeneratedSlot>()
  const aliases = new Set<string>()
  const direct = templates.filter((t): t is string => !!t)
  // aliases first: a variable of the same name is hidden by the alias and not followed
  for (const text of direct)
    for (const m of text.matchAll(EXPR)) if (m[3] && (m[1].startsWith(RANGE_PREFIX) || m[1].startsWith(FAKER_PREFIX))) aliases.add(m[3])

  const seen = new Set<string>()
  const scan = (text: string, depth: number): void => {
    for (const m of text.matchAll(EXPR)) {
      const [, name, args, alias] = m
      if (name.startsWith(RANGE_PREFIX)) {
        const range = name.slice(RANGE_PREFIX.length)
        if (!range) continue
        const key = alias ? `as:${alias}` : name
        slots.set(key, { key, range })
      } else if (name.startsWith(FAKER_PREFIX)) {
        const key = alias ? `as:${alias}` : fakerKey(name, args)
        slots.set(key, { key, range: '', faker: { name, args } })
      } else if (args === undefined && depth < MAX_DEPTH && !aliases.has(name) && !seen.has(name) && Object.prototype.hasOwnProperty.call(vars, name)) {
        seen.add(name)
        scan(vars[name] ?? '', depth + 1)
      }
    }
  }
  for (const text of direct) scan(text, 0)
  return [...slots.values()]
}
