import cds from '@sap/cds'
import express from 'express'
import type { Application, Request, Response, NextFunction } from 'express'
import { config } from './core/config'
import { publicBase } from './core/public-url'

/**
 * OAuth for the MCP endpoint (MCP authorization spec: RFC 9728, RFC 8414, RFC 7591), so AI clients such as
 * VS Code log the user in against XSUAA themselves - the user only adds the URL, no client ID or secret.
 *
 * - 401 responses on /mcp/* get `WWW-Authenticate: Bearer resource_metadata="..."`.
 * - /.well-known/oauth-protected-resource names this app as the authorization server.
 * - /.well-known/oauth-authorization-server: login at XSUAA's /oauth/authorize, token and registration here
 *   (XSUAA itself only offers OpenID discovery and has neither dynamic registration nor public clients).
 * - POST /mcp/oauth/register (dynamic client registration) hands every native client the app's own XSUAA client
 *   ID as a public client (`token_endpoint_auth_method: none`); only loopback and VS Code redirect URIs.
 * - POST /mcp/oauth/token forwards authorization code (PKCE required) and refresh token grants to XSUAA and adds
 *   the client secret of the app's binding, which never leaves the server. Nothing else is forwarded (no client
 *   credentials or password grant), and only codes issued to a native redirect URI can be redeemed, so the
 *   approuter's own logins stay out of reach.
 *
 * XSUAA still checks the redirect URI against `oauth2-configuration.redirect-uris` (mta.yaml) and the user gets
 * their own roles. Without XSUAA credentials (local development with mocked auth) nothing is advertised.
 */

const PROTECTED_RESOURCE = '/.well-known/oauth-protected-resource'
const AUTHORIZATION_SERVER = '/.well-known/oauth-authorization-server'
const REGISTER = '/mcp/oauth/register'
const TOKEN = '/mcp/oauth/token'

/** Redirect URIs of VS Code's login through the browser (besides its loopback server). */
const VSCODE_REDIRECTS = ['https://vscode.dev/redirect', 'https://insiders.vscode.dev/redirect']
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]']

type Credentials = { url?: string; clientid?: string; clientsecret?: string }

function credentials(): Credentials {
  const auth = cds.env.requires?.auth as { credentials?: Credentials } | undefined
  return auth?.credentials ?? {}
}

function authServerUrl(): string | undefined {
  return (config().mcp.authorizationServer ?? credentials().url)?.replace(/\/+$/, '')
}

/** The app's XSUAA client, if the backend can redeem codes for clients without a secret. */
function proxyClient(): { id: string; secret: string } | undefined {
  const { clientid, clientsecret } = credentials()
  return clientid && clientsecret ? { id: clientid, secret: clientsecret } : undefined
}

/** A redirect URI of a client on the user's machine (RFC 8252 loopback) or VS Code's browser redirect. */
export function isNativeRedirect(uri: unknown): uri is string {
  if (typeof uri !== 'string') return false
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.username || url.password || url.hash) return false
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.includes(url.hostname)
  return url.protocol === 'https:' && !url.search && VSCODE_REDIRECTS.includes(url.origin + url.pathname)
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
  const base = publicBase(req)
  res.json({
    issuer: base,
    authorization_endpoint: `${uaa}/oauth/authorize`,
    jwks_uri: `${uaa}/token_keys`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    ...(proxyClient()
      ? { token_endpoint: `${base}${TOKEN}`, registration_endpoint: `${base}${REGISTER}`, token_endpoint_auth_methods_supported: ['none'] }
      : { token_endpoint: `${uaa}/oauth/token`, token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'] })
  })
}

const oauthError = (res: Response, status: number, error: string, description?: string) =>
  res.status(status).set('Cache-Control', 'no-store').json({ error, ...(description && { error_description: description }) })

/** RFC 7591: every native client gets the app's XSUAA client ID as a public client. */
function register(req: Request, res: Response) {
  const client = proxyClient()
  if (!client || !authServerUrl()) return res.sendStatus(404)
  const body = (req.body ?? {}) as { redirect_uris?: unknown; client_name?: unknown }
  const uris = body.redirect_uris
  if (!Array.isArray(uris) || !uris.length || !uris.every(isNativeRedirect))
    return oauthError(res, 400, 'invalid_redirect_uri', 'only loopback (http://127.0.0.1, http://localhost) and VS Code redirect URIs')
  res.status(201).set('Cache-Control', 'no-store').json({
    client_id: client.id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(typeof body.client_name === 'string' && { client_name: body.client_name }),
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none'
  })
}

/** Forwards the two user grants to XSUAA with the app's client secret; everything else is refused. */
async function token(req: Request, res: Response) {
  const client = proxyClient()
  const uaa = authServerUrl()
  if (!client || !uaa) return res.sendStatus(404)
  const body = (req.body ?? {}) as Record<string, unknown>
  const param = (name: string) => (typeof body[name] === 'string' && body[name] ? (body[name] as string) : undefined)
  if (param('client_id') && param('client_id') !== client.id) return oauthError(res, 401, 'invalid_client')

  const forward = new URLSearchParams()
  const grant = param('grant_type')
  if (grant === 'authorization_code') {
    const [code, verifier, redirect] = [param('code'), param('code_verifier'), param('redirect_uri')]
    if (!code || !verifier) return oauthError(res, 400, 'invalid_request', 'code and code_verifier (PKCE) are required')
    if (!isNativeRedirect(redirect)) return oauthError(res, 400, 'invalid_grant', 'redirect_uri is not a native client redirect')
    forward.set('grant_type', grant)
    forward.set('code', code)
    forward.set('code_verifier', verifier)
    forward.set('redirect_uri', redirect)
  } else if (grant === 'refresh_token') {
    const refresh = param('refresh_token')
    if (!refresh) return oauthError(res, 400, 'invalid_request', 'refresh_token is required')
    forward.set('grant_type', grant)
    forward.set('refresh_token', refresh)
  } else {
    return oauthError(res, 400, 'unsupported_grant_type')
  }

  try {
    const basic = Buffer.from(`${encodeURIComponent(client.id)}:${encodeURIComponent(client.secret)}`).toString('base64')
    const answer = await fetch(`${uaa}/oauth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: forward
    })
    res
      .status(answer.status)
      .set('Cache-Control', 'no-store')
      .type(answer.headers.get('content-type') ?? 'application/json')
      .send(await answer.text())
  } catch (e) {
    cds.log('mcp-oauth').error('token request to XSUAA failed:', e)
    oauthError(res, 502, 'temporarily_unavailable')
  }
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
  // registration and token are served before the MCP endpoint's 401 hint (they are no protected resource)
  app.post(REGISTER, express.json({ limit: '16kb' }), register)
  app.post(TOKEN, express.urlencoded({ extended: false, limit: '16kb' }), token)
  app.use('/mcp', challenge)
}
