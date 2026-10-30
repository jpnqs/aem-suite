import cds from '@sap/cds'
import path from 'node:path'
import type { AemSuiteConfig } from '../srv/lib/core/config'
import { setConnector } from '../srv/lib/solace/connector'
import type { PublishSpec } from '../srv/lib/solace/session'
import { waitForRun } from '../srv/lib/runs/test-runner'

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
type Service = 'admin' | 'test'

const draftUrl = (service: Service, entity: string, id: string, active: boolean) =>
  `/odata/v4/${service}/${entity}(ID=${id},IsActiveEntity=${active})/${service === 'admin' ? 'AdminService' : 'TestService'}`

/** The draft flow of the draft-enabled entities; every call resolves with the HTTP response (errors included). */
export const draft = {
  /** saves (activates) the draft of an entity */
  activate: (POST: Post, service: Service, entity: string, id: string, auth: object = users.tester) => POST(`${draftUrl(service, entity, id, false)}.draftActivate`, {}, auth),
  /** opens a draft of a saved entity */
  edit: (POST: Post, service: Service, entity: string, id: string, auth: object = users.tester) =>
    POST(`${draftUrl(service, entity, id, true)}.draftEdit`, { PreserveChanges: true }, auth),
  /** creates a draft and saves it - for checks that should reject the save */
  async save(POST: Post, service: Service, entity: string, data: object, auth: object = users.tester) {
    const { data: created } = await POST(`/odata/v4/${service}/${entity}`, data, auth)
    return draft.activate(POST, service, entity, created.ID, auth)
  }
}

/** Creates an entity through the draft flow (create + draftActivate) and returns the active entity. */
export async function createActive(POST: Post, service: Service, entity: string, data: object, auth: object = users.tester) {
  const res = await draft.save(POST, service, entity, data, auth)
  if (res.status >= 300) throw new Error(`${res.status} ${JSON.stringify(res.data)}`)
  return res.data
}

/**
 * Starts a run with TestService.runTests (passwords "pw" for the given direct brokers) and waits until it finished.
 * Resolves with the response; a rejected start resolves too, without waiting.
 */
export async function runAndWait(
  POST: Post,
  run: { testCaseIds: string[]; brokerIds: string[]; options?: object; credentials?: object[] },
  auth: object = users.tester
) {
  const credentials = run.credentials ?? run.brokerIds.map((brokerId) => ({ brokerId, password: 'pw' }))
  const res = await POST('/odata/v4/test/runTests', { ...run, credentials }, auth)
  if (res.status < 300) await waitForRun(res.data.runId)
  return res
}

/** Waits until cond() holds (polled every 10 ms); fails after timeoutMs instead of hanging the test. */
export async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 5000, what = 'the condition'): Promise<void> {
  const until = Date.now() + timeoutMs
  while (!(await cond())) {
    if (Date.now() > until) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Runs fn with the env variable "destinations" (local destinations) set to the list, and restores it afterwards. */
export async function withDestinations<T>(list: object[], fn: () => Promise<T>): Promise<T> {
  const before = process.env.destinations
  process.env.destinations = JSON.stringify(list)
  try {
    return await fn()
  } finally {
    if (before === undefined) delete process.env.destinations
    else process.env.destinations = before
  }
}

/** Sets the env variable "destinations" for the enclosing describe and restores it afterwards. */
export function useDestinations(list: object[]): void {
  let before: string | undefined
  beforeAll(() => {
    before = process.env.destinations
    process.env.destinations = JSON.stringify(list)
  })
  afterAll(() => {
    if (before === undefined) delete process.env.destinations
    else process.env.destinations = before
  })
}

export const MCP_HEADERS = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }

/** One MCP JSON-RPC request to the agent endpoint (plain JSON answer, srv/lib/mcp-json.ts); auth null = anonymous. */
export async function mcpRpc(POST: Post, method: string, params: object = {}, auth: object | null = users.tester) {
  const res = await POST(
    '/mcp/agent',
    { jsonrpc: '2.0', id: 1, method, params },
    { ...(auth ?? {}), headers: MCP_HEADERS, responseType: 'text', transformResponse: (r: string) => r }
  )
  const data = String(res.data)
  const line = data.split('\n').find((l) => l.startsWith('data:'))
  return { status: res.status, headers: res.headers, body: line ? JSON.parse(line.slice(5)) : data.length ? safeJson(data) : null }
}

const safeJson = (s: string) => {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
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
  'BrokerDailyStats',
  'TestCaseProperties',
  'TestCaseVariables',
  'TestCases',
  'Variables',
  'ReceivedMessages',
  'SubscriberPresets',
  'NumberRanges',
  'Brokers',
  'Users'
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
