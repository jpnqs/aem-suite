import fs from 'node:fs'
import path from 'node:path'

// The UI5 version is pinned in many files (bootstrap URLs, manifests, type packages). The root package.json's
// @sapui5/types is the reference: to move to another UI5 version, change all of them together.

const root = path.join(__dirname, '..')
const appDir = path.join(root, 'app')
const read = (...p: string[]) => fs.readFileSync(path.join(...p), 'utf8')
const json = (...p: string[]) => JSON.parse(read(...p))

const version: string = json(root, 'package.json').devDependencies['@sapui5/types']
const apps = fs.readdirSync(appDir).filter((d) => fs.existsSync(path.join(appDir, d, 'webapp', 'index.html')))

describe('UI5 version', () => {
  it('is pinned exactly in the root package.json', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it.each(apps)('%s: index.html loads the pinned version from the CDN', (app) => {
    const html = read(appDir, app, 'webapp', 'index.html')
    const urls = [...html.matchAll(/https:\/\/ui5\.sap\.com\/([^/]+)\//g)].map((m) => m[1])
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.filter((v) => v !== version)).toEqual([])
  })

  // the launchpad's manifest only describes the HTML5 app, it declares no UI5 dependencies
  const components = apps.filter((app) => fs.existsSync(path.join(appDir, app, 'webapp', 'Component.js')) || fs.existsSync(path.join(appDir, app, 'webapp', 'Component.ts')))

  it.each(components)('%s: minUI5Version is the same minor', (app) => {
    const manifest = json(appDir, app, 'webapp', 'manifest.json')
    const [major, minor] = version.split('.')
    expect(manifest['sap.ui5'].dependencies.minUI5Version).toBe(`${major}.${minor}.0`)
  })

  it('the TypeScript apps use the same type package', () => {
    const tsApps = fs.readdirSync(appDir).filter((d) => fs.existsSync(path.join(appDir, d, 'tsconfig.json')))
    expect(tsApps.length).toBeGreaterThan(0)
    for (const app of tsApps) expect({ app, version: json(appDir, app, 'package.json').devDependencies['@sapui5/types'] }).toEqual({ app, version })
  })
})
