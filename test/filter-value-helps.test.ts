import cds from '@sap/cds'
import { resetDatabase, startServer, users, waitFor } from './helpers'

const { GET } = startServer()
const ada = { auth: { username: 'ada', password: 'ada' } }

describe('Test Cases filters: names of the users, value helps', () => {
  beforeAll(async () => {
    await resetDatabase()
    await INSERT.into('aem.suite.TestCases').entries([
      { kind: 'TEST', name: 'a', topic: 'a', createdBy: 'ada' },
      { kind: 'TEST', name: 'b', topic: 'b', createdBy: 'ada' },
      { kind: 'TEST', name: 'c', topic: 'c', createdBy: 'tester' },
      { kind: 'FOLDER', name: 'Orders', createdBy: 'tester' },
      { kind: 'TEST', name: 'a', topic: 'a', createdBy: 'tester' }
    ])
  })

  it('keeps the name of a login with given and family name, not of users without one', async () => {
    await GET('/odata/v4/test/TestCases?$top=1', ada)
    await GET('/odata/v4/test/TestCases?$top=1', users.tester)
    await waitFor(async () => (await SELECT.from('aem.suite.Users')).length > 0, 5000, 'the name of ada')
    expect(await SELECT.from('aem.suite.Users')).toEqual([{ ID: 'ada', firstName: 'Ada', lastName: 'Lovelace', name: 'Ada Lovelace' }])
  })

  it('shows the name of the creator, the user id alone where no name is known', async () => {
    const { data } = await GET('/odata/v4/test/TestCases?$select=name,createdBy&$expand=creator($select=name)&$filter=IsActiveEntity eq true&$orderby=name,createdBy', users.tester)
    expect(data.value.map((t: { createdBy: string; creator: { name: string } | null }) => [t.createdBy, t.creator?.name ?? null])).toEqual([
      ['ada', 'Ada Lovelace'],
      ['tester', null],
      ['ada', 'Ada Lovelace'],
      ['tester', null],
      ['tester', null]
    ])
  })

  it('offers each creator once as value help of the filter', async () => {
    const { data } = await GET('/odata/v4/test/Creators?$orderby=ID', users.tester)
    expect(data.value).toEqual([
      { ID: 'ada', name: 'Ada Lovelace' },
      { ID: 'tester', name: null }
    ])
  })

  it('offers each name and topic of the test cases once as value help of the filters', async () => {
    const names = await GET('/odata/v4/test/TestCaseNames?$orderby=name', users.tester)
    expect(names.data.value.map((r: { name: string }) => r.name)).toEqual(['a', 'b', 'c', 'Orders'])
    const topics = await GET('/odata/v4/test/Topics?$orderby=topic', users.tester)
    expect(topics.data.value.map((r: { topic: string }) => r.topic)).toEqual(['a', 'b', 'c'])
  })

  it('flags the test cases of the logged-in user for the quick variant "My Test Cases"', async () => {
    const mine = async (auth: object) => {
      const { data } = await GET('/odata/v4/test/TestCases?$select=name&$filter=IsActiveEntity eq true and createdByMe eq true&$orderby=name', auth)
      return data.value.map((t: { name: string }) => t.name)
    }
    expect(await mine(ada)).toEqual(['a', 'b'])
    expect(await mine(users.tester)).toEqual(['a', 'c', 'Orders'])
  })
})

// after the Test Cases block: the name of ada is kept already
describe('Test Runs filters: names of the users, value helps', () => {
  beforeAll(async () => {
    const [r1, r2] = [cds.utils.uuid(), cds.utils.uuid()]
    await INSERT.into('aem.suite.TestRuns').entries([
      { ID: r1, summary: 'one', status: 'DONE', createdBy: 'ada' },
      { ID: r2, summary: 'two', status: 'DONE', createdBy: 'tester' }
    ])
    await INSERT.into('aem.suite.RunResults').entries([
      { run_ID: r1, testCaseName: 'Order created', brokerName: 'dev', status: 'PASSED', sequence: 1 },
      { run_ID: r1, testCaseName: 'Order created', brokerName: 'qa', status: 'FAILED', sequence: 1 },
      { run_ID: r2, testCaseName: 'Ping', brokerName: 'dev', status: 'PASSED', sequence: 1 }
    ])
  })

  it('shows the name of the user that started the run', async () => {
    const { data } = await GET('/odata/v4/test/RunResults?$select=testCaseName,brokerName,runStartedBy,runStartedByName&$orderby=testCaseName,brokerName', users.tester)
    expect(data.value.map((r: Record<string, string | null>) => [r.testCaseName, r.brokerName, r.runStartedBy, r.runStartedByName])).toEqual([
      ['Order created', 'dev', 'ada', 'Ada Lovelace'],
      ['Order created', 'qa', 'ada', 'Ada Lovelace'],
      ['Ping', 'dev', 'tester', null]
    ])
    const run = await GET('/odata/v4/test/TestRuns?$select=summary&$expand=creator($select=name)&$filter=summary eq \'one\'', users.tester)
    expect(run.data.value[0].creator).toMatchObject({ name: 'Ada Lovelace' })
  })

  it('offers each starter, test case and broker of the results once as value help', async () => {
    const values = async (path: string, key: string) => (await GET(`/odata/v4/test/${path}?$orderby=${key}`, users.tester)).data.value
    expect(await values('RunStarters', 'ID')).toEqual([
      { ID: 'ada', name: 'Ada Lovelace' },
      { ID: 'tester', name: null }
    ])
    expect((await values('ResultTestCaseNames', 'testCaseName')).map((r: { testCaseName: string }) => r.testCaseName)).toEqual(['Order created', 'Ping'])
    expect((await values('ResultBrokerNames', 'brokerName')).map((r: { brokerName: string }) => r.brokerName)).toEqual(['dev', 'qa'])
  })

  it('offers the result statuses as fixed values', async () => {
    const { data } = await GET('/odata/v4/test/ResultStatuses?$select=code,name&$orderby=code', users.tester)
    expect(data.value.map((s: { code: string }) => s.code)).toEqual(['ERROR', 'FAILED', 'PASSED', 'PENDING', 'SKIPPED'])
  })
})
