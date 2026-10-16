import cds from '@sap/cds'
import { listSubscriptions } from './lib/solace/subscription-hub'
import { runOutcome } from './lib/test-runner'

const DAY_MS = 24 * 60 * 60 * 1000
const RECENT_DAYS = 7
const LAST_RUNS = 5

type RunRow = { ID: string; summary: string | null; startedAt: string | null; createdBy: string | null; status: string; totalCount: number; passedCount: number; failedCount: number }

const count = async (entity: string, where?: Record<string, unknown>): Promise<number> => {
  const query = SELECT.one.from(entity).columns('count(1) as n')
  const row = (await (where ? query.where(where) : query)) as { n: number } | undefined
  return Number(row?.n ?? 0)
}

export default class HomeService extends cds.ApplicationService {
  async init() {
    this.on('overview', async (req) => {
      const user = req.user.id
      const tester = req.user.is('Tester')
      const admin = req.user.is('Admin')
      // without a role of the suite there is nothing to show but the help
      if (!tester) return { user, tester, admin, lastRuns: [] }

      const since = new Date(Date.now() - RECENT_DAYS * DAY_MS).toISOString()
      const [testCases, folders, myTestCases, savedMessages, recent, lastRuns, brokers] = await Promise.all([
        count('aem.suite.TestCases', { kind: 'TEST' }),
        count('aem.suite.TestCases', { kind: 'FOLDER' }),
        count('aem.suite.TestCases', { kind: 'TEST', createdBy: user }),
        count('aem.suite.ReceivedMessages'),
        (async () => (await SELECT.from('aem.suite.TestRuns').columns('status', 'passedCount', 'failedCount').where({ startedAt: { '>=': since } })) as RunRow[])(),
        (async () =>
          (await SELECT.from('aem.suite.TestRuns')
            .columns('ID', 'summary', 'startedAt', 'createdBy', 'status', 'totalCount', 'passedCount', 'failedCount')
            .orderBy('startedAt desc')
            .limit(LAST_RUNS)) as RunRow[])(),
        (async () =>
          (await SELECT.from('aem.suite.Brokers').columns('name', 'lastConnectionStatus').where({ active: true }).orderBy('name')) as {
            name: string
            lastConnectionStatus: string | null
          }[])()
      ])

      const resultsPassed = recent.reduce((s, r) => s + (r.passedCount ?? 0), 0)
      const resultsFailed = recent.reduce((s, r) => s + (r.failedCount ?? 0), 0)
      const finished = resultsPassed + resultsFailed
      return {
        user,
        tester,
        admin,
        testCases,
        folders,
        myTestCases,
        runsLast7Days: recent.length,
        runningRuns: await count('aem.suite.TestRuns', { status: 'RUNNING' }),
        resultsPassed,
        resultsFailed,
        passRate: finished ? Math.round((resultsPassed / finished) * 100) : null,
        lastRuns: lastRuns.map((r) => ({
          ID: r.ID,
          summary: r.summary,
          startedAt: r.startedAt,
          startedBy: r.createdBy,
          outcome: runOutcome(r),
          totalCount: r.totalCount,
          passedCount: r.passedCount,
          failedCount: r.failedCount
        })),
        brokers: brokers.length,
        brokersOk: brokers.filter((b) => b.lastConnectionStatus === 'OK').length,
        brokersFailing: brokers.filter((b) => b.lastConnectionStatus === 'ERROR').length,
        brokersUntested: brokers.filter((b) => !b.lastConnectionStatus).length,
        failingBrokers: brokers.filter((b) => b.lastConnectionStatus === 'ERROR').map((b) => b.name),
        savedMessages,
        liveSubscriptions: listSubscriptions(user).length
      }
    })
    return super.init()
  }
}
