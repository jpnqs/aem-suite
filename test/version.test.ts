import fs from 'node:fs'
import path from 'node:path'

// One version for the whole suite - set it with `node scripts/set-version.js <version>`.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { differing, places } = require(path.join(__dirname, '..', 'scripts', 'set-version.js')) as {
  differing(version: string): { file: string; found?: string }[]
  places(): unknown[]
}

describe('version', () => {
  it('is the same in mta.yaml, every package.json and every manifest', () => {
    const version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version
    expect(places().length).toBeGreaterThan(20)
    expect(differing(version).map((p) => `${path.relative(process.cwd(), p.file)}: ${p.found}`)).toEqual([])
  })
})
