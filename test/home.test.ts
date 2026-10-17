import cds from '@sap/cds'
import { resetDatabase, startServer, users } from './helpers'

const { GET } = startServer()
const overview = async (auth?: object) => {
  const res = await GET('/odata/v4/home/overview()', auth)
  return { status: res.status, data: res.data as Record<string, any> }
}

describe('home (start page)', () => {
  const day = 24 * 60 * 60 * 1000
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

  beforeAll(async () => {
    await resetDatabase()
    const folder = cds.utils.uuid()
    await INSERT.into('aem.suite.TestCases').entries([
      { ID: folder, kind: 'FOLDER', name: 'Orders' },
      { kind: 'TEST', name: 'a', topic: 'a', parent_ID: folder, createdBy: 'tester' },
      { kind: 'TEST', name: 'b', topic: 'b', createdBy: 'admin' }
    ])
    await INSERT.into('aem.suite.Brokers').entries([
      { name: 'ok', credentialMode: 'DIRECT', active: true, lastConnectionStatus: 'OK' },
      { name: 'failing', credentialMode: 'DIRECT', active: true, lastConnectionStatus: 'ERROR' },
      { name: 'new', credentialMode: 'DIRECT', active: true },
      { name: 'off', credentialMode: 'DIRECT', active: false, lastConnectionStatus: 'ERROR' }
    ])
    await INSERT.into('aem.suite.TestRuns').entries([
      { summary: 'old', startedAt: ago(30 * day), status: 'DONE', totalCount: 9, passedCount: 0, failedCount: 9, createdBy: 'tester' },
      { summary: 'yesterday', startedAt: ago(day), status: 'DONE', totalCount: 4, passedCount: 3, failedCount: 1, createdBy: 'tester' },
      { summary: 'stopped', startedAt: ago(2 * day), status: 'STOPPED', totalCount: 5, passedCount: 2, failedCount: 0, skippedCount: 3, createdBy: 'tester' },
      { summary: 'now', startedAt: ago(1000), status: 'RUNNING', totalCount: 2, passedCount: 1, failedCount: 0, createdBy: 'admin' }
    ])
    await INSERT.into('aem.suite.ReceivedMessages').entries({ topic: 't', payload: 'x' })
  })

  it('gives testers the figures of the suite', async () => {
    const { status, data } = await overview(users.tester)
    expect(status).toBe(200)
    expect(data).toMatchObject({
      user: 'tester',
      tester: true,
      admin: false,
      testCases: 2,
      folders: 1,
      myTestCases: 1,
      runsLast7Days: 3,
      runningRuns: 1,
      resultsPassed: 6,
      resultsFailed: 1,
      passRate: 86,
      brokers: 3,
      brokersOk: 1,
      brokersFailing: 1,
      brokersUntested: 1,
      failingBrokers: ['failing'],
      savedMessages: 1,
      liveSubscriptions: 0
    })
    // newest first, with the outcome the Test Runs app shows
    expect(data.lastRuns.map((r: { summary: string; outcome: string }) => `${r.summary}:${r.outcome}`)).toEqual(['now:RUNNING', 'yesterday:FAILED', 'stopped:STOPPED', 'old:FAILED'])
    expect(data.lastRuns[0]).toMatchObject({ startedBy: 'admin', totalCount: 2 })
  })

  it('tells admins apart', async () => {
    expect((await overview(users.admin)).data).toMatchObject({ user: 'admin', tester: true, admin: true })
  })

  it('shows users without a role nothing but who they are', async () => {
    const { status, data } = await overview(users.noRole)
    expect(status).toBe(200)
    expect(data).toMatchObject({ user: 'norole', tester: false, admin: false, lastRuns: [] })
    expect([data.testCases, data.brokers, data.savedMessages].map((v) => v ?? null)).toEqual([null, null, null])
  })

  it('needs a login', async () => {
    expect((await overview()).status).toBe(401)
  })
})
