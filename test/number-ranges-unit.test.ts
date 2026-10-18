import { formatNumber, nextExample } from '../srv/lib/template/number-ranges'
import { TemplateError, TemplateResolver, generatedSlots } from '../srv/lib/template/resolve'

// Number ranges without a server: the template side and the formatting (service and runs: number-ranges.test.ts).

describe('number range templates (resolver)', () => {
  it('finds the numbers a message needs: plain names once, every alias of its own, also inside variables', () => {
    const slots = generatedSlots(['{{numberRange.ORD}}/{{numberRange.ORD}}', '{{numberRange.ORD as a}} {{numberRange.ORD as b}} {{a}} {{inner}}'], {
      global: { inner: '{{numberRange.INV}}', unused: '{{numberRange.NEVER}}' }
    })
    expect(slots.map((s) => s.key).sort()).toEqual(['as:a', 'as:b', 'numberRange.INV', 'numberRange.ORD'])
    expect(slots.find((s) => s.key === 'as:b')?.range).toBe('ORD')
  })

  it('inserts the same number for every plain occurrence and keeps aliases as temporary variables', () => {
    const r = new TemplateResolver({ generated: { 'numberRange.ORD': 'SO-000007', 'as:a': 'SO-000008', 'as:b': 'SO-000009' } })
    expect(r.resolve('{{numberRange.ORD}} {{numberRange.ORD}}')).toBe('SO-000007 SO-000007')
    // an alias works before and after its definition
    expect(r.resolve('{{a}} / {{numberRange.ORD as a}} / {{a}} / {{b}} / {{numberRange.ORD as b}}')).toBe('SO-000008 / SO-000008 / SO-000008 / SO-000009 / SO-000009')
  })

  it('reports a number range that was not handed out', () => {
    expect(() => new TemplateResolver().resolve('{{numberRange.NOPE}}')).toThrow(TemplateError)
    expect(() => new TemplateResolver().resolve('{{numberRange.}}')).toThrow(/Unknown variable/)
  })

  it('formats prefix, zero filled number and suffix', () => {
    const r = { name: 'X', prefix: 'SO-', suffix: '-EU', length: 6, start: 1, step: 1 }
    expect(formatNumber(r, 42n)).toBe('SO-000042-EU')
    expect(formatNumber({ ...r, length: 0 }, 42n)).toBe('SO-42-EU')
    expect(nextExample(r)).toBe('SO-000001-EU')
    expect(nextExample({ ...r, start: 4500000000, step: 10, length: 10, current: 4500000010 })).toBe('SO-4500000020-EU')
  })
})
