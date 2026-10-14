#!/usr/bin/env node
/**
 * Builds all UI5 apps (ui5 build -> app/<name>/dist) and assembles them, together
 * with the launchpad page, into app/router/resources for the standalone approuter.
 *
 *   node scripts/build-ui.js            build + assemble
 *   node scripts/build-ui.js --no-build only assemble existing dist folders
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const appDir = path.join(root, 'app')
const target = path.join(appDir, 'router', 'resources')
const apps = fs
  .readdirSync(appDir)
  .filter((d) => fs.existsSync(path.join(appDir, d, 'ui5.yaml')))
  .sort()

if (!process.argv.includes('--no-build')) {
  for (const app of apps) {
    console.log(`\n> ui5 build ${app}`)
    const r = spawnSync('npx', ['ui5', 'build', '--clean-dest', '--dest', 'dist'], {
      cwd: path.join(appDir, app),
      stdio: 'inherit',
      shell: process.platform === 'win32'
    })
    if (r.status !== 0) process.exit(r.status ?? 1)
  }
}

fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })
for (const app of apps) {
  const dist = path.join(appDir, app, 'dist')
  if (!fs.existsSync(dist)) throw new Error(`Missing ${dist} - run without --no-build`)
  fs.cpSync(dist, path.join(target, app), { recursive: true })
}
fs.copyFileSync(path.join(appDir, 'launchpad.html'), path.join(target, 'launchpad.html'))
fs.cpSync(path.join(appDir, 'appconfig'), path.join(target, 'appconfig'), { recursive: true })
console.log(`\nAssembled ${apps.length} apps into ${path.relative(root, target)}: ${apps.join(', ')}`)
