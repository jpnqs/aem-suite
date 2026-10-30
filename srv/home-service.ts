import cds from '@sap/cds'
import fs from 'node:fs'
import path from 'node:path'
import { Brokers, ReceivedMessages, TestCases, TestCaseStats, TestRuns } from '#cds-models/aem/suite'
import { metrics } from './lib/core/metrics'
import { listSubscriptions, subscriptionCount } from './lib/solace/subscription-hub'
import { activeRunIds, runOutcome } from './lib/runs/test-runner'

const DAY_MS = 24 * 60 * 60 * 1000
const RECENT_DAYS = 7
const LAST_RUNS = 5

/** count(1) of an entity (the typed query API has no overload for a union of entities, hence the cast) */
const count = async (entity: typeof TestCases | typeof TestRuns | typeof ReceivedMessages | typeof TestCaseStats, where?: Record<string, unknown>): Promise<number> => {
  const query = SELECT.one.from(entity as typeof TestCases).columns('count(1) as n')
  const row = (await (where ? query.where(where) : query)) as { n: number } | undefined
  return Number(row?.n ?? 0)
}

export default class HomeService extends cds.ApplicationService {
  async init() {
    this.on('overview', async (req) => {
      const user = req.user.id
      // the login's first name (XSUAA / IAS token: given_name); mocked and technical users have none
      const firstName = String((req.user.attr as { givenName?: string } | undefined)?.givenName ?? '').trim() || null
      const tester = req.user.is('Tester')
      const admin = req.user.is('Admin')
      // without a role of the suite there is nothing to show but the help
      if (!tester) return { user, firstName, tester, admin, lastRuns: [] }

      const since = new Date(Date.now() - RECENT_DAYS * DAY_MS).toISOString()
      const [testCases, folders, myTestCases, savedMessages, recent, lastRuns, brokers] = await Promise.all([
        count(TestCases, { kind: 'TEST' }),
        count(TestCases, { kind: 'FOLDER' }),
        count(TestCases, { kind: 'TEST', createdBy: user }),
        count(ReceivedMessages),
        SELECT.from(TestRuns).columns('status', 'passedCount', 'failedCount').where({ startedAt: { '>=': since } }),
        SELECT.from(TestRuns)
          .columns('ID', 'summary', 'startedAt', 'createdBy', 'status', 'totalCount', 'passedCount', 'failedCount')
          .orderBy('startedAt desc')
          .limit(LAST_RUNS),
        SELECT.from(Brokers).columns('name', 'lastConnectionStatus').where({ active: true }).orderBy('name')
      ])

      const resultsPassed = recent.reduce((s, r) => s + (r.passedCount ?? 0), 0)
      const resultsFailed = recent.reduce((s, r) => s + (r.failedCount ?? 0), 0)
      const finished = resultsPassed + resultsFailed
      return {
        user,
        firstName,
        tester,
        admin,
        testCases,
        folders,
        myTestCases,
        runsLast7Days: recent.length,
        runningRuns: await count(TestRuns, { status: 'RUNNING' }),
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
        liveSubscriptions: listSubscriptions(user).length,
        flakyTestCases: await count(TestCaseStats, { flaky: true }),
        system: admin ? systemStatus() : null
      }
    })
    return super.init()
  }
}

function systemStatus() {
  const m = metrics()
  return {
    version: appVersion(),
    startedAt: m.startedAt,
    uptimeSeconds: m.uptimeSeconds,
    runsInProgress: activeRunIds().length,
    liveSubscriptions: subscriptionCount(),
    runsStarted: m.runsStarted,
    messagesPassed: m.messagesPassed,
    messagesFailed: m.messagesFailed,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
  }
}

let version: string | null | undefined
/** the version of package.json (deployed: the one next to the server, written by cds build) */
function appVersion(): string | null {
  if (version === undefined) {
    try {
      version = (JSON.parse(fs.readFileSync(path.join(cds.root, 'package.json'), 'utf8')) as { version?: string }).version ?? null
    } catch {
      version = null
    }
  }
  return version
}
