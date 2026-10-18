import { buildMessage } from '../srv/lib/solace/session'
import { inferPropertyType, parseBool, parseInt64, propertyValueProblem } from '../srv/lib/testcases/property-types'

const TOO_BIG = '9007199254740993' // 2^53 + 1: Number() would silently round it

describe('user property types', () => {
  it.each([
    ['42', 42],
    [' -7 ', -7],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    [TOO_BIG, undefined],
    ['4.2', undefined],
    ['', undefined],
    [null, undefined]
  ])('parseInt64(%p) = %p', (value, expected) => expect(parseInt64(value)).toBe(expected))

  it.each([
    ['true', true],
    ['YES', true],
    ['1', true],
    ['false', false],
    [' no ', false],
    ['0', false],
    ['maybe', undefined],
    [null, undefined]
  ])('parseBool(%p) = %p', (value, expected) => expect(parseBool(value)).toBe(expected))

  it('infers INT only for integers that can be sent exactly', () => {
    expect(inferPropertyType('42')).toBe('INT')
    expect(inferPropertyType(TOO_BIG)).toBe('STRING')
    expect(inferPropertyType('True')).toBe('BOOL')
    expect(inferPropertyType('yes')).toBe('STRING') // only true/false are inferred, yes/no must be chosen
  })

  it('explains why a value does not fit its type', () => {
    expect(propertyValueProblem('INT', 'x')).toBe('must be an integer')
    expect(propertyValueProblem('INT', TOO_BIG)).toMatch(/^is too large/)
    expect(propertyValueProblem('BOOL', 'maybe')).toBe('must be true or false')
    expect(propertyValueProblem('BOOL', 'no')).toBeUndefined()
    expect(propertyValueProblem('STRING', 'anything')).toBeUndefined()
  })

  it('refuses to send values the type cannot carry instead of changing them', () => {
    const send = (type: 'INT' | 'BOOL', value: string) => () =>
      buildMessage({ topic: 't', payload: '', deliveryMode: 'DIRECT', userProperties: [{ name: 'p', type, value }] })
    expect(send('INT', TOO_BIG)).toThrow(/not an integer in the safe range/)
    expect(send('BOOL', 'maybe')).toThrow(/not true or false/)
    expect(send('BOOL', 'no')).not.toThrow()
  })
})
