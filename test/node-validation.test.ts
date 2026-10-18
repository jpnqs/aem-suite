import cds from '@sap/cds'
import path from 'node:path'
import { collectProblems, NodeData, validateEnums, validateNode } from '../srv/lib/testcases/node-validation'

// Field rules without a server - enums and lengths come from db/schema.cds.

const problemsOf = (d: Partial<NodeData>, event = 'CREATE') =>
  collectProblems((reject) => {
    validateEnums(d as NodeData, reject)
    validateNode(d as NodeData, event, reject)
  })
/** a valid test case with the given fields */
const testCase = (extra: Partial<NodeData> = {}): Partial<NodeData> => ({ kind: 'TEST', topic: 'a/b', ...extra })

describe('node validation', () => {
  const before = cds.model
  beforeAll(async () => {
    cds.model = cds.linked(await cds.load(path.join(__dirname, '..', 'db')))
  })
  afterAll(() => {
    cds.model = before
  })

  it('collects readable problems, with an optional position', async () => {
    const problems = await collectProblems((reject) => {
      reject(400, 'is wrong', 'in/userProperties(0)/name')
      reject(400, 'no target')
    }, 'Orders / created')
    expect(problems).toEqual(['Orders / created: userProperties(0)/name: is wrong', 'Orders / created: no target'])
  })

  it('accepts a minimal test case and fills name, content type and property types', async () => {
    const d = testCase({ payload: '{"n": {{count}}}', userProperties: [{ name: 'n', value: '42' }, { name: 'b', value: 'true' }, { name: 's', value: 'x' }] })
    expect(await problemsOf(d)).toEqual([])
    expect(d).toMatchObject({ name: 'a/b', contentType: 'application/json' })
    expect(d.userProperties!.map((p) => p.type)).toEqual(['INT', 'BOOL', 'STRING'])
  })

  it('requires a topic for test cases and a name for folders', async () => {
    expect(await problemsOf({ kind: 'TEST', topic: '  ' })).toEqual(['topic: Topic is required'])
    expect(await problemsOf({ kind: 'FOLDER' })).toEqual(['name: Folder name is required'])
    // an update that does not touch the name keeps it
    expect(await problemsOf({ kind: 'FOLDER' }, 'UPDATE')).toEqual([])
  })

  it.each([
    [{ payload: '{oops' }, /^payload: Payload is not valid JSON/],
    [{ ackTimeoutMs: 50 }, /^ackTimeoutMs: ACK timeout must be between 100 and 120000 ms$/],
    [{ priority: 256 }, /^priority: Priority must be between 0 and 255$/],
    [{ deliveryMode: 'FAST' as never }, /^deliveryMode: deliveryMode must be PERSISTENT or DIRECT$/],
    [{ userProperties: [{ name: 'n', type: 'NUMBER' as never, value: '1' }] }, /^userProperties\(0\)\/type: type must be STRING, INT, BOOL$/],
    [{ userProperties: [{ name: 'n', type: 'INT' as const, value: 'abc' }] }, /^userProperties\(0\)\/value: User property "n" must be an integer/],
    [{ variables: [{ name: '1bad', value: 'x' }] }, /^variables\(0\)\/name: Invalid variable name "1bad"$/],
    [{ topic: 'x'.repeat(501) }, /^topic: topic is too long \(501 characters, maximum 500\)$/]
  ])('rejects %j', async (extra, message) => {
    const problems = await problemsOf(testCase(extra))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(message)
  })

  it('accepts plain text payloads and templated property values', async () => {
    expect(await problemsOf(testCase({ payload: 'not json', contentType: 'text/plain' }))).toEqual([])
    expect(await problemsOf(testCase({ userProperties: [{ name: 'n', type: 'INT', value: '{{qty}}' }] }))).toEqual([])
  })

  it('reports duplicates', async () => {
    const problems = await problemsOf(
      testCase({
        userProperties: [{ name: 'p', value: '1' }, { name: 'p', value: '2' }],
        variables: [{ name: 'v', value: '1' }, { name: 'v', value: '2' }]
      })
    )
    expect(problems).toEqual(['userProperties(1)/name: Duplicate user property "p"', 'variables(1)/name: Duplicate variable "v"'])
  })
})
