import cds from '@sap/cds'
import { registerMcpOAuth } from './lib/mcp-oauth'

// AI clients log in against XSUAA themselves (OAuth discovery for /mcp/agent).
cds.on('bootstrap', (app) => registerMcpOAuth(app))

if (process.env.NODE_ENV !== 'production') {
  // The UI apps call odata/ and ws/ relative to their own path (in BTP each app's xs-app.json routes them
  // to the backend). Locally the apps are mounted at /<HTML5 app name>/ - strip that prefix here.
  const appPrefix = /^\/comaemsuite[a-z]+\/(?=(odata|ws)\/)/

  cds.on('bootstrap', (app) => {
    app.get('/launchpad.html', (_req, res) => res.redirect('/comaemsuitelaunchpad/index.html'))
    app.use((req, _res, next) => {
      req.url = req.url
        .replace(appPrefix, '/')
        // the launchpad sandbox reads its config from the host root (BTP: route in app/router/xs-app.json)
        .replace(/^\/appconfig\//, '/comaemsuitelaunchpad/appconfig/')
      next()
    })
    // Never let the browser cache UI files (fragments, controllers, manifests).
    // UI5 loads them via XHR, which a hard reload (Ctrl+F5) does not refresh.
    // In production the approuter sets cache headers (see the apps' xs-app.json).
    app.use((req, res, next) => {
      if (!req.path.startsWith('/odata/') && !req.path.startsWith('/ws/')) res.set('Cache-Control', 'no-store')
      next()
    })
  })

  // websocket upgrades bypass express - rewrite them before the websocket server sees them
  cds.on('listening', ({ server }) => {
    server.prependListener('upgrade', (req: { url?: string }) => {
      if (req.url) req.url = req.url.replace(appPrefix, '/')
    })
  })
}

export default cds.server
