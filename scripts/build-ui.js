#!/usr/bin/env node
/**
 * Builds all UI5 apps (ui5 build -> app/<name>/dist). Each build also writes the zip that is uploaded to
 * the HTML5 Application Repository (ui5-task-zipper, e.g. dist/comaemsuitebrokers.zip).
 * The MTA build does the same per html5 module; this script is for checking the builds locally.
 *
 *   node scripts/build-ui.js
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const appDir = path.resolve(__dirname, '..', 'app')
const apps = fs
  .readdirSync(appDir)
  .filter((d) => fs.existsSync(path.join(appDir, d, 'ui5.yaml')))
  .sort()

function fail(message) {
  console.error(`\nbuild-ui: ${message}`)
  process.exit(1)
}

for (const app of apps) {
  console.log(`\n> ui5 build ${app}`)
  const r = spawnSync('npx', ['ui5', 'build', '--clean-dest', '--dest', 'dist'], {
    cwd: path.join(appDir, app),
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  if (r.error) fail(`${app}: ui5 could not be started (${r.error.message})`)
  if (r.status !== 0) fail(`${app}: ui5 build failed (exit code ${r.status ?? r.signal})`)
  const zips = fs.readdirSync(path.join(appDir, app, 'dist')).filter((f) => f.endsWith('.zip'))
  if (!zips.length) fail(`${app}: no zip in dist - is ui5-task-zipper configured in ui5.yaml?`)
  console.log(`  -> app/${app}/dist/${zips.join(', ')}`)
}
