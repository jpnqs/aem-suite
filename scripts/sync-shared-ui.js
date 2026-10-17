#!/usr/bin/env node
/**
 * Copies the UI modules all apps share (app/_shared) into each app (app/<name>/webapp/shared), where the app
 * loads them under its own namespace (com/aem/suite/<name>/shared/...). Each HTML5 app is deployed on its own,
 * so a copy per app is what lets them share code. The copies are committed, so `cds watch` and the MTA build
 * need no extra step; test/shared-ui.test.ts fails when a copy is out of date.
 *
 * An app only gets the modules it uses: the ones its own files name (".../shared/Help", "com.aem.suite.runs.shared.Help"
 * in a manifest) plus what those modules load themselves ("./Navigation"). TypeScript apps also get the .d.ts files.
 *
 *   node scripts/sync-shared-ui.js           write the copies
 *   node scripts/sync-shared-ui.js --check   only report outdated copies (exit code 1)
 */
const fs = require('node:fs')
const path = require('node:path')

const appDir = path.resolve(__dirname, '..', 'app')
const sharedDir = path.join(appDir, '_shared')
const HEADER = '// GENERATED from app/_shared by scripts/sync-shared-ui.js - edit the original there, then run npm run sync:ui\n'
/** the launchpad only hosts the other apps */
const SKIP = ['launchpad']
const SOURCE = /\.(js|ts|json|xml)$/

/** "MyEntriesFilter.controller.js" -> "MyEntriesFilter" */
const moduleOf = (file) => file.split('.')[0]

/** The files of the app (without its shared/ copies), recursively. */
function appFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'shared' && dir.endsWith('webapp') ? [] : appFiles(file)
    return SOURCE.test(e.name) ? [file] : []
  })
}

/** The shared modules the app uses, with the modules they depend on. */
function modulesUsedBy(app, sharedFiles) {
  const known = new Set(sharedFiles.map(moduleOf))
  const used = new Set()
  for (const file of appFiles(path.join(appDir, app, 'webapp')))
    for (const [, name] of fs.readFileSync(file, 'utf8').matchAll(/shared[/.]([A-Z]\w*)/g)) if (known.has(name)) used.add(name)
  // dependencies between the shared modules: sap.ui.define(["./Navigation", ...])
  const queue = [...used]
  while (queue.length) {
    const name = queue.pop()
    for (const file of sharedFiles.filter((f) => moduleOf(f) === name && f.endsWith('.js')))
      for (const [, dep] of fs.readFileSync(path.join(sharedDir, file), 'utf8').matchAll(/"\.\/([A-Z]\w*)"/g))
        if (known.has(dep) && !used.has(dep)) used.add(dep), queue.push(dep)
  }
  return used
}

const apps = () => fs.readdirSync(appDir).filter((d) => !SKIP.includes(d) && fs.existsSync(path.join(appDir, d, 'ui5.yaml')))
const sharedOf = (app) => path.join(appDir, app, 'webapp', 'shared')

/** [target file, expected content] for every copy. */
function plannedCopies() {
  const files = fs.readdirSync(sharedDir)
  return apps().flatMap((app) => {
    const isTs = fs.existsSync(path.join(appDir, app, 'tsconfig.json'))
    const used = modulesUsedBy(app, files)
    return files
      .filter((f) => used.has(moduleOf(f)) && (isTs || !f.endsWith('.d.ts')))
      // LF throughout: the header is LF, so an original checked out with CRLF would give a copy with mixed line endings
      .map((f) => [path.join(sharedOf(app), f), HEADER + fs.readFileSync(path.join(sharedDir, f), 'utf8').replace(/\r\n/g, '\n')])
  })
}

/** Copies that are missing or differ, plus files in shared/ folders that have no original (anymore) or are not used. */
function outdated() {
  const planned = plannedCopies()
  const expected = new Set(planned.map(([file]) => file))
  const stale = planned.filter(([file, content]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== content.replace(/\r\n/g, '\n'))
  const orphans = apps()
    .map(sharedOf)
    .flatMap((dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : []))
    .filter((f) => !expected.has(f))
  return { stale, orphans }
}

if (require.main === module) {
  const { stale, orphans } = outdated()
  const rel = (f) => path.relative(process.cwd(), f)
  if (process.argv.includes('--check')) {
    for (const [file] of stale) console.log(`outdated: ${rel(file)}`)
    for (const file of orphans) console.log(`not needed: ${rel(file)}`)
    process.exit(stale.length || orphans.length ? 1 : 0)
  }
  for (const [file, content] of stale) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    console.log(`wrote ${rel(file)}`)
  }
  for (const file of orphans) {
    fs.rmSync(file)
    console.log(`removed ${rel(file)}`)
    // an app that uses no shared module has no shared/ folder
    if (!fs.readdirSync(path.dirname(file)).length) fs.rmdirSync(path.dirname(file))
  }
}

module.exports = { outdated }
