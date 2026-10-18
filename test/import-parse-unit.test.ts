import cds from '@sap/cds'
import path from 'node:path'
import { importNodes } from '../srv/lib/testcases/export-import'

// Reading an import file (srv/lib/testcases/export-import.ts) without a server: a dry run with nodes at the top level only
// needs the model (column lengths, enums). The HTTP side is in export-import.test.ts.

const dryRun = (content: unknown) => importNodes(typeof content === 'string' ? content : JSON.stringify(content), { dryRun: true })
const file = (nodes: unknown[], extra: object = {}) => ({ format: 'aem-suite.test-cases', version: 1, nodes, ...extra })

describe('import file (parsing and checks)', () => {
  const before = cds.model
  beforeAll(async () => {
    cds.model = cds.linked(await cds.load(path.join(__dirname, '..', 'db')))
  })
  afterAll(() => {
    cds.model = before
  })

  it.each([
    ['not JSON', '{oops', /not valid JSON/],
    ['another format', { format: 'other', version: 1, nodes: [{}] }, /not an AEM Test Suite export/],
    ['a newer version', file([{ topic: 'a' }], { version: 2 }), /format version 2, this system understands up to 1/],
    ['no nodes', file([]), /contains no test cases or folders/]
  ])('rejects %s as a whole', async (_case, content, message) => {
    await expect(dryRun(content)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(message) })
  })

  it('counts what a valid file would create and names the top-level nodes', async () => {
    const result = await dryRun(
      file([
        { name: 'Orders', variables: [{ name: 'domain', value: 'orders' }], children: [{ topic: 'o/a', userProperties: [{ name: 'n', value: 1 }] }, { topic: 'o/b' }] },
        { kind: 'TEST', topic: 'ping' }
      ])
    )
    expect(result).toMatchObject({ dryRun: true, folders: 1, testCases: 3, userProperties: 1, variables: 1, target: null })
    expect(result.roots).toEqual([
      { ID: undefined, name: 'Orders', kind: 'FOLDER' },
      { ID: undefined, name: 'ping', kind: 'TEST' }
    ])
  })

  it('reports structure and type problems with their position, without follow-up noise', async () => {
    const problems = async (nodes: unknown[]) => {
      const e = await dryRun(file(nodes)).catch((err: Error) => err)
      return String((e as Error).message)
    }
    expect(await problems(['text'])).toMatch(/#1: not an object/)
    expect(await problems([{ kind: 'OTHER', topic: 'a' }])).toMatch(/a: kind must be FOLDER or TEST/)
    expect(await problems([{ kind: 'TEST', topic: 'a', children: [] }])).toMatch(/a: a test case cannot have children/)
    expect(await problems([{ kind: 'FOLDER', name: 'F', children: 'x' }])).toMatch(/F: children must be a list/)
    expect(await problems([{ topic: 'a', timeToLiveMs: '5' }])).toMatch(/a: timeToLiveMs must be a whole number/)
    expect(await problems([{ topic: 'a', dmqEligible: 'yes' }])).toMatch(/a: dmqEligible must be true or false/)
    expect(await problems([{ topic: 'a', userProperties: {} }])).toMatch(/a: userProperties must be a list/)
    expect(await problems([{ topic: 'a', variables: [{ value: 'x' }] }])).toMatch(/a: variables\[0\] needs a name/)
    // a broken node is not checked by the field rules as well (no "Topic is required" next to the type problem)
    expect(await problems([{ topic: 5 }])).not.toMatch(/Topic is required/)
  })
})
