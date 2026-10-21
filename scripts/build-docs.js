#!/usr/bin/env node
/**
 * Copies the user guide next to the built server (gen/srv/docs), where the Help service reads it at runtime
 * (srv/lib/help-content.ts). Run after `cds build --production`; during development the file is read from docs/.
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'docs', 'user-guide.md')
const target = path.join(root, 'gen', 'srv', 'docs', 'user-guide.md')

if (!fs.existsSync(source)) throw new Error(`User guide not found: ${source}`)
if (!fs.existsSync(path.join(root, 'gen', 'srv'))) throw new Error('gen/srv not found - run "cds build --production" first')

fs.mkdirSync(path.dirname(target), { recursive: true })
fs.copyFileSync(source, target)
console.log(`Copied ${path.relative(root, source)} to ${path.relative(root, target)}`)

// the pictures of the guide (docs/images)
const images = path.join(root, 'docs', 'images')
if (fs.existsSync(images)) {
  fs.cpSync(images, path.join(path.dirname(target), 'images'), { recursive: true })
  console.log(`Copied ${path.relative(root, images)} to ${path.relative(root, path.join(path.dirname(target), 'images'))}`)
}
