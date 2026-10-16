import path from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { outdated } = require(path.join(__dirname, '..', 'scripts', 'sync-shared-ui.js')) as {
  outdated(): { stale: [string, string][]; orphans: string[] }
}

describe('shared UI modules (app/_shared)', () => {
  it('every app has an up-to-date copy - run "npm run sync:ui" after changing app/_shared', () => {
    const { stale, orphans } = outdated()
    expect(stale.map(([file]) => path.relative(process.cwd(), file))).toEqual([])
    expect(orphans.map((file) => path.relative(process.cwd(), file))).toEqual([])
  })
})
