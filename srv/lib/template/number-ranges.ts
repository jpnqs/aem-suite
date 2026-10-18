import cds from '@sap/cds'
import { NumberRanges } from '#cds-models/aem/suite'
import { TemplateError, type GeneratedSlot } from './resolve'

/** Name of a number range as used in {{numberRange.<name>}}. */
export const RANGE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/
export const MAX_LENGTH = 18

export interface NumberRange {
  ID?: string
  name?: string
  prefix?: string | null
  suffix?: string | null
  length?: number | null
  start?: number | string | null
  step?: number | null
  maximum?: number | string | null
  current?: number | string | null
}

const big = (v: number | string | null | undefined): bigint | null => (v === null || v === undefined || v === '' ? null : BigInt(v))

/** The step as a number (1 if empty). */
const stepOf = (r: NumberRange) => BigInt(r.step || 1)

/** The number issued last, or the one before the first (start - step) if nothing was issued yet. */
function lastOf(r: NumberRange): bigint {
  return big(r.current) ?? (big(r.start) ?? 1n) - stepOf(r)
}

/** prefix + number filled with zeros to `length` digits + suffix. */
export function formatNumber(r: NumberRange, n: bigint): string {
  const digits = String(n)
  const padded = r.length && r.length > 0 ? digits.padStart(r.length, '0') : digits
  return `${r.prefix ?? ''}${padded}${r.suffix ?? ''}`
}

/** What the next number would be (nothing is issued). */
export function nextExample(r: NumberRange): string {
  return formatNumber(r, lastOf(r) + stepOf(r))
}

/** Why the number `last` cannot be issued (exhausted range), or undefined. */
function overflow(r: NumberRange, last: bigint): string | undefined {
  const max = big(r.maximum)
  if (max !== null && last > max) return `Number range "${r.name}" is exhausted (maximum ${max}). Reset it or raise the maximum.`
  const digits = r.length && r.length > 0 ? r.length : null
  if (digits && String(last).length > digits) return `Number range "${r.name}" is exhausted: the number ${last} no longer fits into ${digits} digits.`
  return undefined
}

/** Numbers `count` times in a row, from the range as it is now. Does not change anything. */
function numbersFrom(r: NumberRange, count: number): { values: string[]; last: bigint } {
  let n = lastOf(r)
  const values: string[] = []
  for (let i = 0; i < count; i++) {
    n += stepOf(r)
    const problem = overflow(r, n)
    if (problem) throw new TemplateError(problem)
    values.push(formatNumber(r, n))
  }
  return { values, last: n }
}

const MAX_ATTEMPTS = 8

/**
 * Hands out the numbers for the slots of one message: one number per slot (a plain {{numberRange.X}} and every
 * "as alias" is one slot).
 *   consume: the numbers are issued for real (the range moves on, saved right away - also if the message
 *            later fails, a number is never used twice)
 *   peek:    the numbers the message would get now; nothing changes (Preview)
 * Returns slot key -> formatted number.
 */
export async function allocateNumbers(slots: GeneratedSlot[], mode: 'consume' | 'peek'): Promise<Record<string, string>> {
  const byRange = new Map<string, GeneratedSlot[]>()
  for (const s of slots) byRange.set(s.range, [...(byRange.get(s.range) ?? []), s])

  const out: Record<string, string> = {}
  for (const [name, list] of byRange) {
    const values = mode === 'peek' ? await peek(name, list.length) : await consume(name, list.length)
    list.forEach((slot, i) => (out[slot.key] = values[i]))
  }
  return out
}

async function load(name: string): Promise<NumberRange & { ID: string }> {
  const r = (await SELECT.one.from(NumberRanges).where({ name })) as (NumberRange & { ID: string }) | undefined
  if (!r) throw new TemplateError(`Unknown number range "${name}" - maintain it in the Number Ranges app`)
  return r
}

async function peek(name: string, count: number): Promise<string[]> {
  return numbersFrom(await load(name), count).values
}

/**
 * Takes the numbers with a compare-and-set update of `current`, so parallel runs never get the same number.
 * ownTx: in a transaction of its own (committed at once, independent of the run); otherwise in the caller's.
 */
async function consume(name: string, count: number, ownTx = true): Promise<string[]> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const done = ownTx ? await cds.tx({}, () => takeOnce(name, count)) : await takeOnce(name, count)
    if (done) return done
  }
  throw new TemplateError(`Number range "${name}" is busy - try again`)
}

/** One compare-and-set attempt; undefined when someone else moved the range meanwhile. */
async function takeOnce(name: string, count: number): Promise<string[] | undefined> {
  const r = await load(name)
  const { values, last } = numbersFrom(r, count)
  const where = r.current === null || r.current === undefined ? { ID: r.ID, current: null } : { ID: r.ID, current: r.current }
  // by name: cds-typer types Integer64 as number, `current` is written as text (no precision lost)
  const changed = await UPDATE('aem.suite.NumberRanges')
    .set({ current: String(last), lastUsedAt: new Date().toISOString() })
    .where(where)
  return changed ? values : undefined
}

/**
 * Issues the next number of the range by name, as a run does ("Count Up" in the Number Ranges app). Runs in the
 * caller's transaction: the action request commits it.
 */
export async function issueNext(name: string): Promise<string> {
  return (await consume(name, 1, false))[0]
}

/**
 * `current` after giving the last issued number back ("Count Down"): the next number issued is that one again.
 * null = nothing issued any more; undefined = nothing was issued, so there is nothing to give back.
 */
export function currentBeforeLast(r: NumberRange): string | null | undefined {
  const current = big(r.current)
  const start = big(r.start) ?? 1n
  if (current === null || current < start) return undefined
  const previous = current - stepOf(r)
  return previous < start ? null : String(previous)
}

/** Sets the range so that `next` is the next number issued (default: the start of the range). */
export function currentForNext(r: NumberRange, next?: number | string | null): string | null {
  if (next === null || next === undefined || next === '') return null
  return String(BigInt(next) - stepOf(r))
}
