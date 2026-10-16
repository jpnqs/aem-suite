import { randomInt, randomUUID } from 'node:crypto'

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
 * The numbers are handed out beforehand (see number-ranges.ts), the resolver only inserts them.
 */
export interface TemplateScope {
  testCase?: Record<string, string>
  /** variables of the enclosing folders, outermost first */
  folders?: Record<string, string>[]
  broker?: Record<string, string>
  global?: Record<string, string>
  brokerInfo?: { id?: string; name?: string; msgVpn?: string }
  /** numbers handed out for this message: "numberRange.NAME" and "as:<alias>" -> formatted number */
  numbers?: Record<string, string>
}

/** A number this message needs: key as in TemplateScope.numbers, range = name of the number range. */
export interface NumberSlot {
  key: string
  range: string
}

const RANGE_PREFIX = 'numberRange.'

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
  private readonly numbers: Record<string, string>

  constructor(scope: TemplateScope = {}, now = new Date()) {
    // precedence: global < folders (outer -> inner) < broker < test case
    this.vars = Object.assign({}, scope.global, ...(scope.folders ?? []), scope.broker, scope.testCase)
    this.numbers = scope.numbers ?? {}
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

  /** Lists the variable names referenced in a template (built-ins excluded). */
  static referencedNames(template: string | null | undefined): string[] {
    if (!template) return []
    const names = new Set<string>()
    for (const m of template.matchAll(EXPR)) if (!isBuiltin(m[1], m[2] !== undefined)) names.add(m[1])
    return [...names]
  }

  private resolveInner(template: string, missing: Set<string>, depth: number): string {
    return template.replace(EXPR, (match, name: string, args: string | undefined, alias: string | undefined) => {
      const value = alias ? this.numberValue(`as:${alias}`, `${name} as ${alias}`, name, missing) : this.lookup(name, args, missing, depth)
      return value ?? match
    })
  }

  private lookup(name: string, args: string | undefined, missing: Set<string>, depth: number): string | undefined {
    if (args !== undefined) return this.callFunction(name, args, missing)
    if (name.startsWith(RANGE_PREFIX)) return this.numberValue(name, name, name, missing)
    // a temporary variable ({{numberRange.X as alias}}) wins over a variable of the same name
    if (`as:${name}` in this.numbers) return this.numbers[`as:${name}`]

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

  private numberValue(key: string, shown: string, name: string, missing: Set<string>): string | undefined {
    if (!name.startsWith(RANGE_PREFIX) || name.length === RANGE_PREFIX.length || !(key in this.numbers)) {
      missing.add(shown)
      return undefined
    }
    return this.numbers[key]
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

function isBuiltin(name: string, isCall: boolean): boolean {
  if (isCall) return name === 'randomInt'
  if (name.startsWith(RANGE_PREFIX)) return true
  return ['uuid', 'newUuid', 'now', 'timestamp', 'date', 'broker.id', 'broker.name', 'broker.msgVpn'].includes(name)
}

/** Validates JSON and returns an error message (or undefined if valid). */
export function jsonError(payload: string, contentType?: string | null): string | undefined {
  if (contentType && !/json/i.test(contentType)) return undefined
  if (!payload.trim()) return undefined
  try {
    JSON.parse(payload)
    return undefined
  } catch (e) {
    return `Payload is not valid JSON after resolving variables: ${(e as Error).message}`
  }
}

/**
 * The numbers a message needs from number ranges: in the templates and in the variables they use (a variable
 * may contain {{numberRange.X}} itself). Each plain range name and each "as alias" is one slot.
 */
export function numberSlots(templates: (string | null | undefined)[], scope: TemplateScope = {}): NumberSlot[] {
  const vars: Record<string, string> = Object.assign({}, scope.global, ...(scope.folders ?? []), scope.broker, scope.testCase)
  const slots = new Map<string, NumberSlot>()
  const aliases = new Set<string>()
  const direct = templates.filter((t): t is string => !!t)
  // aliases first: a variable of the same name is hidden by the alias and not followed
  for (const text of direct)
    for (const m of text.matchAll(EXPR)) if (m[3] && m[1].startsWith(RANGE_PREFIX)) aliases.add(m[3])

  const seen = new Set<string>()
  const scan = (text: string, depth: number): void => {
    for (const m of text.matchAll(EXPR)) {
      const [, name, args, alias] = m
      if (name.startsWith(RANGE_PREFIX)) {
        const range = name.slice(RANGE_PREFIX.length)
        if (!range) continue
        const key = alias ? `as:${alias}` : name
        slots.set(key, { key, range })
      } else if (args === undefined && depth < MAX_DEPTH && !aliases.has(name) && !seen.has(name) && Object.prototype.hasOwnProperty.call(vars, name)) {
        seen.add(name)
        scan(vars[name] ?? '', depth + 1)
      }
    }
  }
  for (const text of direct) scan(text, 0)
  return [...slots.values()]
}
