import cds from '@sap/cds'
import { isNativeRedirect } from '../srv/lib/mcp-oauth'
import { MCP_HEADERS, startServer, withAemSuiteConfig } from './helpers'

const { GET, POST } = startServer()
const UAA = 'https://acme.authentication.eu10.hana.ondemand.com'
const CLIENT = { clientid: 'sb-aem-suite!t1', clientsecret: 'binding-secret' }
// what VS Code sends in its registration request
const VSCODE_REDIRECTS = [
  'https://insiders.vscode.dev/redirect',
  'https://vscode.dev/redirect',
  'http://localhost/',
  'http://127.0.0.1/',
  'http://localhost:33418/',
  'http://127.0.0.1:33418/'
]

const anonymousRpc = () => POST('/mcp/agent', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { headers: MCP_HEADERS })

describe('MCP OAuth discovery', () => {
  describe('without XSUAA (local development)', () => {
    it('advertises nothing', async () => {
      expect((await GET('/.well-known/oauth-protected-resource')).status).toBe(404)
      expect((await GET('/.well-known/oauth-authorization-server')).status).toBe(404)
      expect((await POST('/mcp/oauth/register', { redirect_uris: ['http://127.0.0.1:33418/'] })).status).toBe(404)
      const res = await anonymousRpc()
      expect(res.status).toBe(401)
      expect(String(res.headers['www-authenticate'] ?? '')).not.toContain('resource_metadata')
    })
  })

  describe('with XSUAA', () => {
    const xsuaa = (fn: () => Promise<void>, mcp: { publicUrl?: string } = { publicUrl: 'https://aem.example.com' }) =>
      withAemSuiteConfig({ mcp: { authorizationServer: `${UAA}/`, ...mcp } }, fn)

    it('points anonymous MCP requests to the resource metadata', () => xsuaa(async () => {
      const res = await anonymousRpc()
      expect(res.status).toBe(401)
      expect(res.headers['www-authenticate']).toBe(
        'Bearer resource_metadata="https://aem.example.com/.well-known/oauth-protected-resource/mcp/agent"'
      )
    }))

    it('describes the protected resource (root and path-specific)', () => xsuaa(async () => {
      for (const url of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp/agent']) {
        const { status, data } = await GET(url)
        expect(status).toBe(200)
        expect(data).toMatchObject({
          resource: 'https://aem.example.com/mcp/agent',
          authorization_servers: ['https://aem.example.com']
        })
      }
    }))

    it('describes XSUAA as authorization server with PKCE', () => xsuaa(async () => {
      const { status, data } = await GET('/.well-known/oauth-authorization-server')
      expect(status).toBe(200)
      expect(data).toMatchObject({
        issuer: 'https://aem.example.com',
        authorization_endpoint: `${UAA}/oauth/authorize`,
        code_challenge_methods_supported: ['S256']
      })
    }))

    it('has no registration without the client secret of the binding', () => xsuaa(async () => {
      const { data } = await GET('/.well-known/oauth-authorization-server')
      expect(data.registration_endpoint).toBeUndefined()
      expect(data.token_endpoint).toBe(`${UAA}/oauth/token`)
      expect((await POST('/mcp/oauth/register', { redirect_uris: ['http://127.0.0.1:33418/'] })).status).toBe(404)
    }))

    it('derives the public URL from the approuter headers if not configured', () => xsuaa(async () => {
      const { data } = await GET('/.well-known/oauth-protected-resource', {
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'tenant.cfapps.eu10.hana.ondemand.com' }
      })
      expect(data.resource).toBe('https://tenant.cfapps.eu10.hana.ondemand.com/mcp/agent')
    }, {}))
  })

  describe('login without client secret (dynamic registration, token proxy)', () => {
    const form = (body: Record<string, string>) =>
      POST('/mcp/oauth/token', new URLSearchParams(body).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    const realFetch = globalThis.fetch
    let uaaAnswer: () => Response
    let uaaCalls: [string, RequestInit][]

    /** XSUAA bound with the app's client; its token endpoint answers with a fake token (the test client's own requests pass). */
    const xsuaa = async (fn: () => Promise<void>) => {
      const auth = cds.env.requires.auth as { credentials?: object }
      const before = auth.credentials
      auth.credentials = { url: UAA, ...CLIENT }
      uaaCalls = []
      uaaAnswer = () =>
        new Response(JSON.stringify({ access_token: 'jwt', token_type: 'bearer', refresh_token: 'r2' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        if (!String(input).startsWith(UAA)) return realFetch(input, init)
        uaaCalls.push([String(input), init!])
        return uaaAnswer()
      })
      try {
        await withAemSuiteConfig({ mcp: { publicUrl: 'https://aem.example.com' } }, fn)
      } finally {
        spy.mockRestore()
        auth.credentials = before
      }
    }
    const forwarded = () => {
      const [url, init] = uaaCalls[0]
      return { url, headers: init.headers as Record<string, string>, body: Object.fromEntries(new URLSearchParams(init.body as URLSearchParams)) }
    }

    it('advertises registration and the token proxy, login at XSUAA', () => xsuaa(async () => {
      const { data } = await GET('/.well-known/oauth-authorization-server')
      expect(data).toMatchObject({
        authorization_endpoint: `${UAA}/oauth/authorize`,
        token_endpoint: 'https://aem.example.com/mcp/oauth/token',
        registration_endpoint: 'https://aem.example.com/mcp/oauth/register',
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256']
      })
    }))

    it('registers VS Code as a public client with the app client ID, never the secret', () => xsuaa(async () => {
      const res = await POST('/mcp/oauth/register', {
        client_name: 'Visual Studio Code',
        redirect_uris: VSCODE_REDIRECTS,
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none'
      })
      expect(res.status).toBe(201)
      expect(res.data).toMatchObject({
        client_id: CLIENT.clientid,
        client_name: 'Visual Studio Code',
        redirect_uris: VSCODE_REDIRECTS,
        token_endpoint_auth_method: 'none'
      })
      expect(JSON.stringify(res.data)).not.toContain(CLIENT.clientsecret)
      expect(res.headers['cache-control']).toBe('no-store')
    }))

    it('refuses registrations with other redirect URIs', () => xsuaa(async () => {
      for (const redirect_uris of [undefined, [], ['https://evil.example.com/cb'], ['http://127.0.0.1:33418/', 'https://vscode.dev.evil.com/redirect']]) {
        const res = await POST('/mcp/oauth/register', { redirect_uris })
        expect(res.status).toBe(400)
        expect(res.data.error).toBe('invalid_redirect_uri')
      }
    }))

    it('redeems a PKCE code at XSUAA with the client secret added', () => xsuaa(async () => {
      const res = await form({
        grant_type: 'authorization_code',
        code: 'c1',
        code_verifier: 'v1',
        redirect_uri: 'http://127.0.0.1:33418/',
        client_id: CLIENT.clientid,
        resource: 'https://aem.example.com/mcp/agent'
      })
      expect(res.status).toBe(200)
      expect(res.data).toMatchObject({ access_token: 'jwt', refresh_token: 'r2' })
      expect(res.headers['cache-control']).toBe('no-store')
      const { url, headers, body } = forwarded()
      expect(url).toBe(`${UAA}/oauth/token`)
      expect(headers.Authorization).toBe(`Basic ${Buffer.from(`${encodeURIComponent(CLIENT.clientid)}:${CLIENT.clientsecret}`).toString('base64')}`)
      // only the grant's own parameters reach XSUAA
      expect(body).toEqual({ grant_type: 'authorization_code', code: 'c1', code_verifier: 'v1', redirect_uri: 'http://127.0.0.1:33418/' })
    }))

    it('refreshes a token', () => xsuaa(async () => {
      expect((await form({ grant_type: 'refresh_token', refresh_token: 'r1' })).status).toBe(200)
      expect(forwarded().body).toEqual({ grant_type: 'refresh_token', refresh_token: 'r1' })
    }))

    it('passes XSUAA errors on', () => xsuaa(async () => {
      uaaAnswer = () => new Response('{"error":"invalid_grant"}', { status: 400, headers: { 'content-type': 'application/json' } })
      const res = await form({ grant_type: 'refresh_token', refresh_token: 'expired' })
      expect(res.status).toBe(400)
      expect(res.data.error).toBe('invalid_grant')
    }))

    it.each([
      ['client credentials', { grant_type: 'client_credentials' }, 'unsupported_grant_type'],
      ['password', { grant_type: 'password', username: 'u', password: 'p' }, 'unsupported_grant_type'],
      ['a code without PKCE', { grant_type: 'authorization_code', code: 'c', redirect_uri: 'http://127.0.0.1:33418/' }, 'invalid_request'],
      ['a code of the approuter', { grant_type: 'authorization_code', code: 'c', code_verifier: 'v', redirect_uri: 'https://aem.example.com/login/callback' }, 'invalid_grant'],
      ['another client', { grant_type: 'refresh_token', refresh_token: 'r', client_id: 'other' }, 'invalid_client']
    ])('refuses %s without asking XSUAA', (_, body, error) => xsuaa(async () => {
      const res = await form(body)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.data.error).toBe(error)
      expect(uaaCalls).toEqual([])
    }))
  })
})

describe('isNativeRedirect', () => {
  it.each([
    ['http://127.0.0.1:33418/', true],
    ['http://localhost:8765/callback', true],
    ['http://[::1]:5000/', true],
    ['https://vscode.dev/redirect', true],
    ['https://insiders.vscode.dev/redirect', true],
    ['https://vscode.dev/redirect?x=1', false],
    ['https://vscode.dev/other', false],
    ['https://localhost/cb', false],
    ['http://127.0.0.1.evil.com/', false],
    ['http://user@127.0.0.1/', false],
    ['http://127.0.0.1/#x', false],
    ['vscode://callback', false],
    ['not a url', false]
  ])('%s -> %s', (uri, expected) => expect(isNativeRedirect(uri)).toBe(expected))
})
