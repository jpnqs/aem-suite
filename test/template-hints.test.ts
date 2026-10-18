import cds from '@sap/cds'
import { fakerMethods } from '../srv/lib/template/fake-data'
import { resetDatabase, startServer, users } from './helpers'

const { POST } = startServer()
const { tester } = users

const hintsOf = async (id: string, active = true) => {
  const res = await POST(`/odata/v4/test/TestCases(ID=${id},IsActiveEntity=${active})/TestService.templateHints`, {}, tester)
  expect(res.status).toBe(200)
  return res.data.value as { expression: string; kind: string; source: string; value: string | null; details: string | null }[]
}

describe('template hints (suggestions of the payload editor)', () => {
  const ids = { outer: cds.utils.uuid(), inner: cds.utils.uuid(), test: cds.utils.uuid(), dev: cds.utils.uuid(), prod: cds.utils.uuid(), off: cds.utils.uuid() }

  beforeAll(async () => {
    await resetDatabase()
    const broker = (ID: string, name: string, active = true) => ({ ID, name, credentialMode: 'DIRECT', url: 'wss://x:443', msgVpn: 'v', active })
    await INSERT.into('aem.suite.Brokers').entries([broker(ids.dev, 'dev'), broker(ids.prod, 'prod'), broker(ids.off, 'old', false)])
    await INSERT.into('aem.suite.Variables').entries([
      { ID: cds.utils.uuid(), name: 'app', value: 'shop' },
      { ID: cds.utils.uuid(), name: 'region', value: 'eu' },
      { ID: cds.utils.uuid(), name: 'domain', value: 'global' },
      { ID: cds.utils.uuid(), broker_ID: ids.dev, name: 'region', value: 'dev-eu' },
      { ID: cds.utils.uuid(), broker_ID: ids.prod, name: 'region', value: 'prod-eu' },
      { ID: cds.utils.uuid(), broker_ID: ids.dev, name: 'onlyDev', value: 'd' },
      { ID: cds.utils.uuid(), broker_ID: ids.off, name: 'inactive', value: 'x' }
    ])
    await INSERT.into('aem.suite.TestCases').entries([
      { ID: ids.outer, kind: 'FOLDER', name: 'Orders', variables: [{ name: 'domain', value: 'orders' }] },
      { ID: ids.inner, kind: 'FOLDER', name: 'EU', parent_ID: ids.outer, variables: [{ name: 'domain', value: 'orders-eu' }] },
      { ID: ids.test, kind: 'TEST', name: 'created', topic: 't', parent_ID: ids.inner, variables: [{ name: 'app', value: 'mine' }] }
    ])
    await INSERT.into('aem.suite.NumberRanges').entries({ ID: cds.utils.uuid(), name: 'ORDERS', description: 'Sales orders', prefix: 'SO-', length: 4, start: '1', step: 1 })
  })

  it('lists the variables with the value that wins and all definitions in lookup order', async () => {
    const vars = (await hintsOf(ids.test)).filter((h) => h.kind === 'VARIABLE')
    expect(vars.map((h) => h.expression)).toEqual(['app', 'domain', 'onlyDev', 'region'])
    const [app, domain, onlyDev, region] = vars
    // the test case variable wins over the global one
    expect(app).toMatchObject({ source: 'Test case', value: 'mine', details: 'Test case: mine\nGlobal: shop' })
    // the inner folder wins over the outer folder and the global variable
    expect(domain).toMatchObject({ source: 'Folder "EU"', value: 'orders-eu', details: 'Folder "EU": orders-eu\nFolder "Orders": orders\nGlobal: global' })
    expect(onlyDev).toMatchObject({ source: 'Broker "dev"', value: 'd' })
    // broker variables win over the global one, per broker
    expect(region).toMatchObject({ source: 'Depends on the broker', value: null, details: 'Broker "dev": dev-eu\nBroker "prod": prod-eu\nGlobal: eu' })
  })

  it('lists the number ranges with their next number and the faker expressions', async () => {
    const hints = await hintsOf(ids.test)
    expect(hints.find((h) => h.kind === 'NUMBER_RANGE')).toEqual({ expression: 'numberRange.ORDERS', kind: 'NUMBER_RANGE', source: 'Number range', value: 'SO-0001', details: 'Sales orders' })
    const faker = hints.filter((h) => h.kind === 'FAKER')
    expect(faker.length).toBe(fakerMethods().length)
    expect(faker.find((h) => h.expression === 'faker.person.fullName')?.value).toEqual(expect.any(String))
  })

  it('uses the variables being edited in a draft', async () => {
    const { data: created } = await POST('/odata/v4/test/TestCases', { kind: 'TEST', topic: 'draft', parent_ID: ids.outer, variables: [{ name: 'fresh', value: 'new' }] }, tester)
    const vars = (await hintsOf(created.ID, false)).filter((h) => h.kind === 'VARIABLE')
    expect(vars.find((h) => h.expression === 'fresh')).toMatchObject({ source: 'Test case', value: 'new' })
    // only the folders above the draft
    expect(vars.find((h) => h.expression === 'domain')).toMatchObject({ source: 'Folder "Orders"', value: 'orders' })
  })
})

describe('faker expressions for the suggestions', () => {
  it('lists the methods of the data modules with short examples, no deprecated ones', () => {
    const methods = fakerMethods()
    const names = methods.map((m) => m.expression)
    expect(names).toEqual(expect.arrayContaining(['faker.person.fullName', 'faker.internet.email', 'faker.number.int']))
    expect(names).not.toContain('faker.internet.userName') // deprecated in favour of username
    expect(names.every((n) => /^faker\.[a-z]+\.[A-Za-z]+$/.test(n))).toBe(true)
    expect(methods.every((m) => (m.example ?? '').length <= 80)).toBe(true)
    expect(fakerMethods()).toBe(methods) // computed once
  })
})
