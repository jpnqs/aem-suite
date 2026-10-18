import { httpError } from '../core/errors'

export type AgeUnit = 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS'

/** "older than 3 MONTHS" or "before 2026-01-01" (before wins if both are given). */
export interface Age {
  value?: number | null
  unit?: AgeUnit | null
  /** a date (YYYY-MM-DD): everything before its start (00:00 UTC) */
  before?: string | null
}

/** "older than 0 days" would hit data that is being written right now - an age is at least one day. */
export const MIN_AGE_DAYS = 1

const UNITS: AgeUnit[] = ['DAYS', 'WEEKS', 'MONTHS', 'YEARS']

/**
 * The cutoff of an age: rows written before it are old enough. Months and years go by the calendar and stay
 * within the month (31 Mar - 1 month = 28/29 Feb). Throws a 400 error for an incomplete or too small age.
 */
export function cutoffOf(age: Age | null | undefined, now = new Date()): Date {
  if (!age) throw httpError(400, 'Choose how old the data must be')
  if (age.before) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(age.before)
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
    if (!d || d.toISOString().slice(0, 10) !== age.before) throw httpError(400, `"${age.before}" is no valid date (YYYY-MM-DD)`)
    if (d.getTime() > now.getTime() - MIN_AGE_DAYS * DAY_MS) throw httpError(400, `The date must be at least ${MIN_AGE_DAYS} day in the past`)
    return d
  }
  const { value, unit } = age
  if (!unit || !UNITS.includes(unit)) throw httpError(400, `Unknown unit "${unit ?? ''}" - use ${UNITS.join(', ')}`)
  if (!Number.isInteger(value) || (value as number) < 1) throw httpError(400, 'The age must be a whole number of at least 1')
  const n = value as number
  if (unit === 'DAYS') return new Date(now.getTime() - n * DAY_MS)
  if (unit === 'WEEKS') return new Date(now.getTime() - n * 7 * DAY_MS)
  return minusMonths(now, unit === 'YEARS' ? n * 12 : n)
}

const DAY_MS = 24 * 60 * 60 * 1000

function minusMonths(d: Date, months: number): Date {
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() - months
  const year = Math.floor(total / 12)
  const month = total - year * 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const r = new Date(d)
  r.setUTCFullYear(year, month, Math.min(d.getUTCDate(), lastDay))
  return r
}
