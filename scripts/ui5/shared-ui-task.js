/**
 * UI5 build task (ui5.yaml of every app): adds the app/_shared modules the app uses to the build result under the
 * app's namespace (resources/com/aem/suite/<app>/shared/...), before the Component-preload is bundled.
 * See shared-ui.js.
 */
const { modulesUsedBy, sharedFile } = require('./shared-ui')

module.exports = async function ({ workspace, taskUtil, options }) {
  const namespace = options.projectNamespace
  const sources = await workspace.byGlob('/**/*.{js,ts,xml,json}')
  const texts = await Promise.all(sources.filter((r) => !r.getPath().includes('/shared/')).map((r) => r.getString()))
  for (const file of modulesUsedBy(texts)) {
    await workspace.write(taskUtil.resourceFactory.createResource({ path: `/resources/${namespace}/shared/${file}`, string: sharedFile(file) }))
  }
}
