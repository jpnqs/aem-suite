import cds from '@sap/cds'
import { createActive, draft, resetDatabase, startServer, users } from './helpers'

const { POST } = startServer()
const { admin, tester } = users
const ADMIN = '/odata/v4/admin'

const exportConfig = (kind: string, ids?: string[]) => POST(`${ADMIN}/exportConfig`, ids ? { kind, ids } : { kind }, admin)
const importConfig = (kind: string, content: unknown, dryRun = false) =>
  POST(`${ADMIN}/importConfig`, { kind, content: typeof content === 'string' ? content : JSON.stringify(content), dryRun }, admin)
const file = (format: string, list: string, entries: unknown[]) => ({ format: `aem-suite.${format}`, version: 1, [list]: entries })
const ranges = (entries: unknown[]) => file('number-ranges', 'numberRanges', entries)
const brokers = (entries: unknown[]) => file('brokers', 'brokers', entries)
const variables = (entries: unknown[]) => file('variables', 'variables', entries)

const range = (name: string) => SELECT.one.from('aem.suite.NumberRanges').where({ name })
const broker = (name: string) => SELECT.one.from('aem.suite.Brokers').where({ name })
const brokerVariables = async (name: string) =>
  ((await SELECT.from('aem.suite.Variables').columns('name', 'value').where({ broker_ID: (await broker(name)).ID })) as { name: string; value: string }[]).sort((a, b) =>
    a.name.localeCompare(b.name)
  )

