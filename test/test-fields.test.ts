import cds from '@sap/cds'
import path from 'node:path'
import { TECHNICAL_ELEMENTS, TEST_FIELDS } from '../srv/lib/testcases/test-fields'

// lib/testcases/test-fields.ts is the list of test case fields that export, import, the agent and the length checks use.
// A new element of aem.suite.TestCases has to be added there (or be a technical one), and the agent's
// CDS signatures, which cannot be derived from it, have to offer it too.

describe('test case fields (lib/testcases/test-fields.ts)', () => {
  let model: cds.linked.LinkedCSN
  beforeAll(async () => {
    model = cds.linked(await cds.load(path.join(__dirname, '..', 'srv')))
  })

  const elementsOf = (name: string) => Object.keys((model.definitions[name] as unknown as { elements: object }).elements)
  const paramsOf = (name: string) => Object.keys((model.definitions[name] as unknown as { params: object }).params)

  it('cover every element of TestCases that is not technical', () => {
    const elements = elementsOf('aem.suite.TestCases').filter((e) => !e.endsWith('_ID') && !TECHNICAL_ELEMENTS.includes(e))
    expect(elements.sort()).toEqual(Object.keys(TEST_FIELDS).sort())
  })

  it('have the JSON type of their element', () => {
    const types: Record<string, string> = { 'cds.String': 'text', 'cds.LargeString': 'text', 'cds.Integer': 'int', 'cds.Boolean': 'bool' }
    const def = model.definitions['aem.suite.TestCases'] as unknown as { elements: Record<string, { _type?: string; type?: string }> }
    for (const [field, type] of Object.entries(TEST_FIELDS)) {
      const element = def.elements[field] as unknown as { _type?: string; type: string; enum?: object }
      // enum types (deliveryMode) are strings
      const base = element.enum ? 'cds.String' : (element._type ?? element.type)
      expect({ field, type: types[base] ?? base }).toEqual({ field, type })
    }
  })

  it('are offered by the agent service: read in TestNodes, set with createTestCase / updateTestCase', () => {
    const fields = Object.keys(TEST_FIELDS)
    expect(elementsOf('TestAgentService.TestNodes')).toEqual(expect.arrayContaining(fields))
    expect(paramsOf('TestAgentService.createTestCase')).toEqual(expect.arrayContaining(fields))
    expect(paramsOf('TestAgentService.updateTestCase')).toEqual(expect.arrayContaining(fields))
  })
})
