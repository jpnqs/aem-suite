import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

// app/_shared/Navigation.js in a fake browser: the Help button opens its section in a new tab. In SAP Build Work
// Zone the app runs in an iframe - the new tab must get the site's address, not the app's own.

type Win = Record<string, unknown> & { location: { href: string }; top?: unknown; opened: { href: string }[] }

function load(win: Win) {
  const shared = path.join(__dirname, '..', 'app', '_shared')
  const modules: Record<string, unknown> = {}
  const define = (name: string) => (deps: string[], factory: (...args: unknown[]) => unknown) => {
    modules[name] = factory(...deps.map((d) => (d === 'module' ? { id: `com/aem/suite/brokers/shared/${name}` } : modules[d.replace('./', '')])))
  }
  for (const name of ['Apps', 'Navigation']) {
    const context = vm.createContext({ sap: { ui: { define: define(name) } }, window: win, document: { referrer: '' }, URL })
    vm.runInContext(fs.readFileSync(path.join(shared, `${name}.js`), 'utf8'), context)
  }
  return modules.Navigation as { toApp(target: { app: string; path: string; newTab?: boolean }): void }
}

function browser(href: string, top?: { location: { href: string } }): Win {
  const win: Win = {
    location: { href },
    opened: [],
    open() {
      const tab = { location: { href: '' }, opener: {} }
      win.opened.push(tab.location)
      return tab
    }
  }
  win.top = top ?? win
  // the launchpad's Navigation service: getHref gives the shell hash
  win.sap = {
    ushell: {
      Container: {
        getServiceAsync: async () => ({
          getHref: async (t: { target: { semanticObject: string; action: string }; appSpecificRoute: string }) =>
            `#${t.target.semanticObject}-${t.target.action}${t.appSpecificRoute}`
        })
      }
    }
  }
  return win
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Navigation.toApp in a new tab', () => {
  it('in the suite\'s own launchpad: this page with the hash', async () => {
    const win = browser('https://suite.example/comaemsuitelaunchpad/index.html#AEMSuiteBrokers-manage')
    load(win).toApp({ app: 'help', path: '2-set-up-brokers-admin', newTab: true })
    await flush()
    expect(win.opened[0].href).toBe('https://suite.example/comaemsuitelaunchpad/index.html#AEMSuiteHelp-display&/2-set-up-brokers-admin')
  })

  it('in a Work Zone iframe: the site page around the app', async () => {
    const site = { location: { href: 'https://acme.launchpad.cfapps.eu10.hana.ondemand.com/site/aem#AEMSuiteBrokers-manage' } }
    const win = browser('https://acme.launchpad.cfapps.eu10.hana.ondemand.com/aemsuite.comaemsuitebrokers-1.0.0/index.html', site)
    load(win).toApp({ app: 'help', path: '2-set-up-brokers-admin', newTab: true })
    await flush()
    expect(win.opened[0].href).toBe('https://acme.launchpad.cfapps.eu10.hana.ondemand.com/site/aem#AEMSuiteHelp-display&/2-set-up-brokers-admin')
  })
})
