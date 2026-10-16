import cds from '@sap/cds'
import type { Application, Request, Response, NextFunction } from 'express'
import { config } from './config'

/**
 * OAuth discovery for the MCP endpoint (MCP authorization spec, RFC 9728 / RFC 8414), so AI clients
 * can log the user in against XSUAA themselves instead of being handed a bearer token.
 *
 * - 401 responses on /mcp/* get `WWW-Authenticate: Bearer resource_metadata="..."`.
 * - /.well-known/oauth-protected-resource names this app as the authorization server.
 * - /.well-known/oauth-authorization-server describes the XSUAA endpoints (XSUAA itself only
 *   offers OpenID discovery, which not every MCP client falls back to).
 *
 * XSUAA has no dynamic client registration: clients use the app's XSUAA client (service key).
 * Without XSUAA credentials (local development with mocked auth) nothing is advertised.
 */

const PROTECTED_RESOURCE = '/.well-known/oauth-protected-resource'
const AUTHORIZATION_SERVER = '/.well-known/oauth-authorization-server'

function authServerUrl(): string | undefined {
  const own = config().mcp.authorizationServer
  const auth = cds.env.requires?.auth as { credentials?: { url?: string } } | undefined
  return (own ?? auth?.credentials?.url)?.replace(/\/+$/, '')
}

/** The URL the client used: configured, or derived from the approuter's forwarded headers. */
function publicBase(req: Request): string {
  const configured = config().mcp.publicUrl
  if (configured) return configured.replace(/\/+$/, '')
  const first = (h: string | string[] | undefined) => String(Array.isArray(h) ? h[0] : (h ?? '')).split(',')[0].trim()
  const proto = first(req.headers['x-forwarded-proto']) || req.protocol
  const host = first(req.headers['x-forwarded-host']) || req.headers.host
  return `${proto}://${host}`
}

function protectedResource(req: Request, res: Response) {
  if (!authServerUrl()) return res.sendStatus(404)
  const base = publicBase(req)
  res.json({
    resource: `${base}/mcp/agent`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    resource_name: 'AEM Test Suite'
  })
}

function authorizationServer(req: Request, res: Response) {
  const uaa = authServerUrl()
  if (!uaa) return res.sendStatus(404)
  res.json({
    issuer: publicBase(req),
    authorization_endpoint: `${uaa}/oauth/authorize`,
    token_endpoint: `${uaa}/oauth/token`,
    jwks_uri: `${uaa}/token_keys`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post']
  })
}

/** Adds the discovery hint to every 401 of the MCP endpoint (missing, invalid or expired token). */
function challenge(req: Request, res: Response, next: NextFunction) {
  if (authServerUrl()) {
    const metadata = `${publicBase(req)}${PROTECTED_RESOURCE}/mcp/agent`
    const writeHead = res.writeHead
    res.writeHead = function (this: Response, ...args: unknown[]) {
      if ((typeof args[0] === 'number' ? args[0] : this.statusCode) === 401)
        this.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadata}"`)
      return (writeHead as (...a: unknown[]) => Response).apply(this, args)
    } as typeof res.writeHead
  }
  next()
}

export function registerMcpOAuth(app: Application) {
  // clients ask for the path-specific document first (RFC 9728), then the root one
  app.get([PROTECTED_RESOURCE, `${PROTECTED_RESOURCE}/mcp/agent`], protectedResource)
  app.get(AUTHORIZATION_SERVER, authorizationServer)
  app.use('/mcp', challenge)
}
