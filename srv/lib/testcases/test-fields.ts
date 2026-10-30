/**
 * The fields of a test case that users set (UI, AI agent, import file), with the JSON type a file or an agent
 * gives them, in the order of the export file. The one list for export, import, the agent and the length checks:
 * test/nodes.test.ts fails when an element of aem.suite.TestCases is neither here nor a technical one.
 */
export const TEST_FIELDS = {
  name: 'text',
  description: 'text',
  topic: 'text',
  payload: 'text',
  contentType: 'text',
  deliveryMode: 'text',
  timeToLiveMs: 'int',
  dmqEligible: 'bool',
  priority: 'int',
  correlationId: 'text',
  ackTimeoutMs: 'int',
  expectMode: 'text',
  expectSource: 'text',
  expectTimeoutMs: 'int',
  expectCorrelation: 'bool'
} as const

export type TestField = keyof typeof TEST_FIELDS

/** What a folder has of these fields. */
export const FOLDER_FIELDS: readonly TestField[] = ['name', 'description']

/** Elements of aem.suite.TestCases that are no user input: keys, tree, managed fields, compositions, statistics. */
export const TECHNICAL_ELEMENTS = ['ID', 'kind', 'parent', 'children', 'sortOrder', 'userProperties', 'checks', 'variables', 'lastResult', 'expectModeInfo', 'creator', 'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy']
