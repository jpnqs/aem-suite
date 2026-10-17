import { allFakers } from '@faker-js/faker'
import { generateFake } from '../srv/lib/fake-data'
import { TemplateError, TemplateResolver, fakerKey, numberSlots } from '../srv/lib/template/resolve'
import { createActive, resetDatabase, startServer, users, withAemSuiteConfig } from './helpers'

describe('faker test data (templates)', () => {
  it('generates values of the data modules', () => {
    expect(generateFake('faker.person.fullName', undefined)).toMatch(/\S+ \S+/)
    expect(generateFake('faker.internet.email', undefined)).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/i)
    expect(generateFake('faker.location.city', undefined).length).toBeGreaterThan(1)
    expect(generateFake('faker.string.uuid', undefined)).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('takes plain arguments: numbers, text, true / false', () => {
    for (let i = 0; i < 20; i++) {
      const n = Number(generateFake('faker.number.int', '10, 12'))
      expect(n).toBeGreaterThanOrEqual(10)
      expect(n).toBeLessThanOrEqual(12)
    }
    expect(generateFake('faker.string.numeric', '8')).toMatch(/^[0-9]{8}$/)
    expect(generateFake('faker.string.alpha', '5')).toMatch(/^[A-Za-z]{5}$/)
    expect(generateFake('faker.person.firstName', "'female'").length).toBeGreaterThan(0)
    expect(Number(generateFake('faker.finance.amount', '5,6'))).toBeGreaterThanOrEqual(5)
  })

  it('writes dates as ISO text', () => {
    expect(generateFake('faker.date.past', undefined)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('uses the language of the setting', () => {
    // German city names contain umlauts or end differently - compare the language, not a value
    const names = new Set(Array.from({ length: 30 }, () => generateFake('faker.location.state', undefined, 'de')))
    expect([...names].some((n) => ['Bayern', 'Berlin', 'Hessen', 'Sachsen', 'Hamburg', 'Bremen', 'Saarland', 'Brandenburg', 'Thüringen', 'Schleswig-Holstein', 'Niedersachsen', 'Rheinland-Pfalz', 'Mecklenburg-Vorpommern', 'Sachsen-Anhalt', 'Baden-Württemberg', 'Nordrhein-Westfalen'].includes(n))).toBe(true)
    // unknown language: English
    expect(generateFake('faker.person.fullName', undefined, 'xx')).toMatch(/\S+ \S+/)
  })

  it.each([
    ['faker', 'faker.'],
    ['faker.helpers.arrayElement', 'faker.helpers.arrayElement'],
    ['faker.seed', 'faker.seed'],
    ['faker.person.nope', 'faker.person.nope'],
    ['faker.person', 'faker.person'],
    ['faker.person.fullName.x', 'faker.person.fullName.x'],
    ['faker.constructor.name', 'faker.constructor.name'],
    ['faker.person.constructor', 'faker.person.constructor']
  ])('refuses %s', (_, expr) => {
    expect(() => generateFake(expr, undefined)).toThrow(TemplateError)
  })

  it('explains an argument that does not fit', () => {
    expect(() => generateFake('faker.number.int', '5,1')).toThrow(/failed/)
  })

  it('finds the faker slots of a message: the same expression once, aliases of their own, also in variables', () => {
    const slots = numberSlots(['{{faker.person.fullName}} {{faker.person.fullName}} {{faker.number.int(1, 5)}}', '{{faker.person.fullName as a}} {{a}} {{inner}}'], {
      global: { inner: '{{faker.internet.email}}', unused: '{{faker.company.name}}' }
    })
    expect(slots.map((s) => s.key).sort()).toEqual(['as:a', 'faker.internet.email', 'faker.number.int(1,5)', 'faker.person.fullName'])
    expect(slots.find((s) => s.key === 'as:a')?.faker).toEqual({ name: 'faker.person.fullName', args: undefined })
    expect(fakerKey('faker.number.int', '1,  5')).toBe('faker.number.int(1,5)')
  })

  it('inserts the generated values: the same value for the same expression, an alias for reuse', () => {
    const r = new TemplateResolver({ numbers: { 'faker.person.fullName': 'Ada Lovelace', 'faker.number.int(1,5)': '4', 'as:buyer': 'Grace Hopper' } })
    expect(r.resolve('{{faker.person.fullName}}, {{faker.person.fullName}}, {{faker.number.int(1, 5)}}')).toBe('Ada Lovelace, Ada Lovelace, 4')
    expect(r.resolve('{{buyer}} / {{faker.person.fullName as buyer}} / {{buyer}}')).toBe('Grace Hopper / Grace Hopper / Grace Hopper')
    expect(() => new TemplateResolver().resolve('{{faker.person.fullName}}')).toThrow(/Unknown variable/)
  })
})

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
