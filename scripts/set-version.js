#!/usr/bin/env node
/**
 * The version of the suite is written in many files: mta.yaml, the root package.json (and its lockfile), the
 * package.json of every app and the sap.app.applicationVersion of every manifest. This script sets one version in
 * all of them; test/version.test.ts fails when they differ.
 *
 *   node scripts/set-version.js 1.1.0     write 1.1.0 everywhere
 *   node scripts/set-version.js --check   only report files with another version than package.json (exit code 1)
 *
 * The files are edited as text (only the version is replaced), so their formatting stays as it is.
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const appDir = path.join(root, 'app')
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

/** [file, pattern] - the pattern's first group is the version. */
function places() {
  const list = [
    [path.join(root, 'mta.yaml'), /^version: (\S+)$/m],
    [path.join(root, 'package.json'), /^ {2}"version": "([^"]+)"/m],
    // the lockfile repeats the root package's version twice (top level and packages[""])
    [path.join(root, 'package-lock.json'), /^ {2}"version": "([^"]+)"/m],
    [path.join(root, 'package-lock.json'), /^ {4}"": \{\n {6}"name": "aem-suite",\n {6}"version": "([^"]+)"/m]
  ]
  for (const app of fs.readdirSync(appDir)) {
    const pkg = path.join(appDir, app, 'package.json')
    if (fs.existsSync(pkg) && /^ {2}"version": /m.test(fs.readFileSync(pkg, 'utf8'))) list.push([pkg, /^ {2}"version": "([^"]+)"/m])
    const manifest = path.join(appDir, app, 'webapp', 'manifest.json')
    if (fs.existsSync(manifest)) list.push([manifest, /"applicationVersion": \{\s*"version": "([^"]+)"/])
  }
  return list
}

/** The version a file has at the place, or undefined if the place is not found. */
function versionAt(file, pattern) {
  const m = pattern.exec(fs.readFileSync(file, 'utf8'))
  return m ? m[1] : undefined
}

/** Places that differ from `version` (or are missing). */
function differing(version) {
  return places()
    .map(([file, pattern]) => ({ file, found: versionAt(file, pattern) }))
    .filter((p) => p.found !== version)
}

function setVersion(version) {
  for (const [file, pattern] of places()) {
    const text = fs.readFileSync(file, 'utf8')
    const m = pattern.exec(text)
    if (!m) throw new Error(`No version found in ${path.relative(root, file)}`)
    const start = m.index + m[0].lastIndexOf(m[1])
    fs.writeFileSync(file, text.slice(0, start) + version + text.slice(start + m[1].length))
  }
}

if (require.main === module) {
  const arg = process.argv[2]
  const rel = (f) => path.relative(process.cwd(), f)
  if (arg === '--check') {
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
    const bad = differing(version)
    for (const p of bad) console.log(`${rel(p.file)}: ${p.found ?? 'no version'} (package.json: ${version})`)
    process.exit(bad.length ? 1 : 0)
  }
  if (!arg || !SEMVER.test(arg)) {
    console.error('Usage: node scripts/set-version.js <major.minor.patch> | --check')
    process.exit(2)
  }
  setVersion(arg)
  console.log(`version ${arg} set in ${places().length} places`)
}

module.exports = { differing, places }
