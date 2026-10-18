import fs from 'node:fs'
import path from 'node:path'

// The app catalog is app/_shared/Apps.js. The sandbox launchpad (app/launchpad/webapp/index.html) cannot load it and
// repeats intent and icon of every app, plus the title and description of the app's i18n texts.

const appDir = path.join(__dirname, '..', 'app')
const html = fs.readFileSync(path.join(appDir, 'launchpad', 'webapp', 'index.html'), 'utf8')
const tiles = [
  ...html.matchAll(/"(\w+)-(\w+)": \{\s*title: "([^"]+)",\s*description: "([^"]+)",\s*icon: "([^"]+)",[\s\S]*?SAPUI5\.Component=com\.aem\.suite\.(\w+)"/g)
].map(([, semanticObject, action, title, description, icon, app]) => ({ app, semanticObject, action, title, description, icon }))

/** app/_shared/Apps.js is a UI5 module: run it with a stand-in for sap.ui.define */
function loadApps(): Record<string, { intent: string; icon: string; role: string | null }> {
  let exported: { APPS: Record<string, { intent: string; icon: string; role: string | null }> } | undefined
  const sap = { ui: { define: (_deps: string[], factory: () => typeof exported) => (exported = factory()) } }
  new Function('sap', fs.readFileSync(path.join(appDir, '_shared', 'Apps.js'), 'utf8'))(sap)
  return exported!.APPS
}
const catalog = loadApps()

function i18n(app: string): Record<string, string> {
  const text = fs.readFileSync(path.join(appDir, app, 'webapp', 'i18n', 'i18n.properties'), 'utf8')
  return Object.fromEntries(text.split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
}

const apps = fs.readdirSync(appDir).filter((d) => d !== 'launchpad' && fs.existsSync(path.join(appDir, d, 'ui5.yaml')))

describe('app catalog and launchpad tiles', () => {
  it('has a catalog entry and a tile for every app', () => {
    expect(Object.keys(catalog).sort()).toEqual([...apps].sort())
    expect(tiles.map((t) => t.app).sort()).toEqual([...apps].sort())
  })

  it.each(tiles)('$app: the tile has the intent and icon of the catalog and the texts of the app', ({ app, semanticObject, action, title, description, icon }) => {
    expect({ intent: `${semanticObject}-${action}`, icon }).toEqual({ intent: catalog[app].intent, icon: catalog[app].icon })
    const texts = i18n(app)
    expect({ title, description }).toEqual({ title: texts.appTitle, description: texts.appDescription })
  })

  it.each(apps)('%s: the manifest has the intent of the catalog', (app) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(appDir, app, 'webapp', 'manifest.json'), 'utf8'))
    const [semanticObject, action] = catalog[app].intent.split('-')
    expect(Object.values(manifest['sap.app'].crossNavigation.inbounds)).toContainEqual(expect.objectContaining({ semanticObject, action }))
  })
})
