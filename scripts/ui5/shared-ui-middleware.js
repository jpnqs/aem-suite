/**
 * UI5 server middleware (ui5.yaml of every app, also used by `cds watch` through cds-plugin-ui5): serves the
 * app/_shared modules at the app's shared/ path (./shared/Help.js = com/aem/suite/<app>/shared/Help), read on
 * every request, so a change to app/_shared shows up with the next reload. See shared-ui.js.
 */
const { sharedFile } = require('./shared-ui')

const SHARED = /\/shared\/([A-Za-z]+(?:\.controller)?\.js)$/

module.exports = function () {
  return (req, res, next) => {
    const m = SHARED.exec(req.path)
    const content = m && sharedFile(m[1])
    if (!content) return next()
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.end(content)
  }
}
