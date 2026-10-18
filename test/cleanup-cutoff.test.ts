import { cutoffOf } from '../srv/lib/cleanup/cutoff'

const NOW = new Date('2026-03-31T10:15:00.000Z')
const at = (age: Parameters<typeof cutoffOf>[0]) => cutoffOf(age, NOW).toISOString()

describe('cleanup cutoff', () => {
  it('counts days and weeks from now', () => {
    expect(at({ value: 1, unit: 'DAYS' })).toBe('2026-03-30T10:15:00.000Z')
    expect(at({ value: 2, unit: 'WEEKS' })).toBe('2026-03-17T10:15:00.000Z')
  })

  it('goes back months and years by the calendar, staying within the month', () => {
    expect(at({ value: 1, unit: 'MONTHS' })).toBe('2026-02-28T10:15:00.000Z')
    expect(at({ value: 3, unit: 'MONTHS' })).toBe('2025-12-31T10:15:00.000Z')
    expect(at({ value: 15, unit: 'MONTHS' })).toBe('2024-12-31T10:15:00.000Z')
    expect(cutoffOf({ value: 1, unit: 'YEARS' }, new Date('2028-02-29T00:00:00Z')).toISOString()).toBe('2027-02-28T00:00:00.000Z')
    expect(cutoffOf({ value: 1, unit: 'MONTHS' }, new Date('2028-03-30T00:00:00Z')).toISOString()).toBe('2028-02-29T00:00:00.000Z')
  })

  it('takes a date as the start of that day (UTC), before the relative age', () => {
    expect(at({ before: '2026-01-15', value: 1, unit: 'DAYS' })).toBe('2026-01-15T00:00:00.000Z')
  })

  it('rejects missing, too small and invalid ages', () => {
    expect(() => cutoffOf(null, NOW)).toThrow(/how old/)
    expect(() => at({ value: 0, unit: 'DAYS' })).toThrow(/at least 1/)
    expect(() => at({ value: 1.5, unit: 'DAYS' })).toThrow(/whole number/)
    expect(() => at({ value: 1 })).toThrow(/Unknown unit/)
    expect(() => at({ value: 1, unit: 'HOURS' as never })).toThrow(/Unknown unit/)
    expect(() => at({ before: '2026-02-30' })).toThrow(/no valid date/)
    expect(() => at({ before: '31.12.2025' })).toThrow(/no valid date/)
    expect(() => at({ before: '2026-03-31' })).toThrow(/in the past/)
    expect(() => at({ before: '2027-01-01' })).toThrow(/in the past/)
  })
})
