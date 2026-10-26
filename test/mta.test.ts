import fs from 'node:fs'
import path from 'node:path'
import { parse, parseAllDocuments } from 'yaml'

// The MTA lists every UI app by hand (html5 module + zip for the HTML5 repo); scripts/build-ui.js finds them on its own.

type Module = {
  name: string
  type: string
  path?: string
  'build-parameters'?: { requires?: { name: string; artifacts?: string[] }[] }
}

const root = path.join(__dirname, '..')
type Resource = { name: string; parameters?: { config?: { 'oauth2-configuration'?: { 'redirect-uris'?: string[] } } }; requires?: { name: string }[] }

const mta = parse(fs.readFileSync(path.join(root, 'mta.yaml'), 'utf8')) as { ID: string; modules: Module[]; resources: Resource[] }
const devExt = parse(fs.readFileSync(path.join(root, 'dev.mtaext'), 'utf8')) as { extends: string; resources: Resource[] }
const redirectUris = (r?: Resource) => r?.parameters?.config?.['oauth2-configuration']?.['redirect-uris']
const APPROUTER_ROUTE = '~{app-api/app-protocol}://~{app-api/app-uri}/**'
// VS Code's MCP login: loopback server on its fixed port, browser redirect (srv/lib/mcp-oauth.ts)
const VSCODE = ['http://127.0.0.1:33418/**', 'https://vscode.dev/redirect', 'https://insiders.vscode.dev/redirect']
const apps = fs
  .readdirSync(path.join(root, 'app'))
  .filter((d) => fs.existsSync(path.join(root, 'app', d, 'ui5.yaml')))
  .map((d) => {
    // the project is the first document, the extensions of scripts/ui5 follow
    const ui5 = parseAllDocuments(fs.readFileSync(path.join(root, 'app', d, 'ui5.yaml'), 'utf8'))[0].toJS()
    const zipper = ui5.builder?.customTasks?.find((t: { name: string }) => t.name === 'ui5-task-zipper')
    return { dir: d, zip: `${zipper?.configuration?.archiveName}.zip` }
  })

describe('mta.yaml', () => {
  const html5 = mta.modules.filter((m) => m.type === 'html5')
  const deployed = mta.modules.find((m) => m.name === 'aem-suite-app-deployer')!['build-parameters']!.requires!

  it.each(apps)('deploys app/$dir', ({ dir, zip }) => {
    const module = html5.find((m) => m.path === `app/${dir}`)
    expect(module).toBeDefined()
    expect(deployed.find((r) => r.name === module!.name)?.artifacts).toEqual([zip])
  })

  it('has no html5 module without an app', () => {
    expect(html5.map((m) => m.path).filter((p) => !apps.some((a) => p === `app/${a.dir}`))).toEqual([])
  })
})

describe('XSUAA redirect URIs (D1)', () => {
  const auth = mta.resources.find((r) => r.name === 'aem-suite-auth')

  it('allows only the approuter route and the VS Code MCP login in mta.yaml', () => {
    expect(redirectUris(auth)).toEqual([APPROUTER_ROUTE, ...VSCODE])
    expect(auth?.requires?.map((r) => r.name)).toContain('app-api')
    expect(mta.modules.find((m) => m.name === 'aem-suite')).toBeDefined()
  })

  it('has no wildcard over the default domain or a port, and no localhost outside dev.mtaext', () => {
    const text = fs.readFileSync(path.join(root, 'mta.yaml'), 'utf8')
    expect(text).not.toMatch(/\*\.\$\{default-domain\}/)
    expect(redirectUris(auth)!.some((u) => u.includes('localhost') || u.includes(':*'))).toBe(false)
  })

  it('adds the local MCP callback in dev.mtaext only', () => {
    expect(devExt.extends).toBe(mta.ID)
    const uris = redirectUris(devExt.resources.find((r) => r.name === 'aem-suite-auth'))
    expect(uris).toEqual([APPROUTER_ROUTE, ...VSCODE, 'http://localhost:8765/**'])
    expect(uris!.join(' ')).not.toContain('default-domain')
  })
})
