import fs from 'node:fs'
import path from 'node:path'

// The sandbox launchpad (app/launchpad/webapp/index.html) repeats the title and description of every app.

const appDir = path.join(__dirname, '..', 'app')
const html = fs.readFileSync(path.join(appDir, 'launchpad', 'webapp', 'index.html'), 'utf8')
const tiles = [...html.matchAll(/"(\w+)-(\w+)": \{\s*title: "([^"]+)",\s*description: "([^"]+)",[\s\S]*?SAPUI5\.Component=com\.aem\.suite\.(\w+)"/g)].map(
  ([, semanticObject, action, title, description, app]) => ({ app, semanticObject, action, title, description })
)

function i18n(app: string): Record<string, string> {
  const text = fs.readFileSync(path.join(appDir, app, 'webapp', 'i18n', 'i18n.properties'), 'utf8')
  return Object.fromEntries(text.split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
}

describe('launchpad tiles', () => {
  it('has a tile for every app', () => {
    const apps = fs.readdirSync(appDir).filter((d) => d !== 'launchpad' && fs.existsSync(path.join(appDir, d, 'ui5.yaml')))
    expect(tiles.map((t) => t.app).sort()).toEqual(apps.sort())
  })

  it.each(tiles)('$app: same title, description and intent as the app', ({ app, semanticObject, action, title, description }) => {
    const texts = i18n(app)
    expect({ title, description }).toEqual({ title: texts.appTitle, description: texts.appDescription })
    const manifest = JSON.parse(fs.readFileSync(path.join(appDir, app, 'webapp', 'manifest.json'), 'utf8'))
    expect(Object.values(manifest['sap.app'].crossNavigation.inbounds)).toContainEqual(expect.objectContaining({ semanticObject, action }))
  })
})
