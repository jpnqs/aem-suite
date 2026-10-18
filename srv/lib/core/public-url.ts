import cds from '@sap/cds'
import type { Request } from 'express'
import { config } from './config'

/** The URL the client used: configured, or derived from the approuter's forwarded headers. */
export function publicBase(req: Pick<Request, 'headers' | 'protocol'>): string {
  const configured = config().mcp.publicUrl
  if (configured) return configured.replace(/\/+$/, '')
  const first = (h: string | string[] | undefined) => String(Array.isArray(h) ? h[0] : (h ?? '')).split(',')[0].trim()
  const proto = first(req.headers['x-forwarded-proto']) || req.protocol
  const host = first(req.headers['x-forwarded-host']) || req.headers.host
  return `${proto}://${host}`
}

/** Env variable with the launchpad address (wins over cds.aemSuite.mcp.launchpadUrl), e.g. set in mta.yaml. */
export const LAUNCHPAD_URL_ENV = 'AEM_SUITE_LAUNCHPAD_URL'

/**
 * The launchpad as the user opens it in the browser: configured (env AEM_SUITE_LAUNCHPAD_URL, then
 * cds.aemSuite.mcp.launchpadUrl - e.g. a Work Zone site), or the app's own sandbox launchpad behind the approuter
 * (locally /launchpad.html). Undefined outside an HTTP request.
 */
export function launchpadUrl(): string | undefined {
  const configured = process.env[LAUNCHPAD_URL_ENV]?.trim() || config().mcp.launchpadUrl
  if (configured) return configured
  const req = (cds.context as { http?: { req?: Request } } | undefined)?.http?.req
  if (!req) return undefined
  const path = cds.env.profiles?.includes('production') ? '/comaemsuitelaunchpad/index.html' : '/launchpad.html'
  return publicBase(req) + path
}

/** Links into the apps (launchpad intents), for people who open them in a browser where they are logged in. */
export const appLinks = {
  testCase: (id: string) => withBase(`#AEMSuiteTestCases-manage&/TestCases(ID=${id},IsActiveEntity=true)`),
  run: (id: string) => withBase(`#AEMSuiteTestRuns-display&/TestRuns(${id})`)
}

function withBase(hash: string): string | null {
  const base = launchpadUrl()
  return base ? base + hash : null
}
