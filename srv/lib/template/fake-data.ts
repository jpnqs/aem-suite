import { allFakers, type Faker } from '@faker-js/faker'
import { FAKER_PREFIX, TemplateError } from './resolve'
import { errMsg } from '../core/errors'

/**
 * Test data from faker.js for templates: {{faker.<module>.<method>}} or {{faker.<module>.<method>(args)}}, e.g.
 * {{faker.person.fullName}}, {{faker.internet.email}}, {{faker.number.int(1,100)}}.
 *
 * Only the data modules below are reachable (not faker.helpers, faker.seed, ...), only plain methods, and the
 * arguments are plain numbers, true / false or text - a template cannot run code.
 */

const MODULES = [
  'airline',
  'animal',
  'color',
  'commerce',
  'company',
  'database',
  'date',
  'finance',
  'git',
  'hacker',
  'internet',
  'location',
  'lorem',
  'music',
  'number',
  'person',
  'phone',
  'science',
  'string',
  'system',
  'vehicle',
  'word'
]

const PATH = /^([a-z]+)\.([A-Za-z]+)$/

/** The faker for a locale ("de", "fr", "en_GB" ...); English if unknown. */
function fakerFor(locale: string): Faker {
  const all = allFakers as Record<string, Faker>
  return all[locale] ?? all[locale.replace('-', '_')] ?? all.en
}

/** Splits at the commas that are not inside 'quotes' or "quotes": lorem.sentence('a, b') is one argument. */
function splitArgs(args: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null
  for (const c of args) {
    if (quote) {
      if (c === quote) quote = null
    } else if (c === "'" || c === '"') quote = c
    else if (c === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += c
  }
  return [...parts, current]
}

/** Arguments as written in the template: numbers, true / false, 'text' or "text" or bare text. */
function parseArgs(args: string | undefined): unknown[] {
  if (args === undefined || !args.trim()) return []
  return splitArgs(args).map((a) => {
    const s = a.trim()
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
    if (s === 'true') return true
    if (s === 'false') return false
    const quoted = /^(['"])(.*)\1$/.exec(s)
    return quoted ? quoted[2] : s
  })
}

/** faker takes options objects where templates write plain arguments: number.int(1,100) -> { min, max }. */
function toFakerArgs(path: string, args: unknown[]): unknown[] {
  if (['number.int', 'number.float', 'number.bigInt', 'finance.amount'].includes(path) && args.length && args.every((a) => typeof a === 'number')) {
    const [min, max] = args as number[]
    return [max === undefined ? { max: min } : { min, max }]
  }
  if (path === 'date.between' && args.length === 2) return [{ from: args[0], to: args[1] }]
  return args
}

function text(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** One generated value for `faker.<module>.<method>` with its arguments. Throws TemplateError for anything unknown. */
export function generateFake(name: string, args: string | undefined, locale = 'en'): string {
  const path = name.slice(FAKER_PREFIX.length)
  const m = PATH.exec(path)
  if (!m || !MODULES.includes(m[1])) throw new TemplateError(`Unknown faker expression "${name}" - use faker.<module>.<method>, e.g. faker.person.fullName`)
  const fn = (fakerFor(locale) as unknown as Record<string, Record<string, unknown>>)[m[1]]?.[m[2]]
  if (typeof fn !== 'function') throw new TemplateError(`Unknown faker expression "${name}" - there is no method ${m[2]} in faker.${m[1]}`)
  try {
    return text((fn as (...a: unknown[]) => unknown).apply((fakerFor(locale) as unknown as Record<string, unknown>)[m[1]], toFakerArgs(path, parseArgs(args))))
  } catch (e) {
    throw new TemplateError(`faker expression "${name}${args === undefined ? '' : `(${args})`}" failed: ${errMsg(e)}`)
  }
}
