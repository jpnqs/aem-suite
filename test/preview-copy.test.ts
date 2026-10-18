import cds from '@sap/cds'
import { copyNodes } from '../srv/lib/testcases/copy-nodes'
import { buildPreview } from '../srv/lib/runs/preview'
import type { TestCaseRecord } from '../srv/lib/runs/test-case-spec'
import { resetDatabase, startServer } from './helpers'

// srv/lib/runs/preview.ts and srv/lib/testcases/copy-nodes.ts called directly (the services use them through
// TestService.preview / duplicate / copyNodes and the agent's previewTestCase / copyNodes).

startServer()

describe('buildPreview', () => {
  const broker = { ID: cds.utils.uuid() }
  const tc = (extra: Partial<TestCaseRecord> = {}): TestCaseRecord => ({ ID: cds.utils.uuid(), kind: 'TEST', name: 'p', topic: 'a/{{region}}', payload: '{"a":1}', ...extra })

  beforeAll(async () => {
    await resetDatabase()
    await INSERT.into('aem.suite.Brokers').entries({ ID: broker.ID, name: 'dev', credentialMode: 'DIRECT', url: 'wss://d:443', msgVpn: 'vpn', username: 'u' })
    await INSERT.into('aem.suite.Variables').entries([
      { name: 'region', value: 'global' },
      { broker_ID: broker.ID, name: 'region', value: 'eu' }
    ])
  })

  it('resolves for a broker (its variables win), pretty-prints JSON and lists the properties', async () => {
    const p = await buildPreview(tc({ userProperties: [{ name: 'by', value: '{{broker.name}}' }] }), broker.ID)
    expect(p).toMatchObject({ valid: true, message: 'Resolved for broker dev', topic: 'a/eu', payload: '{\n  "a": 1\n}' })
    expect(JSON.parse(p.userProperties!)).toEqual({ by: 'dev' })
  })

  it('resolves with the global variables only without a broker, and leaves text payloads as they are', async () => {
    const p = await buildPreview(tc({ payload: 'plain {{region}}', contentType: 'text/plain' }))
    expect(p).toMatchObject({ valid: true, message: 'Resolved with global variables only', topic: 'a/global', payload: 'plain global' })
  })

  it('never throws: an unknown broker or variable is reported in the result', async () => {
    expect(await buildPreview(tc(), cds.utils.uuid())).toMatchObject({ valid: false, message: expect.stringMatching(/^Broker .* not found$/) })
    expect(await buildPreview(tc({ topic: 'a/{{nope}}' }))).toEqual({ valid: false, message: 'Unknown variable(s): nope' })
  })
})

describe('copyNodes', () => {
  const ids = { folder: cds.utils.uuid(), inner: cds.utils.uuid(), test: cds.utils.uuid(), after: cds.utils.uuid() }

  beforeAll(async () => {
    await resetDatabase()
    await INSERT.into('aem.suite.TestCases').entries([
      { ID: ids.folder, kind: 'FOLDER', name: 'F'.repeat(199), sortOrder: 10 },
      { ID: ids.after, kind: 'FOLDER', name: 'After', sortOrder: 20 },
      { ID: ids.inner, kind: 'TEST', name: 'inner', topic: 'f/inner', parent_ID: ids.folder, sortOrder: 10 },
      { ID: ids.test, kind: 'TEST', name: 'top', topic: 'top', sortOrder: 30 }
    ])
    await INSERT.into('aem.suite.TestCaseProperties').entries({ testCase_ID: ids.inner, name: 'p', value: '1' })
    await INSERT.into('aem.suite.TestCaseVariables').entries({ testCase_ID: ids.folder, name: 'v', value: '1' })
  })

  it('refuses an empty selection and unknown nodes', async () => {
    await expect(copyNodes([])).rejects.toMatchObject({ status: 400 })
    await expect(copyNodes([cds.utils.uuid()])).rejects.toMatchObject({ status: 404 })
  })

  it('copies a folder with everything below it once, even when its content is selected too', async () => {
    const copies = await copyNodes([ids.folder, ids.inner])
    expect(copies).toHaveLength(1)
    // "<name> (Copy)" is cut to the column (200 characters)
    expect(copies[0].name).toBe(`${'F'.repeat(199)} `)
    const inner = await SELECT.one.from('aem.suite.TestCases').where({ parent_ID: copies[0].ID })
    expect(inner).toMatchObject({ name: 'inner', topic: 'f/inner' })
    expect(await SELECT.from('aem.suite.TestCaseProperties').where({ testCase_ID: inner.ID })).toEqual([expect.objectContaining({ name: 'p', value: '1' })])
    expect(await SELECT.from('aem.suite.TestCaseVariables').where({ testCase_ID: copies[0].ID })).toEqual([expect.objectContaining({ name: 'v' })])
  })

  it('places a copy right after its original (siblings renumbered 10, 20, 30 ...)', async () => {
    const [copy] = await copyNodes([ids.test])
    expect(copy.name).toBe('top (Copy)')
    const top = (await SELECT.from('aem.suite.TestCases').columns('ID', 'kind', 'sortOrder').where({ parent_ID: null }).orderBy('sortOrder')) as { ID: string; kind: string; sortOrder: number }[]
    const tests = top.filter((t) => t.kind === 'TEST').map((t) => t.ID)
    expect(tests.indexOf(copy.ID)).toBe(tests.indexOf(ids.test) + 1)
    expect(top.every((t, i) => t.sortOrder === (i + 1) * 10)).toBe(true)
  })
})
