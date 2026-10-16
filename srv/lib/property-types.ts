/**
 * The types of user properties - one place for inference (on save), validation and conversion (on send).
 */

export type PropertyType = 'STRING' | 'INT' | 'BOOL'

const INTEGER = /^-?\d+$/
const TRUE_WORDS = ['true', '1', 'yes']
const BOOL_WORDS = [...TRUE_WORDS, 'false', '0', 'no']

/** The integer of an INT value, or undefined if it is none (or too large to send without losing digits). */
export function parseInt64(value: string | null | undefined): number | undefined {
  const v = (value ?? '').trim()
  if (!INTEGER.test(v)) return undefined
  const n = Number(v)
  return Number.isSafeInteger(n) ? n : undefined
}

/** The boolean of a BOOL value (true/false, 1/0, yes/no), or undefined if it is none. */
export function parseBool(value: string | null | undefined): boolean | undefined {
  const v = (value ?? '').trim().toLowerCase()
  return BOOL_WORDS.includes(v) ? TRUE_WORDS.includes(v) : undefined
}

/** INT for integers, BOOL for true/false, STRING otherwise (also for templated values). */
export function inferPropertyType(value: string | null | undefined): PropertyType {
  const v = (value ?? '').trim()
  if (parseInt64(v) !== undefined) return 'INT'
  if (/^(true|false)$/i.test(v)) return 'BOOL'
  return 'STRING'
}

/** Problem of a value for its type, or undefined if it fits. */
export function propertyValueProblem(type: string | null | undefined, value: string | null | undefined): string | undefined {
  if (type === 'INT' && parseInt64(value) === undefined)
    return INTEGER.test((value ?? '').trim())
      ? `is too large (allowed: ${Number.MIN_SAFE_INTEGER} to ${Number.MAX_SAFE_INTEGER})`
      : 'must be an integer'
  if (type === 'BOOL' && parseBool(value) === undefined) return 'must be true or false'
  return undefined
}
