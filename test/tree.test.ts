import cds from '@sap/cds'
import { waitForRun } from '../srv/lib/test-runner'
import { Tree } from '../srv/lib/tree'
import { createActive, fakeBroker, resetDatabase, startServer, users } from './helpers'

const { GET, POST, PATCH, axios } = startServer()
const { tester } = users
const TREE = "com.sap.vocabularies.Hierarchy.v1.TopLevels(HierarchyNodes=$root/TestCases,HierarchyQualifier='TestTree',NodeProperty='ID',Levels=9)"

const create = async (data: object) => (await createActive(POST, 'test', 'TestCases', data)) as { ID: string; sortOrder: number }

async function treeRows(): Promise<{ ID: string; name: string; DistanceFromRoot: number; DrillState: string }[]> {
  const res = await GET(
    `/odata/v4/test/TestCases?$apply=${encodeURIComponent(TREE)}&$select=ID,name,kind,DistanceFromRoot,DrillState,LimitedDescendantCount&$orderby=kind,sortOrder,name`,
    tester
  )
  if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(res.data)}`)
  return res.data.value
}

const outline = (rows: { name: string; DistanceFromRoot: number }[]) => rows.map((r) => '  '.repeat(r.DistanceFromRoot) + r.name)

describe('test case tree (folders)', () => {
  type Node = { ID: string; sortOrder: number }
  let orders: Node, eu: Node, created: Node, cancelled: Node, ping: Node
  const broker = { ID: cds.utils.uuid() }
  const fake = fakeBroker()

  beforeAll(async () => {
    await resetDatabase()
    await INSERT.into('aem.suite.Brokers').entries({ ID: broker.ID, name: 'b', credentialMode: 'DIRECT', url: 'wss://b:443', msgVpn: 'v', username: 'u', active: true })
  })

  // every test starts from the same tree: Orders / EU / (created, cancelled), and ping at top level
  beforeEach(async () => {
    for (const e of ['RunResults', 'TestRuns', 'TestCaseStats', 'TestCaseProperties', 'TestCaseVariables', 'TestCases']) await DELETE.from(`aem.suite.${e}`)
    fake.published.length = 0
    orders = await create({ kind: 'FOLDER', name: 'Orders', variables: [{ name: 'domain', value: 'orders' }] })
    eu = await create({ kind: 'FOLDER', name: 'EU', parent_ID: orders.ID, variables: [{ name: 'region', value: 'eu' }] })
    created = await create({ topic: '{{domain}}/{{region}}/created', parent_ID: eu.ID })
    cancelled = await create({ topic: '{{domain}}/{{region}}/cancelled', parent_ID: eu.ID })
    ping = await create({ topic: 'ping' })
  })

  it('builds folders with test cases and returns them as a tree', async () => {
    expect(cancelled.sortOrder).toBeGreaterThan(created.sortOrder)

    expect(outline(await treeRows())).toEqual([
      'Orders',
      '  EU',
      '    {{domain}}/{{region}}/created',
      '    {{domain}}/{{region}}/cancelled',
      'ping'
    ])
  })

  it('rejects invalid structures', async () => {
    const { data: d1 } = await POST('/odata/v4/test/TestCases', { topic: 'x', parent_ID: ping.ID }, tester)
    let res = await POST(`/odata/v4/test/TestCases(ID=${d1.ID},IsActiveEntity=false)/TestService.draftActivate`, {}, tester)
    expect(res.status).toBe(400)
    expect(res.data.error.message).toBe('Test cases can only be placed in folders')

    const { data: d2 } = await POST('/odata/v4/test/TestCases', { kind: 'FOLDER' }, tester)
    expect(d2.payload ?? null).toBeNull() // no starter template for folders
    res = await POST(`/odata/v4/test/TestCases(ID=${d2.ID},IsActiveEntity=false)/TestService.draftActivate`, {}, tester)
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.data)).toMatch(/Folder name is required/)
  })

  it('moves a node to another folder (drag & drop onto a folder)', async () => {
    const res = await PATCH(
      `/odata/v4/test/TestCases(ID=${ping.ID},IsActiveEntity=true)`,
      { 'parent@odata.bind': `TestCases(ID=${orders.ID},IsActiveEntity=true)` },
      tester
    )
    expect(res.status).toBeLessThan(300)
    const row = await SELECT.one.from('aem.suite.TestCases', ping.ID)
    expect(row.parent_ID).toBe(orders.ID)

    // a folder cannot be moved below itself
    const cycle = await PATCH(
      `/odata/v4/test/TestCases(ID=${orders.ID},IsActiveEntity=true)`,
      { 'parent@odata.bind': `TestCases(ID=${eu.ID},IsActiveEntity=true)` },
      tester
    )
    expect(cycle.status).toBe(400)
  })

  it('reorders siblings (drag & drop between nodes)', async () => {
    const res = await POST(
      `/odata/v4/test/TestCases(ID=${cancelled.ID},IsActiveEntity=true)/TestService.moveBefore`,
      { NextSibling: { ID: created.ID, IsActiveEntity: true } },
      tester
    )
    expect(res.status).toBeLessThan(300)
    expect(outline(await treeRows())).toEqual([
      'Orders',
      '  EU',
      '    {{domain}}/{{region}}/cancelled',
      '    {{domain}}/{{region}}/created',
      'ping'
    ])
    // move to the end
    await POST(`/odata/v4/test/TestCases(ID=${cancelled.ID},IsActiveEntity=true)/TestService.moveBefore`, { NextSibling: null }, tester)
    const names = outline(await treeRows()).map((n) => n.trim())
    expect(names.indexOf('{{domain}}/{{region}}/created')).toBeLessThan(names.indexOf('{{domain}}/{{region}}/cancelled'))
  })

  it('handles parent change and ordering sent together (as on drop)', async () => {
    // move ping from the top level into EU before "created" - the action is read before the PATCH lands
    await POST(
      `/odata/v4/test/TestCases(ID=${ping.ID},IsActiveEntity=true)/TestService.moveBefore`,
      { NextSibling: { ID: created.ID, IsActiveEntity: true } },
      tester
    )
    await PATCH(
      `/odata/v4/test/TestCases(ID=${ping.ID},IsActiveEntity=true)`,
      { 'parent@odata.bind': `TestCases(ID=${eu.ID},IsActiveEntity=true)` },
      tester
    )
    expect(outline(await treeRows())).toEqual([
      'Orders',
      '  EU',
      '    ping',
      '    {{domain}}/{{region}}/created',
      '    {{domain}}/{{region}}/cancelled'
    ])
    // back to Orders, at the end
    await POST(`/odata/v4/test/TestCases(ID=${ping.ID},IsActiveEntity=true)/TestService.moveBefore`, { NextSibling: null }, tester)
    await PATCH(
      `/odata/v4/test/TestCases(ID=${ping.ID},IsActiveEntity=true)`,
      { 'parent@odata.bind': `TestCases(ID=${orders.ID},IsActiveEntity=true)` },
      tester
    )
    expect(outline(await treeRows()).at(-1)).toBe('  ping')
  })

  it('runs a whole folder with folder variables', async () => {
    await UPDATE('aem.suite.TestCases', ping.ID).with({ parent_ID: orders.ID })
    const res = await POST(
      '/odata/v4/test/runTests',
      { testCaseIds: [orders.ID], brokerIds: [broker.ID], credentials: [{ brokerId: broker.ID, password: 'p' }] },
      tester
    )
    expect(res.status).toBe(200)
    await waitForRun(res.data.runId)
    // tree order: EU folder first (created, cancelled), then ping
    expect(fake.published.map((p) => p.spec.topic)).toEqual(['orders/eu/created', 'orders/eu/cancelled', 'ping'])
    const { data: run } = await GET(`/odata/v4/test/TestRuns(${res.data.runId})`, tester)
    expect(run).toMatchObject({ totalCount: 3, passedCount: 3 })
  })

  it('refuses to run an empty folder', async () => {
    const empty = await create({ kind: 'FOLDER', name: 'Empty' })
    const res = await POST(
      '/odata/v4/test/runTests',
      { testCaseIds: [empty.ID], brokerIds: [broker.ID], credentials: [{ brokerId: broker.ID, password: 'p' }] },
      tester
    )
    expect(res.status).toBe(400)
    expect(res.data.error.message).toBe('The selected folders contain no test cases')
  })

  it('previews with folder variables for drafts inside a folder', async () => {
    const { data: draft } = await POST('/odata/v4/test/TestCases', { topic: '{{domain}}/{{region}}/x', parent_ID: eu.ID }, tester)
    const { data } = await POST(
      `/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=false)/TestService.preview`,
      {},
      tester
    )
    expect(data).toMatchObject({ valid: true, topic: 'orders/eu/x' })
  })

  it('copies a folder with everything below it, right after the original', async () => {
    const res = await POST('/odata/v4/test/copyNodes', { ids: [orders.ID] }, tester)
    expect(res.status).toBe(200)
    expect(res.data.value).toHaveLength(1)
    const copy = res.data.value[0] as { ID: string; name: string }
    expect(copy.name).toBe('Orders (Copy)')
    expect(copy.ID).not.toBe(orders.ID)

    // placed directly behind the original
    const rootNames = (await treeRows()).filter((r) => r.DistanceFromRoot === 0).map((r) => r.name)
    expect(rootNames.indexOf('Orders (Copy)')).toBe(rootNames.indexOf('Orders') + 1)

    // same structure below the copy, with new IDs
    const all = (await SELECT.from('aem.suite.TestCases').columns('ID', 'parent_ID', 'name', 'kind')) as {
      ID: string
      parent_ID: string | null
      name: string
      kind: string
    }[]
    const below = (parent: string) => all.filter((n) => n.parent_ID === parent)
    const copyEu = below(copy.ID).find((n) => n.name === 'EU')!
    expect(copyEu.ID).not.toBe(eu.ID)
    expect(below(copyEu.ID).map((n) => n.name).sort()).toEqual(['{{domain}}/{{region}}/cancelled', '{{domain}}/{{region}}/created'])
    expect(below(copy.ID).map((n) => n.name)).toEqual(['EU'])

    // folder variables are copied, the original is untouched
    const vars = (id: string) => SELECT.from('aem.suite.TestCaseVariables').where({ testCase_ID: id })
    expect(await vars(copy.ID)).toMatchObject([{ name: 'domain', value: 'orders' }])
    expect(await vars(copyEu.ID)).toMatchObject([{ name: 'region', value: 'eu' }])
    expect(below(orders.ID).map((n) => n.name)).toContain('EU')
    expect(below(eu.ID)).toHaveLength(2)
  })

  it('copies a node below a selected folder only together with that folder', async () => {
    const res = await POST('/odata/v4/test/copyNodes', { ids: [created.ID, orders.ID, eu.ID] }, tester)
    expect(res.status).toBe(200)
    expect(res.data.value.map((c: { name: string }) => c.name)).toEqual(['Orders (Copy)'])
  })

  it('copies single test cases next to the original and rejects unknown nodes', async () => {
    const { data } = await POST('/odata/v4/test/copyNodes', { ids: [created.ID] }, tester)
    expect(data.value[0].name).toBe('{{domain}}/{{region}}/created (Copy)')
    const siblings = (await SELECT.from('aem.suite.TestCases').columns('ID', 'sortOrder').where({ parent_ID: eu.ID })) as {
      ID: string
      sortOrder: number
    }[]
    const order = (id: string) => siblings.find((s) => s.ID === id)!.sortOrder
    expect(order(data.value[0].ID)).toBeGreaterThan(order(created.ID))
    expect(order(data.value[0].ID)).toBeLessThan(order(cancelled.ID))

    const missing = await POST('/odata/v4/test/copyNodes', { ids: [cds.utils.uuid()] }, tester)
    expect(missing.status).toBe(404)
    const none = await POST('/odata/v4/test/copyNodes', { ids: [] }, tester)
    expect(none.status).toBe(400)
  })

  it('deletes a folder including its content', async () => {
    const res = await axios.delete(`/odata/v4/test/TestCases(ID=${orders.ID},IsActiveEntity=true)`, tester)
    expect(res.status).toBe(204)
    expect(await SELECT.from('aem.suite.TestCases').where({ ID: { in: [eu.ID, created.ID, cancelled.ID] } })).toHaveLength(0)
    expect(await SELECT.one.from('aem.suite.TestCases', ping.ID)).toBeTruthy() // not inside the folder
  })
})

describe('Tree helper', () => {
  const t = new Tree([
    { ID: 'f1', parent_ID: null, kind: 'FOLDER', name: 'A', sortOrder: 20 },
    { ID: 't1', parent_ID: null, kind: 'TEST', name: 'root test', sortOrder: 10 },
    { ID: 'f2', parent_ID: 'f1', kind: 'FOLDER', name: 'B', sortOrder: 10 },
    { ID: 't2', parent_ID: 'f2', kind: 'TEST', name: 'x', sortOrder: 20 },
    { ID: 't3', parent_ID: 'f2', kind: 'TEST', name: 'y', sortOrder: 10 },
    { ID: 't4', parent_ID: 'f1', kind: 'TEST', name: 'z', sortOrder: 5 }
  ])

  it('expands folders in tree order (folders first, then manual order)', () => {
    expect(t.expandToTests(['f1'])).toEqual(['t3', 't2', 't4'])
    expect(t.expandToTests(['t1', 'f2', 't3'])).toEqual(['t1', 't3', 't2'])
  })

  it('knows ancestors and containment', () => {
    expect(t.ancestors('t2').map((n) => n.ID)).toEqual(['f1', 'f2'])
    expect(t.isWithin('t2', 'f1')).toBe(true)
    expect(t.isWithin('f1', 'f2')).toBe(false)
  })
})

describe('folder variables on the object page', () => {
  it('can be maintained on a folder that has no delivery mode (draft edit + save)', async () => {
    const folder = await create({ kind: 'FOLDER', name: 'VarFolder' })
    // folders created before the field was optional have no delivery mode
    await UPDATE('aem.suite.TestCases').set({ deliveryMode: null }).where({ ID: folder.ID })
    const base = `/odata/v4/test/TestCases(ID=${folder.ID},IsActiveEntity=true)`
    const edit = await POST(`${base}/TestService.draftEdit`, { PreserveChanges: true }, tester)
    expect(edit.status).toBeLessThan(300)
    const draft = `/odata/v4/test/TestCases(ID=${folder.ID},IsActiveEntity=false)`
    const add = await POST(`${draft}/variables`, { name: 'domain', value: 'orders' }, tester)
    expect(add.status).toBeLessThan(300)
    const save = await POST(`${draft}/TestService.draftActivate`, {}, tester)
    expect(save.status).toBeLessThan(300)
    const vars = await GET(`${base}/variables?$select=name,value`, tester)
    expect(vars.data.value).toEqual([expect.objectContaining({ name: 'domain', value: 'orders' })])
  })
})
