import { allFakers } from '@faker-js/faker'
import { createActive, resetDatabase, startServer, users, withAemSuiteConfig } from './helpers'

const { POST } = startServer()
const { tester } = users

describe('faker test data in previews and runs', () => {
  beforeAll(resetDatabase)

  const preview = async (data: object) => {
    const tc = await createActive(POST, 'test', 'TestCases', { deliveryMode: 'PERSISTENT', ...data })
    return (await POST(`/odata/v4/test/TestCases(ID=${tc.ID},IsActiveEntity=true)/TestService.preview`, {}, tester)).data
  }

  it('resolves faker values in topic, payload, correlation ID and properties - one value per expression', async () => {
    const p = await preview({
      name: 'faker',
      topic: 'customers/{{faker.string.uuid as id}}',
      payload: '{"id":"{{id}}","name":"{{faker.person.fullName as name}}","again":"{{name}}","email":"{{faker.internet.email}}","age":{{faker.number.int(18,65)}},"mail2":"{{faker.internet.email}}"}',
      correlationId: '{{id}}',
      userProperties: [{ name: 'customer', type: 'STRING', value: '{{name}}' }]
    })
    expect(p.valid).toBe(true)
    const payload = JSON.parse(p.payload)
    expect(p.topic).toBe(`customers/${payload.id}`)
    expect(p.correlationId).toBe(payload.id)
    expect(payload.again).toBe(payload.name)
    expect(JSON.parse(p.userProperties).customer).toBe(payload.name)
    expect(payload.mail2).toBe(payload.email)
    expect(payload.age).toBeGreaterThanOrEqual(18)
    expect(payload.age).toBeLessThanOrEqual(65)
  })

  it('gives new values for every message', async () => {
    const tc = await createActive(POST, 'test', 'TestCases', { name: 'again', topic: 'x/{{faker.string.uuid}}', payload: '{}', deliveryMode: 'PERSISTENT' })
    const url = `/odata/v4/test/TestCases(ID=${tc.ID},IsActiveEntity=true)/TestService.preview`
    const a = (await POST(url, {}, tester)).data.topic
    const b = (await POST(url, {}, tester)).data.topic
    expect(a).not.toBe(b)
  })

  it('reports an unknown expression', async () => {
    const p = await preview({ name: 'bad', topic: 'x/{{faker.nothing.here}}', payload: '{}' })
    expect(p.valid).toBe(false)
    expect(p.message).toMatch(/Unknown faker expression/)
  })

  it('uses the language of the setting', async () => {
    const p = await withAemSuiteConfig({ faker: { locale: 'de' } }, () => preview({ name: 'de', topic: 'x/{{faker.location.country}}', payload: '{}' }))
    expect(p.valid).toBe(true)
    // a country name of the German list (e.g. "Deutschland", "Frankreich")
    expect(allFakers.de.definitions.location?.country).toContain(p.topic.slice(2))
  })
})