describe('export / import of the configuration', () => {
  beforeEach(resetDatabase)

  describe('number ranges', () => {
    it('exports the definition sorted by name, without IDs and counter', async () => {
      await INSERT.into('aem.suite.NumberRanges').entries([
        { ID: cds.utils.uuid(), name: 'ORDERS', description: 'Sales orders', prefix: 'SO-', length: 10, start: '4500000001', step: 1, current: '4500000042' },
        { ID: cds.utils.uuid(), name: 'DELIVERIES', length: 8, start: '1', step: 2, maximum: '99999999' }
      ])
      const res = await exportConfig('NUMBER_RANGES')
      expect(res.status).toBe(200)
      expect(res.data).toMatchObject({ count: 2 })
      expect(res.data.filename).toMatch(/^aem-suite-number-ranges-\d{4}-\d{2}-\d{2}\.json$/)
      const content = JSON.parse(res.data.content)
      expect(content).toMatchObject({ format: 'aem-suite.number-ranges', version: 1 })
      expect(content.numberRanges).toEqual([
        { name: 'DELIVERIES', length: 8, start: 1, step: 2, maximum: 99999999 },
        { name: 'ORDERS', description: 'Sales orders', prefix: 'SO-', length: 10, start: 4500000001, step: 1 }
      ])
      expect(res.data.content).not.toMatch(/"ID"|current|lastUsedAt|createdBy/)
    })

    it('exports a selection, named after a single entry', async () => {
      const ID = cds.utils.uuid()
      await INSERT.into('aem.suite.NumberRanges').entries([
        { ID, name: 'ORDERS', start: '1' },
        { ID: cds.utils.uuid(), name: 'OTHER', start: '1' }
      ])
      const res = await exportConfig('NUMBER_RANGES', [ID])
      expect(res.data).toMatchObject({ count: 1, filename: 'aem-suite-number-ranges-orders.json' })
      expect(JSON.parse(res.data.content).numberRanges.map((r: { name: string }) => r.name)).toEqual(['ORDERS'])
      expect((await exportConfig('NUMBER_RANGES', [cds.utils.uuid()])).status).toBe(404)
    })

    it('creates new ranges and updates existing ones by name - the counter stays', async () => {
      await INSERT.into('aem.suite.NumberRanges').entries({ ID: cds.utils.uuid(), name: 'ORDERS', prefix: 'SO-', length: 10, start: '4500000001', step: 1, current: '4500000042' })
      const content = ranges([
        { name: 'orders', prefix: 'PO-', start: 4500000001 },
        { name: 'INVOICES', prefix: 'INV-', length: 6, start: 1 }
      ])

      const check = await importConfig('NUMBER_RANGES', content, true)
      expect(check.data).toMatchObject({ dryRun: true, created: 1, updated: 1 })
      expect(await range('INVOICES')).toBeUndefined()

      const res = await importConfig('NUMBER_RANGES', content)
      expect(res.data).toMatchObject({ dryRun: false, created: 1, updated: 1 })
      // the name as in the file, untouched fields and the counter kept
      expect(await range('orders')).toMatchObject({ prefix: 'PO-', length: 10, current: '4500000042' })
      expect(await range('INVOICES')).toMatchObject({ prefix: 'INV-', length: 6, start: '1', current: null })
    })

    it('a file exported in one system imports into another', async () => {
      await INSERT.into('aem.suite.NumberRanges').entries({ ID: cds.utils.uuid(), name: 'ORDERS', prefix: 'SO-', length: 10, start: '4500000001', step: 1 })
      const { content } = (await exportConfig('NUMBER_RANGES')).data
      await resetDatabase()
      expect((await importConfig('NUMBER_RANGES', content)).data).toMatchObject({ created: 1, updated: 0 })
      expect(await range('ORDERS')).toMatchObject({ prefix: 'SO-', length: 10, start: '4500000001', step: 1 })
    })

    it('checks the rules of the app and imports nothing if anything is wrong', async () => {
      const res = await importConfig(
        'NUMBER_RANGES',
        ranges([
          { name: 'GOOD', start: 1 },
          { name: '1BAD', start: 1 },
          { name: 'STEP', step: 0 },
          { name: 'MAX', start: 10, maximum: 5 },
          { name: 'TYPE', length: 'ten' },
          { name: 'good' },
          { name: 'LONG', prefix: 'x'.repeat(21) }
        ])
      )
      expect(res.status).toBe(400)
      const message = res.data.error.message as string
      expect(message).toMatch(/^Nothing was imported/)
      expect(message).toContain('number range "1BAD": name: The name must start with a letter')
      expect(message).toContain('number range "STEP": step: The step must be at least 1')
      expect(message).toContain('number range "MAX": maximum: The maximum must not be below the start')
      expect(message).toContain('number range "TYPE": length: must be a whole number')
      expect(message).toContain('number range "good": the name is in the file more than once')
      expect(message).toContain('number range "LONG": prefix: at most 20 characters')
      expect(await range('GOOD')).toBeUndefined()
    })

    it('does not change a range that is being edited', async () => {
      const orders = await createActive(POST, 'admin', 'NumberRanges', { name: 'ORDERS', start: 1 }, admin)
      await draft.edit(POST, 'admin', 'NumberRanges', orders.ID, admin)
      const res = await importConfig('NUMBER_RANGES', ranges([{ name: 'ORDERS', prefix: 'X-' }]))
      expect(res.status).toBe(400)
      expect(res.data.error.message).toContain('number range "ORDERS": is being edited in the app')
    })
  })

  describe('brokers', () => {
    const dev = { name: 'aem-dev', credentialMode: 'DIRECT', url: 'dev.messaging.solace.cloud', msgVpn: 'dev', username: 'tester', connectTimeoutMs: 5000 }

    it('exports the connection settings and variables, no status', async () => {
      const ID = cds.utils.uuid()
      await INSERT.into('aem.suite.Brokers').entries({
        ID,
        ...dev,
        url: 'wss://dev.messaging.solace.cloud:443',
        active: true,
        agentAllowed: false,
        lastConnectionStatus: 'OK',
        lastConnectionMessage: 'fine',
        variables: [
          { ID: cds.utils.uuid(), name: 'region', value: 'eu' },
          { ID: cds.utils.uuid(), name: 'env', value: 'dev' }
        ]
      })
      const res = await exportConfig('BROKERS')
      expect(res.status).toBe(200)
      const [entry] = JSON.parse(res.data.content).brokers
      expect(entry).toEqual({
        name: 'aem-dev',
        credentialMode: 'DIRECT',
        url: 'wss://dev.messaging.solace.cloud:443',
        msgVpn: 'dev',
        username: 'tester',
        clientNamePrefix: 'aem-suite',
        connectTimeoutMs: 5000,
        active: true,
        agentAllowed: false,
        variables: [
          { name: 'env', value: 'dev' },
          { name: 'region', value: 'eu' }
        ]
      })
      expect(res.data.content).not.toMatch(/"ID"|lastConnection|password/)
    })

    it('creates brokers with variables and merges the variables of existing ones', async () => {
      await INSERT.into('aem.suite.Brokers').entries({
        ID: cds.utils.uuid(),
        ...dev,
        url: 'wss://dev.messaging.solace.cloud:443',
        variables: [
          { ID: cds.utils.uuid(), name: 'region', value: 'eu' },
          { ID: cds.utils.uuid(), name: 'keep', value: 'me' }
        ]
      })
      const res = await importConfig(
        'BROKERS',
        brokers([
          { name: 'AEM-DEV', msgVpn: 'dev2', variables: [{ name: 'region', value: 'us' }, { name: 'tier', value: 2 }] },
          { name: 'aem-prod', credentialMode: 'DESTINATION', destinationName: 'AEM_PROD', variables: [{ name: 'env', value: 'prod' }] }
        ])
      )
      expect(res.data).toMatchObject({ created: 1, updated: 1 })
      expect(await broker('AEM-DEV')).toMatchObject({ msgVpn: 'dev2', username: 'tester' })
      expect(await brokerVariables('AEM-DEV')).toEqual([
        { name: 'keep', value: 'me' },
        { name: 'region', value: 'us' },
        { name: 'tier', value: '2' }
      ])
      expect(await broker('aem-prod')).toMatchObject({ credentialMode: 'DESTINATION', destinationName: 'AEM_PROD', active: true })
      expect(await brokerVariables('aem-prod')).toEqual([{ name: 'env', value: 'prod' }])
    })

    it('completes URLs like the app', async () => {
      await importConfig('BROKERS', brokers([dev]))
      expect((await broker('aem-dev')).url).toBe('wss://dev.messaging.solace.cloud:443')
    })

    it('checks the rules of the app', async () => {
      await INSERT.into('aem.suite.Brokers').entries([
        { ID: cds.utils.uuid(), ...dev, name: 'twice' },
        { ID: cds.utils.uuid(), ...dev, name: 'Twice' }
      ])
      const res = await importConfig(
        'BROKERS',
        brokers([
          { name: 'no-vpn', credentialMode: 'DIRECT', url: 'x.example' },
          { name: 'no-destination', credentialMode: 'DESTINATION' },
          { name: 'mode', credentialMode: 'SMOKE', url: 'x.example', msgVpn: 'v' },
          { ...dev, name: 'timeout', connectTimeoutMs: 5 },
          { ...dev, name: 'vars', variables: [{ name: 'a' }, { name: 'a' }] },
          { ...dev, name: 'var-name', variables: [{ name: 'bad name' }] },
          { name: 'twice', msgVpn: 'x' },
          { credentialMode: 'DIRECT' }
        ])
      )
      expect(res.status).toBe(400)
      const message = res.data.error.message as string
      expect(message).toContain('broker "no-vpn": msgVpn: Message VPN is required')
      expect(message).toContain('broker "no-destination": destinationName: Destination name is required')
      expect(message).toContain('broker "mode": credentialMode: must be one of DESTINATION, DIRECT')
      expect(message).toContain('broker "timeout": connectTimeoutMs: must be between 1000 and 120000')
      expect(message).toContain('broker "vars": variable "a" is in the file more than once')
      expect(message).toContain('broker "var-name": variables(0)/name: Invalid variable name "bad name"')
      expect(message).toContain('broker "twice": 2 brokers with this name exist')
      expect(message).toContain('broker #8: needs a name')
    })
  })

  describe('global variables', () => {
    it('exports only the global ones and imports by name', async () => {
      const brokerId = cds.utils.uuid()
      await INSERT.into('aem.suite.Brokers').entries({ ID: brokerId, name: 'b', credentialMode: 'DIRECT', url: 'wss://x:443', msgVpn: 'v' })
      await INSERT.into('aem.suite.Variables').entries([
        { ID: cds.utils.uuid(), name: 'region', value: 'eu' },
        { ID: cds.utils.uuid(), name: 'app', value: 'aem' },
        { ID: cds.utils.uuid(), broker_ID: brokerId, name: 'secretish', value: 'broker only' }
      ])
      const res = await exportConfig('VARIABLES')
      expect(JSON.parse(res.data.content).variables).toEqual([
        { name: 'app', value: 'aem' },
        { name: 'region', value: 'eu' }
      ])

      const imported = await importConfig('VARIABLES', variables([{ name: 'REGION', value: 'us' }, { name: 'tenant', value: 'acme' }]))
      expect(imported.data).toMatchObject({ created: 1, updated: 1 })
      const rows = await SELECT.from('aem.suite.Variables').columns('name', 'value', 'broker_ID').orderBy('name')
      expect(rows).toEqual([
        { name: 'REGION', value: 'us', broker_ID: null },
        { name: 'app', value: 'aem', broker_ID: null },
        { name: 'secretish', value: 'broker only', broker_ID: brokerId },
        { name: 'tenant', value: 'acme', broker_ID: null }
      ])
    })

    it('rejects invalid names', async () => {
      const res = await importConfig('VARIABLES', variables([{ name: 'no spaces', value: 'x' }]))
      expect(res.status).toBe(400)
      expect(res.data.error.message).toContain('global variable "no spaces": name: Variable names must start with a letter')
    })
  })

  describe('the file', () => {
    it.each([
      ['not JSON', '{', /not valid JSON/],
      ['another format', { format: 'aem-suite.test-cases', version: 1, nodes: [] }, /not an AEM Test Suite export of number ranges/],
      ['another kind', variables([{ name: 'a' }]), /this file holds global variables, not number ranges/],
      ['a newer version', { ...ranges([{ name: 'A' }]), version: 2 }, /format version 2/],
      ['no entries', ranges([]), /contains no number ranges/]
    ])('rejects %s', async (_label, content, message) => {
      const res = await importConfig('NUMBER_RANGES', content)
      expect(res.status).toBe(400)
      expect(res.data.error.message).toMatch(message)
    })

    it('rejects an unknown kind', async () => {
      expect((await exportConfig('TEST_CASES')).status).toBe(400)
    })

    it('is for admins only', async () => {
      const res = await POST(`${ADMIN}/exportConfig`, { kind: 'BROKERS' }, tester)
      expect(res.status).toBe(403)
    })
  })
})
