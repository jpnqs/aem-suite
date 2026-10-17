/**
 * The UI modules all apps share (app/_shared) and which of them an app uses. Each HTML5 app is deployed on its
 * own, so every app needs the modules under its own namespace (com/aem/suite/<app>/shared/...). They are not
 * copied into the apps: the UI5 build adds them (shared-ui-task.js) and the dev server serves them
 * (shared-ui-middleware.js) - so `cds watch`, `ui5 build` and the MTA build need no extra step.
 *
 * An app gets the modules its own files name (".../shared/Help", "com.aem.suite.runs.shared.Help" in a
 * manifest) plus what those modules load themselves ("./Navigation").
 */
const fs = require('node:fs')
const path = require('node:path')

const sharedDir = path.resolve(__dirname, '..', '..', 'app', '_shared')

/** "MyEntriesFilter.controller.js" -> "MyEntriesFilter" */
const moduleOf = (file) => file.split('.')[0]

/** The runtime files of app/_shared (the .d.ts files are only for the TypeScript compiler). */
function sharedFiles() {
  return fs.readdirSync(sharedDir).filter((f) => f.endsWith('.js'))
}

/** The shared modules that these texts (the app's sources) name, with the modules they depend on. */
function modulesUsedBy(texts) {
  const files = sharedFiles()
  const known = new Set(files.map(moduleOf))
  const used = new Set()
  for (const text of texts) for (const [, name] of text.matchAll(/shared[/.]([A-Z]\w*)/g)) if (known.has(name)) used.add(name)
  // dependencies between the shared modules: sap.ui.define(["./Navigation", ...])
  const queue = [...used]
  while (queue.length) {
    const name = queue.pop()
    for (const file of files.filter((f) => moduleOf(f) === name))
      for (const [, dep] of fs.readFileSync(path.join(sharedDir, file), 'utf8').matchAll(/"\.\/([A-Z]\w*)"/g))
        if (known.has(dep) && !used.has(dep)) used.add(dep), queue.push(dep)
  }
  return files.filter((f) => used.has(moduleOf(f)))
}

/** The content of a shared file, or undefined if there is none of that name. */
function sharedFile(file) {
  if (!sharedFiles().includes(file)) return undefined
  return fs.readFileSync(path.join(sharedDir, file), 'utf8')
}

module.exports = { modulesUsedBy, sharedFile, sharedFiles }
