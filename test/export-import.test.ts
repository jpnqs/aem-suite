import cds from '@sap/cds'
import { resetDatabase, startServer, users } from './helpers'

const { POST } = startServer()
const { tester } = users

const exportNodes = (ids?: string[]) => POST('/odata/v4/test/exportNodes', ids ? { ids } : {}, tester)
const importNodes = (content: unknown, extra: object = {}) =>
  POST('/odata/v4/test/importNodes', { content: typeof content === 'string' ? content : JSON.stringify(content), ...extra }, tester)
const doc = (nodes: unknown[], extra: object = {}) => ({ format: 'aem-suite.test-cases', version: 1, nodes, ...extra })
const countNodes = async () => (await SELECT.from('aem.suite.TestCases').columns('count(*) as n'))[0].n as number

describe('export / import of test cases and folders', () => {
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    await resetDatabase()
    const id = (k: string) => (ids[k] = cds.utils.uuid())
    await INSERT.into('aem.suite.TestCases').entries([
      { ID: id('orders'), kind: 'FOLDER', name: 'Orders', description: 'All order events', sortOrder: 10, variables: [{ name: 'domain', value: 'orders' }] },
      { ID: id('eu'), kind: 'FOLDER', name: 'EU', parent_ID: ids.orders, sortOrder: 10, variables: [{ name: 'region', value: 'eu' }] },
      {
        ID: id('created'),
        kind: 'TEST',
        name: 'Order created',
        parent_ID: ids.eu,
        sortOrder: 10,
        topic: '{{domain}}/{{region}}/created/{{uuid}}',
        payload: '{"id":"{{uuid}}","qty":{{randomInt(1,5)}}}',
        contentType: 'application/json',
        deliveryMode: 'PERSISTENT',
        priority: 4,
        ackTimeoutMs: 8000,
        correlationId: '{{uuid}}',
        userProperties: [
          { name: 'source', type: 'STRING', value: 'test' },
          { name: 'qty', type: 'INT', value: '5' }
        ],
        variables: [{ name: 'local', value: 'x' }]
      },
      { ID: id('cancelled'), kind: 'TEST', name: 'Order cancelled', parent_ID: ids.eu, sortOrder: 20, topic: 'orders/eu/cancelled', payload: '{}', deliveryMode: 'DIRECT' },
      { ID: id('ping'), kind: 'TEST', name: 'Ping', sortOrder: 20, topic: 'ping', payload: '{"ping":true}', deliveryMode: 'DIRECT' }
    ])
  })

  describe('export', () => {
    it('exports the whole tree as a nested file without IDs', async () => {
      const res = await exportNodes()
      expect(res.status).toBe(200)
      expect(res.data).toMatchObject({ folders: 2, testCases: 3 })
      expect(res.data.filename).toMatch(/^aem-suite-test-cases-\d{4}-\d{2}-\d{2}\.json$/)

      const file = JSON.parse(res.data.content)
      expect(file).toMatchObject({ format: 'aem-suite.test-cases', version: 1 })
      expect(file.nodes.map((n: any) => n.name)).toEqual(['Orders', 'Ping']) // folders first
      expect(file.nodes[0]).toMatchObject({ kind: 'FOLDER', description: 'All order events', variables: [{ name: 'domain', value: 'orders' }] })
      const eu = file.nodes[0].children[0]
      expect(eu).toMatchObject({ kind: 'FOLDER', name: 'EU', variables: [{ name: 'region', value: 'eu' }] })
      expect(eu.children.map((n: any) => n.name)).toEqual(['Order created', 'Order cancelled']) // manual order
      expect(eu.children[0]).toEqual({
        kind: 'TEST',
        name: 'Order created',
        topic: '{{domain}}/{{region}}/created/{{uuid}}',
        payload: '{"id":"{{uuid}}","qty":{{randomInt(1,5)}}}',
        contentType: 'application/json',
        deliveryMode: 'PERSISTENT',
        priority: 4,
        correlationId: '{{uuid}}',
        ackTimeoutMs: 8000,
        userProperties: [
          { name: 'qty', type: 'INT', value: '5' }, // sorted by name
          { name: 'source', type: 'STRING', value: 'test' }
        ],
        variables: [{ name: 'local', value: 'x' }]
      })
      // portable: no internal IDs, authors or run data
      expect(res.data.content).not.toMatch(/"ID"|parent_ID|createdBy|modifiedAt|sortOrder|lastResult/)
    })

    it('exports a selection: a folder with everything below it, nested selections only once', async () => {
      const res = await exportNodes([ids.created, ids.orders, ids.eu])
      expect(res.data).toMatchObject({ folders: 2, testCases: 2, filename: 'orders.json' })
      expect(JSON.parse(res.data.content).nodes).toHaveLength(1)

      const single = await exportNodes([ids.created])
      expect(single.data.filename).toBe('order-created.json')
      expect(JSON.parse(single.data.content).nodes[0]).toMatchObject({ kind: 'TEST', name: 'Order created' })
    })

    it('rejects unknown nodes', async () => {
      expect((await exportNodes([cds.utils.uuid()])).status).toBe(404)
    })
  })

  describe('import', () => {
    it('checks a file without writing anything (dry run)', async () => {
      const file = (await exportNodes([ids.orders])).data.content
      const before = await countNodes()
      const res = await importNodes(file, { dryRun: true })
      expect(res.status).toBe(200)
      expect(res.data).toMatchObject({ dryRun: true, folders: 2, testCases: 2, userProperties: 2, variables: 3 })
      expect(res.data.roots).toEqual([{ name: 'Orders', kind: 'FOLDER' }])
      expect(await countNodes()).toBe(before)
    })

    it('imports a file as new nodes and keeps everything - a round trip', async () => {
      const file = (await exportNodes([ids.orders])).data
      const before = await countNodes()
      const res = await importNodes(file.content)
      expect(res.status).toBe(200)
      expect(res.data).toMatchObject({ dryRun: false, folders: 2, testCases: 2, target: null })
      expect(await countNodes()).toBe(before + 4)

      // same names and structure, new IDs, original untouched
      const newRoot = res.data.roots[0]
      expect(newRoot.ID).toBeTruthy()
      expect(newRoot.ID).not.toBe(ids.orders)
      const again = await exportNodes([newRoot.ID])
      expect(JSON.parse(again.data.content).nodes).toEqual(JSON.parse(file.content).nodes)
      expect(JSON.parse((await exportNodes([ids.orders])).data.content).nodes).toEqual(JSON.parse(file.content).nodes) // original untouched

      // placed behind the existing top-level nodes
      const top = await SELECT.from('aem.suite.TestCases').columns('ID', 'name', 'sortOrder').where({ parent_ID: null })
      const imported = top.find((t: { ID: string }) => t.ID === newRoot.ID)
      for (const t of top) if (t.ID !== newRoot.ID) expect(imported.sortOrder).toBeGreaterThan(t.sortOrder)
    })

    it('imports into a folder', async () => {
      const file = JSON.stringify(doc([{ kind: 'TEST', name: 'Imported', topic: 'imported/x', payload: '{}' }]))
      const res = await importNodes(file, { parentId: ids.eu })
      expect(res.status).toBe(200)
      expect(res.data.target).toBe('EU')
      const row = await SELECT.one.from('aem.suite.TestCases').where({ ID: res.data.roots[0].ID })
      expect(row.parent_ID).toBe(ids.eu)
      expect(row.sortOrder).toBeGreaterThan(20)
    })

    it('does not import into a test case or an unknown folder', async () => {
      const file = JSON.stringify(doc([{ kind: 'TEST', topic: 'x', payload: '{}' }]))
      expect((await importNodes(file, { parentId: ids.ping })).data.error.message).toMatch(/target folder: Test cases can only be placed in folders/)
      expect((await importNodes(file, { parentId: cds.utils.uuid() })).data.error.message).toMatch(/target folder: Parent folder not found/)
    })

    it('accepts a hand-written file: kind from structure, payload as object, numbers as property values', async () => {
      const res = await importNodes(
        doc([
          {
            name: 'Handmade',
            children: [
              {
                topic: 'hand/made',
                payload: { hello: 'world' },
                userProperties: [{ name: 'qty', value: 5 }, { name: 'flag', type: 'BOOL', value: true }]
              }
            ]
          }
        ])
      )
      expect(res.status).toBe(200)
      expect(res.data).toMatchObject({ folders: 1, testCases: 1 })
      const back = JSON.parse((await exportNodes([res.data.roots[0].ID])).data.content).nodes[0]
      expect(back.children[0]).toMatchObject({
        kind: 'TEST',
        name: 'hand/made', // name follows the topic
        contentType: 'application/json',
        deliveryMode: 'PERSISTENT',
        userProperties: [
          { name: 'flag', type: 'BOOL', value: 'true' },
          { name: 'qty', type: 'INT', value: '5' }
        ]
      })
      expect(JSON.parse(back.children[0].payload)).toEqual({ hello: 'world' })
    })

    it('accepts files larger than the default request limit of 100 kb', async () => {
      const big = 'x'.repeat(300_000)
      const res = await importNodes(doc([{ kind: 'TEST', name: 'Big', topic: 'big', payload: JSON.stringify({ big }) }]))
      expect(res.status).toBe(200)
      const row = await SELECT.one.from('aem.suite.TestCases').columns('payload').where({ ID: res.data.roots[0].ID })
      expect(row.payload.length).toBeGreaterThan(300_000)
    })
  })

  describe('import validation: all or nothing', () => {
    const rejected = async (content: unknown, extra: object = {}) => {
      const before = await countNodes()
      const res = await importNodes(content, extra)
      expect(res.status).toBe(400)
      expect(res.data.error.message).toMatch(/^Nothing was imported: /)
      expect(await countNodes()).toBe(before)
      return res.data.error.message as string
    }

    it('rejects files that are no export', async () => {
      expect(await rejected('not json at all')).toMatch(/not valid JSON/)
      expect(await rejected({ foo: 1 })).toMatch(/not an AEM Test Suite export/)
      expect(await rejected(doc([{ kind: 'TEST', topic: 'x' }], { version: 2 }))).toMatch(/format version 2/)
      expect(await rejected(doc([]))).toMatch(/contains no test cases or folders/)
      expect(await rejected(doc([{ kind: 'TEST', topic: 'x' }], { format: 'other' }))).toMatch(/not an AEM Test Suite export/)
    })

    it('reports every problem with the position in the file and imports nothing - not even the valid parts', async () => {
      const message = await rejected(
        doc([
          { kind: 'TEST', name: 'Fine', topic: 'fine/one', payload: '{}' },
          {
            kind: 'FOLDER',
            name: 'Orders',
            children: [
              { kind: 'TEST', name: 'Bad payload', topic: 'a', payload: '{oops' },
              { kind: 'TEST', name: 'Bad mode', topic: 'b', deliveryMode: 'FAST' },
              { kind: 'TEST', name: 'Bad int', topic: 'c', userProperties: [{ name: 'n', type: 'INT', value: 'abc' }] },
              { kind: 'TEST', name: 'Twice', topic: 'd', variables: [{ name: 'v' }, { name: 'v' }] },
              { kind: 'TEST', name: 'No topic' },
              { kind: 'TEST', name: 'x'.repeat(201), topic: 'e' },
              { kind: 'TEST', name: 'Has children', topic: 'f', children: [] },
              { kind: 'FOLDER', name: '' },
              { kind: 'TEST', name: 'Number', topic: 'g', priority: 1.5 }
            ]
          }
        ])
      )
      expect(message).toMatch(/Orders \/ Bad payload: payload: Payload is not valid JSON/)
      expect(message).toMatch(/Orders \/ Bad mode: deliveryMode: deliveryMode must be PERSISTENT or DIRECT/)
      expect(message).toMatch(/Orders \/ Bad int: userProperties\(0\)\/value: User property "n" must be an integer/)
      expect(message).toMatch(/Orders \/ Twice: variables\(1\)\/name: Duplicate variable "v"/)
      expect(message).toMatch(/Orders \/ No topic: topic: Topic is required/)
      expect(message).toMatch(/name: name is too long \(201 characters, maximum 200\)/)
      expect(message).toMatch(/Orders \/ Has children: a test case cannot have children/)
      expect(message).toMatch(/Orders \/ #8: name: Folder name is required/)
      expect(message).toMatch(/Orders \/ Number: priority must be a whole number/)
    })

    it('checks types of fields', async () => {
      const message = await rejected(
        doc([{ kind: 'TEST', name: 5, topic: ['a'], variables: 'x', userProperties: [{ value: 'no name' }], dmqEligible: 'yes' }, 'text', { kind: 'THING' }])
      )
      expect(message).toMatch(/name must be text/)
      expect(message).toMatch(/topic must be text/)
      expect(message).toMatch(/variables must be a list/)
      expect(message).toMatch(/userProperties\[0\] needs a name/)
      expect(message).toMatch(/dmqEligible must be true or false/)
      expect(message).toMatch(/not an object/)
      expect(message).toMatch(/kind must be FOLDER or TEST/)
    })

    it('limits the nesting and the number of problems shown', async () => {
      let deep: any = { kind: 'TEST', topic: 'deep' }
      for (let i = 0; i < 25; i++) deep = { kind: 'FOLDER', name: `f${i}`, children: [deep] }
      expect(await rejected(doc([deep]))).toMatch(/nested deeper than 20 levels/)

      const many = Array.from({ length: 30 }, (_, i) => ({ kind: 'TEST', name: `t${i}`, payload: '{' }))
      const message = await rejected(doc(many))
      expect(message).toMatch(/topic: Topic is required/)
      expect(message).toMatch(/\(and \d+ more\)$/)
    })
  })
})
