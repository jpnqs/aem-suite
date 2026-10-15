#!/usr/bin/env node
/**
 * Copies the UI modules all apps share (app/_shared) into each app (app/<name>/webapp/shared), where the app
 * loads them under its own namespace (com/aem/suite/<name>/shared/...). Each HTML5 app is deployed on its own,
 * so a copy per app is what lets them share code. The copies are committed, so `cds watch` and the MTA build
 * need no extra step; test/shared-ui.test.ts fails when a copy is out of date.
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

/** [target file, expected content] for every copy. */
function plannedCopies() {
  const apps = fs
    .readdirSync(appDir)
    .filter((d) => !SKIP.includes(d) && fs.existsSync(path.join(appDir, d, 'ui5.yaml')))
  const files = fs.readdirSync(sharedDir)
  return apps.flatMap((app) => {
    const isTs = fs.existsSync(path.join(appDir, app, 'tsconfig.json'))
    return files
      .filter((f) => isTs || !f.endsWith('.d.ts'))
      .map((f) => [path.join(appDir, app, 'webapp', 'shared', f), HEADER + fs.readFileSync(path.join(sharedDir, f), 'utf8')])
  })
}

/** Copies that are missing or differ, plus files in shared/ folders that have no original (anymore). */
function outdated() {
  const planned = plannedCopies()
  const expected = new Set(planned.map(([file]) => file))
  const stale = planned.filter(([file, content]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== content.replace(/\r\n/g, '\n'))
  const orphans = [...new Set(planned.map(([file]) => path.dirname(file)))]
    .flatMap((dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : []))
    .filter((f) => !expected.has(f))
  return { stale, orphans }
}

if (require.main === module) {
  const { stale, orphans } = outdated()
  const rel = (f) => path.relative(process.cwd(), f)
  if (process.argv.includes('--check')) {
    for (const [file] of stale) console.log(`outdated: ${rel(file)}`)
    for (const file of orphans) console.log(`no original: ${rel(file)}`)
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
  }
}

module.exports = { outdated }
