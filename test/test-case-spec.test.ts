import { buildSpec, scopeFor, TestCaseRecord, VariableScopes } from '../srv/lib/runs/test-case-spec'
import { TemplateError } from '../srv/lib/template/resolve'
import { Tree } from '../srv/lib/testcases/tree'

// From a stored test case to what is published - without a database.

const tree = new Tree([
  { ID: 'root', parent_ID: null, kind: 'FOLDER', name: 'Orders', sortOrder: 10 },
  { ID: 'eu', parent_ID: 'root', kind: 'FOLDER', name: 'EU', sortOrder: 10 }
])
const vars: VariableScopes = {
  global: { domain: 'global', app: 'shop' },
  byBroker: new Map([['b1', { region: 'from-broker' }]]),
  byFolder: new Map<string, Record<string, string>>([
    ['root', { domain: 'orders', region: 'from-root' }],
    ['eu', { region: 'eu' }]
  ]),
  tree
}
const broker = { ID: 'b1', name: 'dev', msgVpn: 'vpn1' }
const tc = (extra: Partial<TestCaseRecord> = {}): TestCaseRecord => ({ ID: 't1', name: 'n', topic: '{{app}}/{{domain}}', parent_ID: 'eu', ...extra })

describe('scopeFor / buildSpec', () => {
  it('takes variables from global < folders (outer to inner) < broker < test case', () => {
    const spec = buildSpec(tc({ topic: '{{app}}/{{domain}}/{{region}}' }), scopeFor(tc(), undefined, vars))
    expect(spec.topic).toBe('shop/orders/eu')
    expect(buildSpec(tc({ topic: '{{region}}' }), scopeFor(tc(), broker, vars)).topic).toBe('from-broker')
    const own = tc({ topic: '{{region}}', variables: [{ name: 'region', value: 'mine' }] })
    expect(buildSpec(own, scopeFor(own, broker, vars)).topic).toBe('mine')
  })

  it('knows the broker it sends to', () => {
    const t = tc({ topic: 'x/{{broker.name}}', payload: '{"vpn":"{{broker.msgVpn}}"}' })
    expect(buildSpec(t, scopeFor(t, broker, vars))).toMatchObject({ topic: 'x/dev', payload: '{"vpn":"vpn1"}' })
  })

  it('applies the defaults of a test case', () => {
    const t = tc({ payload: '{"a":1}', userProperties: [{ name: 'n', value: '5' }] })
    expect(buildSpec(t, scopeFor(t, broker, vars))).toEqual({
      topic: 'shop/orders',
      payload: '{"a":1}',
      contentType: 'application/json',
      deliveryMode: 'PERSISTENT',
      timeToLiveMs: 0,
      dmqEligible: undefined,
      priority: undefined,
      correlationId: undefined,
      ackTimeoutMs: 5000,
      userProperties: [{ name: 'n', type: 'INT', value: '5' }]
    })
  })

  it('uses one {{uuid}} for topic, payload and correlation ID', () => {
    const t = tc({ topic: 'o/{{uuid}}', payload: '{"id":"{{uuid}}"}', correlationId: '{{uuid}}' })
    const spec = buildSpec(t, scopeFor(t, broker, vars))
    expect(spec.topic).toBe(`o/${JSON.parse(spec.payload!).id}`)
    expect(spec.correlationId).toBe(JSON.parse(spec.payload!).id)
  })

  it.each([
    [{ topic: '{{nope}}' }, /Unknown variable\(s\): nope/],
    [{ topic: '{{empty}}' }, /Topic is empty/],
    [{ topic: 'orders/>' }, /Wildcards are not allowed/],
    [{ payload: '{"n": {{app}}}' }, /JSON/]
  ])('refuses %j', (extra, message) => {
    const scope = { ...scopeFor(tc(), broker, vars), global: { ...vars.global, empty: '' } }
    expect(() => buildSpec(tc(extra), scope)).toThrow(TemplateError)
    expect(() => buildSpec(tc(extra), scope)).toThrow(message)
  })
})
