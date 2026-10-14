import { detectContentType, inferPropertyType, normalizeBrokerUrl } from '../srv/lib/defaults'

describe('normalizeBrokerUrl', () => {
  it.each([
    ['mr-xyz.messaging.solace.cloud', 'wss://mr-xyz.messaging.solace.cloud:443'],
    ['mr-xyz.messaging.solace.cloud:55443', 'tcps://mr-xyz.messaging.solace.cloud:55443'],
    ['localhost:55555', 'tcp://localhost:55555'],
    ['localhost:8008', 'ws://localhost:8008'],
    ['https://mr-xyz.messaging.solace.cloud/', 'wss://mr-xyz.messaging.solace.cloud:443'],
    ['http://broker:8008/path?x=1', 'ws://broker:8008'],
    ['wss://host', 'wss://host:443'],
    ['tcps://host', 'tcps://host:55443'],
    ['  WSS://Host:443  ', 'wss://Host:443']
  ])('%s -> %s', (input, expected) => expect(normalizeBrokerUrl(input)).toBe(expected))

  it('leaves unknown schemes and empty values alone', () => {
    expect(normalizeBrokerUrl('ftp://x')).toBe('ftp://x')
    expect(normalizeBrokerUrl('')).toBe('')
    expect(normalizeBrokerUrl(null)).toBeNull()
  })
})

describe('detectContentType / inferPropertyType', () => {
  it('detects JSON by its first character', () => {
    expect(detectContentType(' {"a":1}')).toBe('application/json')
    expect(detectContentType('[1]')).toBe('application/json')
    expect(detectContentType('{"broken"')).toBe('application/json') // still JSON -> validation reports the typo
    expect(detectContentType('hello')).toBe('text/plain')
    expect(detectContentType('')).toBe('application/json')
  })

  it('infers property types', () => {
    expect(inferPropertyType('42')).toBe('INT')
    expect(inferPropertyType('-7')).toBe('INT')
    expect(inferPropertyType('TRUE')).toBe('BOOL')
    expect(inferPropertyType('4.2')).toBe('STRING')
    expect(inferPropertyType('{{qty}}')).toBe('STRING')
    expect(inferPropertyType(null)).toBe('STRING')
  })
})
