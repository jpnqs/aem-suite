import cds from '@sap/cds'
import path from 'node:path'

const { GET, POST, axios } = cds.test(path.join(__dirname, '..'))
const MCP_HEADERS = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }
const UAA = 'https://acme.authentication.eu10.hana.ondemand.com'

type Env = { aemSuite?: { mcp?: { authorizationServer?: string; publicUrl?: string } } }
const env = cds.env as unknown as Env

const anonymousRpc = () => POST('/mcp/agent', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { headers: MCP_HEADERS })

describe('MCP OAuth discovery', () => {
  beforeAll(() => {
    axios.defaults.validateStatus = () => true
  })

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
    beforeAll(() => {
      env.aemSuite = { ...env.aemSuite, mcp: { authorizationServer: `${UAA}/`, publicUrl: 'https://aem.example.com' } }
    })
    afterAll(() => {
      delete env.aemSuite!.mcp
    })

    it('points anonymous MCP requests to the resource metadata', async () => {
      const res = await anonymousRpc()
      expect(res.status).toBe(401)
      expect(res.headers['www-authenticate']).toBe(
        'Bearer resource_metadata="https://aem.example.com/.well-known/oauth-protected-resource/mcp/agent"'
      )
    })

    it('describes the protected resource (root and path-specific)', async () => {
      for (const url of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp/agent']) {
        const { status, data } = await GET(url)
        expect(status).toBe(200)
        expect(data).toMatchObject({
          resource: 'https://aem.example.com/mcp/agent',
          authorization_servers: ['https://aem.example.com']
        })
      }
    })

    it('describes XSUAA as authorization server with PKCE', async () => {
      const { status, data } = await GET('/.well-known/oauth-authorization-server')
      expect(status).toBe(200)
      expect(data).toMatchObject({
        issuer: 'https://aem.example.com',
        authorization_endpoint: `${UAA}/oauth/authorize`,
        token_endpoint: `${UAA}/oauth/token`,
        code_challenge_methods_supported: ['S256']
      })
    })

    it('derives the public URL from the approuter headers if not configured', async () => {
      delete env.aemSuite!.mcp!.publicUrl
      const { data } = await GET('/.well-known/oauth-protected-resource', {
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'tenant.cfapps.eu10.hana.ondemand.com' }
      })
      expect(data.resource).toBe('https://tenant.cfapps.eu10.hana.ondemand.com/mcp/agent')
    })
  })
})
