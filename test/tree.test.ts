import cds from '@sap/cds'
import path from 'node:path'
import { setPublisherFactory, waitForRun } from '../srv/lib/test-runner'
import { Tree } from '../srv/lib/tree'

const { GET, POST, PATCH, axios } = cds.test(path.join(__dirname, '..'))
const tester = { auth: { username: 'tester', password: 'tester' } }
const admin = { auth: { username: 'admin', password: 'admin' } }
const TREE = "com.sap.vocabularies.Hierarchy.v1.TopLevels(HierarchyNodes=$root/TestCases,HierarchyQualifier='TestTree',NodeProperty='ID',Levels=9)"

async function create(data: object) {
  const { data: draft } = await POST('/odata/v4/test/TestCases', data, tester)
  const res = await POST(
    `/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=false)/TestService.draftActivate`,
    {},
    tester
  )
  if (res.status >= 300) throw new Error(JSON.stringify(res.data))
  return res.data as { ID: string; sortOrder: number }
}

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
  const published: string[] = []

  beforeAll(async () => {
    for (const e of ['TestCaseProperties', 'TestCaseVariables', 'TestCases', 'Variables', 'Brokers'])
      await DELETE.from(`aem.suite.${e}`)
    axios.defaults.validateStatus = () => true
    setPublisherFactory(async () => ({
      publish: async (spec) => {
        published.push(spec.topic)
        return { latencyMs: 1 }
      },
      close: async () => undefined
    }))
  })
  afterAll(() => setPublisherFactory())

  it('builds folders with test cases and returns them as a tree', async () => {
    orders = await create({ kind: 'FOLDER', name: 'Orders', variables: [{ name: 'domain', value: 'orders' }] })
    eu = await create({ kind: 'FOLDER', name: 'EU', parent_ID: orders.ID, variables: [{ name: 'region', value: 'eu' }] })
    created = await create({ topic: '{{domain}}/{{region}}/created', parent_ID: eu.ID })
    cancelled = await create({ topic: '{{domain}}/{{region}}/cancelled', parent_ID: eu.ID })
    ping = await create({ topic: 'ping' })
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
      '  ping'
    ])
    // move to the end
    await POST(`/odata/v4/test/TestCases(ID=${cancelled.ID},IsActiveEntity=true)/TestService.moveBefore`, { NextSibling: null }, tester)
    const names = outline(await treeRows()).map((n) => n.trim())
    expect(names.indexOf('{{domain}}/{{region}}/created')).toBeLessThan(names.indexOf('{{domain}}/{{region}}/cancelled'))
  })

  it('handles parent change and ordering sent together (as on drop)', async () => {
    // ping currently lives in Orders; move it into EU before "created" - action read before the PATCH lands
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
    const broker = { ID: cds.utils.uuid() }
    await INSERT.into('aem.suite.Brokers').entries({
      ID: broker.ID,
      name: 'b',
      credentialMode: 'DIRECT',
      url: 'wss://b:443',
      msgVpn: 'v',
      username: 'u',
      active: true
    })
    const res = await POST(
      '/odata/v4/test/runTests',
      { testCaseIds: [orders.ID], brokerIds: [broker.ID], credentials: [{ brokerId: broker.ID, password: 'p' }] },
      tester
    )
    expect(res.status).toBe(200)
    await waitForRun(res.data.runId)
    // tree order: EU folder first (created, cancelled), then ping
    expect(published).toEqual(['orders/eu/created', 'orders/eu/cancelled', 'ping'])
    const { data: run } = await GET(`/odata/v4/test/TestRuns(${res.data.runId})`, tester)
    expect(run).toMatchObject({ totalCount: 3, passedCount: 3 })
  })

  it('refuses to run an empty folder', async () => {
    const empty = await create({ kind: 'FOLDER', name: 'Empty' })
    const broker = await SELECT.one.from('aem.suite.Brokers')
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
    void admin
  })

  it('deletes a folder including its content', async () => {
    const res = await axios.delete(`/odata/v4/test/TestCases(ID=${orders.ID},IsActiveEntity=true)`, tester)
    expect(res.status).toBe(204)
    expect(await SELECT.from('aem.suite.TestCases').where({ ID: { in: [eu.ID, created.ID, ping.ID] } })).toHaveLength(0)
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
