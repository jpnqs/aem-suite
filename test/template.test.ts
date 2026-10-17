import { TemplateError, TemplateResolver, jsonError } from '../srv/lib/template/resolve'

describe('TemplateResolver', () => {
  it('applies precedence test case > broker > global', () => {
    const r = new TemplateResolver({
      global: { a: 'g', b: 'g', c: 'g' },
      broker: { b: 'b', c: 'b' },
      testCase: { c: 't' }
    })
    expect(r.resolve('{{a}}-{{b}}-{{c}}')).toBe('g-b-t')
  })

  it('keeps built-ins stable per resolver and offers newUuid', () => {
    const r = new TemplateResolver()
    const a = r.resolve('{{uuid}}')
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(r.resolve('{{ uuid }}')).toBe(a)
    expect(r.resolve('{{newUuid}}')).not.toBe(r.resolve('{{newUuid}}'))
    expect(new TemplateResolver().resolve('{{uuid}}')).not.toBe(a)
  })

  it('resolves time built-ins from the given clock', () => {
    const now = new Date('2026-01-02T03:04:05.000Z')
    const r = new TemplateResolver({}, now)
    expect(r.resolve('{{now}}|{{timestamp}}|{{date}}')).toBe(`2026-01-02T03:04:05.000Z|${now.getTime()}|2026-01-02`)
  })

  it('supports randomInt(min,max) within bounds', () => {
    const r = new TemplateResolver()
    for (let i = 0; i < 50; i++) {
      const n = Number(r.resolve('{{randomInt(3, 5)}}'))
      expect(n).toBeGreaterThanOrEqual(3)
      expect(n).toBeLessThanOrEqual(5)
    }
    expect(() => r.resolve('{{randomInt(5,1)}}')).toThrow(TemplateError)
  })

  it('exposes broker info', () => {
    const r = new TemplateResolver({ brokerInfo: { id: 'B1', name: 'dev', msgVpn: 'vpn1' } })
    expect(r.resolve('{{broker.name}}/{{broker.msgVpn}}/{{broker.id}}')).toBe('dev/vpn1/B1')
  })

  it('resolves variables that reference other variables and built-ins', () => {
    const r = new TemplateResolver({ global: { region: 'eu', topic: 'acme/{{region}}/{{broker.name}}' }, brokerInfo: { name: 'x' } })
    expect(r.resolve('{{topic}}')).toBe('acme/eu/x')
  })

  it('detects cycles', () => {
    const r = new TemplateResolver({ global: { a: '{{b}}', b: '{{a}}' } })
    expect(() => r.resolve('{{a}}')).toThrow(/nesting too deep/)
  })

  it('reports all unknown variables', () => {
    const r = new TemplateResolver({ global: { known: '1' } })
    expect(() => r.resolve('{{known}} {{foo}} {{bar}} {{foo}}')).toThrow(expect.objectContaining({ constructor: TemplateError, missing: ['foo', 'bar'] }))
  })
})

describe('jsonError', () => {
  it('accepts valid JSON, empty payloads and non-JSON content types', () => {
    expect(jsonError('{"a":1}')).toBeUndefined()
    expect(jsonError('  ')).toBeUndefined()
    expect(jsonError('<xml/>', 'application/xml')).toBeUndefined()
  })

  it('rejects invalid JSON', () => {
    expect(jsonError('{"a":}', 'application/json')).toMatch(/not valid JSON/)
  })
})
