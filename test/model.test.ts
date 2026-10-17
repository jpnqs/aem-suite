import cds from '@sap/cds'
import path from 'node:path'
import { columnLength, enumValues, rangeOf } from '../srv/lib/model'

// Facts of db/schema.cds as the code reads them (lengths for truncation, enum values and limits for validation).

describe('model facts (lib/model.ts)', () => {
  const before = cds.model
  afterAll(() => {
    cds.model = before
  })

  it('has no limits without a loaded model', () => {
    cds.model = undefined as unknown as typeof cds.model
    expect(columnLength('RunResults', 'resolvedTopic')).toBe(Infinity)
  })

  it('reads column lengths, enum values and ranges from db/schema.cds', async () => {
    cds.model = cds.linked(await cds.load(path.join(__dirname, '..', 'db')))
    expect(columnLength('RunResults', 'resolvedTopic')).toBe(500)
    expect(columnLength('RunResults', 'errorMessage')).toBe(2000)
    expect(enumValues('TestCases', 'deliveryMode')).toEqual(['PERSISTENT', 'DIRECT'])
    expect(rangeOf('TestCases', 'priority')).toEqual([0, 255])
    expect(rangeOf('TestCases', 'topic')).toBeUndefined()
  })

  it('refuses an element without a length, so a typo does not silently disable the cut', () => {
    expect(() => columnLength('RunResults', 'nope')).toThrow(/RunResults\.nope is not a String column/)
    expect(() => columnLength('RunResults', 'ackLatencyMs')).toThrow(/not a String column/)
  })
})
