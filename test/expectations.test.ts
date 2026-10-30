import { checkProblem, describeCheck, evaluateChecks, jsonPath, parsePath, type ResolvedCheck } from '../srv/lib/runs/expectations'
import { topicMatches, type ReceivedMessage } from '../srv/lib/solace/session'

const msg = (over: Partial<ReceivedMessage> = {}): ReceivedMessage => ({
  topic: 'acme/orders/created/v1',
  payload: JSON.stringify({ order: { id: 4711, items: [{ sku: 'A-1' }, { sku: 'B-2' }], note: null }, 'odd key': true }),
  contentType: 'application/json',
  userProperties: { source: 'erp', count: '3' },
  correlationId: 'c-1',
  deliveryMode: 'PERSISTENT',
  receivedAt: new Date(),
  ...over
})

describe('expected message checks (lib/runs/expectations.ts)', () => {
  it('reads JSON paths: properties, list positions, $ prefix, quoted keys', () => {
    const doc = JSON.parse(msg().payload)
    expect(jsonPath(doc, 'order.id')).toBe(4711)
    expect(jsonPath(doc, '$.order.items[1].sku')).toBe('B-2')
    expect(jsonPath(doc, 'order.items[-1].sku')).toBe('B-2')
    expect(jsonPath(doc, '["odd key"]')).toBe(true)
    expect(jsonPath(doc, 'order.note')).toBeNull()
    expect(jsonPath(doc, 'order.missing')).toBeUndefined()
    expect(jsonPath(doc, 'order.items[5]')).toBeUndefined()
    expect(parsePath('a..b')).toBeUndefined()
  })

  it('evaluates every target and operator', () => {
    const checks: ResolvedCheck[] = [
      { target: 'JSON_PATH', path: 'order.id', operator: 'EQUALS', value: '4711' },
      { target: 'JSON_PATH', path: 'order.items[0]', operator: 'EQUALS', value: '{"sku":"A-1"}' },
      { target: 'JSON_PATH', path: 'order.missing', operator: 'NOT_EXISTS' },
      { target: 'PAYLOAD', operator: 'CONTAINS', value: 'B-2' },
      { target: 'PROPERTY', path: 'source', operator: 'MATCHES', value: '^e.p$' },
      { target: 'PROPERTY', path: 'nope', operator: 'EXISTS' },
      { target: 'TOPIC', operator: 'NOT_EQUALS', value: 'other' },
      { target: 'CORRELATION_ID', operator: 'EQUALS', value: 'c-2' },
      { target: 'CONTENT_TYPE', operator: 'CONTAINS', value: 'json' }
    ]
    const outcome = evaluateChecks(checks, msg())
    expect(outcome.map((o) => o.passed)).toEqual([true, true, true, true, true, false, true, false, true])
    expect(outcome[7]).toEqual({ description: 'correlation id equals c-2', passed: false, actual: 'c-1' })
    expect(outcome[5].actual).toBeUndefined()
  })

  it('a payload that is no JSON has no JSON paths', () => {
    const [o] = evaluateChecks([{ target: 'JSON_PATH', path: 'a', operator: 'EXISTS' }], msg({ payload: 'plain text' }))
    expect(o.passed).toBe(false)
  })

  it('describes checks for the result list', () => {
    expect(describeCheck({ target: 'JSON_PATH', path: 'order.id', operator: 'EQUALS', value: '42' })).toBe('JSON path order.id equals 42')
    expect(describeCheck({ target: 'PROPERTY', path: 'x', operator: 'EXISTS', value: 'ignored' })).toBe('user property x exists')
  })

  it('reports incomplete checks when the test case is saved', () => {
    expect(checkProblem({ target: 'JSON_PATH', operator: 'EQUALS', path: '' })).toBe('enter a JSON path')
    expect(checkProblem({ target: 'PROPERTY', operator: 'EXISTS' })).toBe('enter the name of the user property')
    expect(checkProblem({ target: 'PAYLOAD', operator: 'MATCHES', value: '(' })).toMatch(/not a valid regular expression/)
    expect(checkProblem({ target: 'PAYLOAD', operator: 'MATCHES', value: '{{pattern}}' })).toBeUndefined()
    expect(checkProblem({ target: 'TOPIC', operator: 'EQUALS', value: 'a' })).toBeUndefined()
  })

  it('matches topics against Solace subscriptions', () => {
    expect(topicMatches('a/b/c', 'a/b/c')).toBe(true)
    expect(topicMatches('a/*/c', 'a/x/c')).toBe(true)
    expect(topicMatches('a/b*/c', 'a/bee/c')).toBe(true)
    expect(topicMatches('a/b*/c', 'a/x/c')).toBe(false)
    expect(topicMatches('a/>', 'a/b/c')).toBe(true)
    expect(topicMatches('a/>', 'a')).toBe(false)
    expect(topicMatches('a/b', 'a/b/c')).toBe(false)
    expect(topicMatches('a/b/c', 'a/b')).toBe(false)
  })
})
