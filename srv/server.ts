import cds from '@sap/cds'

// Local development: never let the browser cache UI files (fragments, controllers, manifests).
// UI5 loads them via XHR, which a hard reload (Ctrl+F5) does not refresh.
// In production the approuter sets cache headers (see app/router/xs-app.json).
if (process.env.NODE_ENV !== 'production') {
  cds.on('bootstrap', (app) => {
    app.use((req, res, next) => {
      if (!req.path.startsWith('/odata/') && !req.path.startsWith('/ws/')) res.set('Cache-Control', 'no-store')
      next()
    })
  })
}

export default cds.server
