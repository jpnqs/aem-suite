import fs from 'node:fs'
import path from 'node:path'

// The app/_shared modules reach the apps through the UI5 build task and the dev server middleware of
// scripts/ui5 (no committed copies). This checks the wiring and which modules each app gets.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { modulesUsedBy, sharedFiles } = require(path.join(__dirname, '..', 'scripts', 'ui5', 'shared-ui.js')) as {
  modulesUsedBy(texts: string[]): string[]
  sharedFiles(): string[]
}

const appDir = path.join(__dirname, '..', 'app')
const apps = fs.readdirSync(appDir).filter((d) => d !== 'launchpad' && fs.existsSync(path.join(appDir, d, 'ui5.yaml')))

/** The sources of an app (its webapp folder). */
function sources(app: string): string[] {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const file = path.join(dir, e.name)
      return e.isDirectory() ? walk(file) : /\.(js|ts|xml|json)$/.test(e.name) ? [fs.readFileSync(file, 'utf8')] : []
    })
  return walk(path.join(appDir, app, 'webapp'))
}

describe('shared UI modules (app/_shared)', () => {
  it.each(apps)('%s: the build adds them and the dev server serves them', (app) => {
    const yaml = fs.readFileSync(path.join(appDir, app, 'ui5.yaml'), 'utf8')
    expect(yaml).toContain('- name: aem-shared-ui-task')
    expect(yaml).toContain('- name: aem-shared-ui-middleware')
    expect(yaml).toContain('path: ../../scripts/ui5/shared-ui-task.js')
    expect(yaml).toContain('path: ../../scripts/ui5/shared-ui-middleware.js')
    // a left-over copy would be served instead of the original
    expect(fs.existsSync(path.join(appDir, app, 'webapp', 'shared'))).toBe(false)
  })

  it.each(apps)('%s: every shared module it names exists', (app) => {
    const known = new Set(sharedFiles().map((f) => f.split('.')[0]))
    const named = sources(app).flatMap((t) => [...t.matchAll(/\/suite\/\w+\/shared\/(\w+)|\.suite\.\w+\.shared\.(\w+)/g)].map((m) => m[1] ?? m[2]))
    expect(named.filter((n) => !known.has(n))).toEqual([])
  })

  it('gives an app the modules it names plus what they load', () => {
    expect(modulesUsedBy(sources('brokers'))).toEqual(['Apps.js', 'Help.js', 'Navigation.js'])
    expect(modulesUsedBy(sources('help'))).toEqual(['Actions.js'])
    expect(modulesUsedBy(['sap.ui.define(["com/aem/suite/x/shared/Help"])'])).toEqual(['Apps.js', 'Help.js', 'Navigation.js'])
  })
})
