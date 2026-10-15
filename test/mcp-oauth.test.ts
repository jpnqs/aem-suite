import { startServer, withAemSuiteConfig } from './helpers'

const { GET, POST } = startServer()
const MCP_HEADERS = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }
const UAA = 'https://acme.authentication.eu10.hana.ondemand.com'

const anonymousRpc = () => POST('/mcp/agent', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { headers: MCP_HEADERS })

describe('MCP OAuth discovery', () => {
  describe('without XSUAA (local development)', () => {
    it('advertises nothing', async () => {
      expect((await GET('/.well-known/oauth-protected-resource')).status).toBe(404)
      expect((await GET('/.well-known/oauth-authorization-server')).status).toBe(404)
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
        token_endpoint: `${UAA}/oauth/token`,
        code_challenge_methods_supported: ['S256']
      })
    }))

    it('derives the public URL from the approuter headers if not configured', () => xsuaa(async () => {
      const { data } = await GET('/.well-known/oauth-protected-resource', {
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'tenant.cfapps.eu10.hana.ondemand.com' }
      })
      expect(data.resource).toBe('https://tenant.cfapps.eu10.hana.ondemand.com/mcp/agent')
    }, {}))
  })
})
