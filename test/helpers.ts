import cds from '@sap/cds'
import path from 'node:path'
import type { AemSuiteConfig } from '../srv/lib/config'
import { setConnector } from '../srv/lib/solace/connector'
import type { PublishSpec } from '../srv/lib/solace/session'

/** The mocked users (package.json, profiles development and test). */
export const users = {
  admin: { auth: { username: 'admin', password: 'admin' } },
  tester: { auth: { username: 'tester', password: 'tester' } },
  /** logged in, but without any role */
  noRole: { auth: { username: 'norole', password: 'norole' } }
}

/** Starts the CAP server for this test file. HTTP errors are returned as responses, not thrown. */
export function startServer() {
  const server = cds.test(path.join(__dirname, '..'))
  beforeAll(() => {
    server.axios.defaults.validateStatus = () => true
  })
  return server
}

type Post = ReturnType<typeof cds.test>['POST']

/** Creates an entity through the draft flow (create + draftActivate) and returns the active entity. */
export async function createActive(POST: Post, service: 'admin' | 'test', entity: string, data: object, auth: object = users.tester) {
  const { data: draft } = await POST(`/odata/v4/${service}/${entity}`, data, auth)
  const res = await POST(`/odata/v4/${service}/${entity}(ID=${draft.ID},IsActiveEntity=false)/${service === 'admin' ? 'AdminService' : 'TestService'}.draftActivate`, {}, auth)
  if (res.status >= 300) throw new Error(`${res.status} ${JSON.stringify(res.data)}`)
  return res.data
}

/**
 * Replaces the broker connection for the enclosing describe: records every connection and publish, fails to
 * connect to a broker named "unreachable" and rejects topics that contain "reject".
 */
export function fakeBroker(latencyMs = 1) {
  const broker = {
    published: [] as { broker: string; spec: PublishSpec }[],
    /** broker name -> user name of the last connection */
    connectedAs: {} as Record<string, string>,
    /** broker name -> password of the last connection */
    connectedWith: {} as Record<string, string>
  }
  beforeAll(() =>
    setConnector(async (conn) => {
      broker.connectedAs[conn.brokerName] = conn.userName
      broker.connectedWith[conn.brokerName] = conn.password
      if (conn.brokerName === 'unreachable') throw new Error('Connect failed: Unauthorized')
      return {
        publish: async (spec) => {
          broker.published.push({ broker: conn.brokerName, spec })
          if (spec.topic.includes('reject')) throw new Error('Rejected by broker: no subscribers')
          return { latencyMs }
        },
        close: async () => undefined
      }
    })
  )
  afterAll(() => setConnector())
  return broker
}

/** Children before parents, so no foreign key complains. */
const TABLES = [
  'RunResults',
  'TestRuns',
  'TestCaseStats',
  'TestCaseProperties',
  'TestCaseVariables',
  'TestCases',
  'Variables',
  'ReceivedMessages',
  'SubscriberPresets',
  'Brokers'
]

/** Empties all tables - test/data holds demo rows for local development, which every cds.test server deploys. */
export async function resetDatabase(): Promise<void> {
  for (const t of TABLES) await DELETE.from(`aem.suite.${t}`)
}

type ConfigPatch = { [K in keyof AemSuiteConfig]?: AemSuiteConfig[K] extends object ? Partial<AemSuiteConfig[K]> : AemSuiteConfig[K] }

/** Runs fn with `cds.env.aemSuite` patched (merged per section) and restores the previous settings afterwards. */
export async function withAemSuiteConfig<T>(patch: ConfigPatch, fn: () => Promise<T>): Promise<T> {
  const env = cds.env as { aemSuite?: Record<string, unknown> }
  const before = env.aemSuite
  const merged: Record<string, unknown> = { ...before }
  for (const [k, v] of Object.entries(patch))
    merged[k] = v && typeof v === 'object' ? { ...(before?.[k] as object | undefined), ...v } : v
  env.aemSuite = merged
  try {
    return await fn()
  } finally {
    if (before === undefined) delete env.aemSuite
    else env.aemSuite = before
  }
}
