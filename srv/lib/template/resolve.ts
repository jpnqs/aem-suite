import { randomInt, randomUUID } from 'node:crypto'

/**
 * Template syntax: {{name}} or {{fn(arg1, arg2)}}
 *
 * Lookup order for plain names (first match wins):
 *   1. test case variables   2. broker variables   3. global variables   4. built-ins
 *
 * Built-ins are stable within one resolver instance (= one message), so {{uuid}} in
 * topic, payload and correlation id resolves to the same value. Use {{newUuid}} for a
 * fresh value per occurrence.
 *
 *   uuid, newUuid, now (ISO), timestamp (epoch ms), date (YYYY-MM-DD),
 *   randomInt(min,max), broker.id, broker.name, broker.msgVpn
 */
export interface TemplateScope {
  testCase?: Record<string, string>
  broker?: Record<string, string>
  global?: Record<string, string>
  brokerInfo?: { id?: string; name?: string; msgVpn?: string }
}

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly missing: string[] = []
  ) {
    super(message)
  }
}

const EXPR = /\{\{\s*([A-Za-z_][\w.-]*)\s*(?:\(([^)]*)\))?\s*\}\}/g
const MAX_DEPTH = 5

export class TemplateResolver {
  private readonly fixed: Record<string, string>
  private readonly vars: Record<string, string>

  constructor(scope: TemplateScope = {}, now = new Date()) {
    this.vars = { ...scope.global, ...scope.broker, ...scope.testCase }
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
    return template.replace(EXPR, (match, name: string, args: string | undefined) => {
      const value = this.lookup(name, args, missing, depth)
      return value ?? match
    })
  }

  private lookup(name: string, args: string | undefined, missing: Set<string>, depth: number): string | undefined {
    if (args !== undefined) return this.callFunction(name, args, missing)

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
