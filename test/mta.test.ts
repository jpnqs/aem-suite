import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

// The MTA lists every UI app by hand (html5 module + zip for the HTML5 repo); scripts/build-ui.js finds them on its own.

type Module = {
  name: string
  type: string
  path?: string
  'build-parameters'?: { requires?: { name: string; artifacts?: string[] }[] }
}

const root = path.join(__dirname, '..')
const mta = parse(fs.readFileSync(path.join(root, 'mta.yaml'), 'utf8')) as { modules: Module[] }
const apps = fs
  .readdirSync(path.join(root, 'app'))
  .filter((d) => fs.existsSync(path.join(root, 'app', d, 'ui5.yaml')))
  .map((d) => {
    const ui5 = parse(fs.readFileSync(path.join(root, 'app', d, 'ui5.yaml'), 'utf8'))
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
