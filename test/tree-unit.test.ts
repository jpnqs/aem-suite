import { Tree } from '../srv/lib/testcases/tree'

// The in-memory tree without a server (hierarchy queries, moves and folder runs: tree.test.ts).

describe('Tree helper', () => {
  const t = new Tree([
    { ID: 'f1', parent_ID: null, kind: 'FOLDER', name: 'A', sortOrder: 20 },
    { ID: 't1', parent_ID: null, kind: 'TEST', name: 'root test', sortOrder: 10 },
    { ID: 'f2', parent_ID: 'f1', kind: 'FOLDER', name: 'B', sortOrder: 10 },
    { ID: 't2', parent_ID: 'f2', kind: 'TEST', name: 'x', sortOrder: 20 },
    { ID: 't3', parent_ID: 'f2', kind: 'TEST', name: 'y', sortOrder: 10 },
    { ID: 't4', parent_ID: 'f1', kind: 'TEST', name: 'z', sortOrder: 5 }
  ])

  it('expands folders in tree order (folders first, then manual order)', () => {
    expect(t.expandToTests(['f1'])).toEqual(['t3', 't2', 't4'])
    expect(t.expandToTests(['t1', 'f2', 't3'])).toEqual(['t1', 't3', 't2'])
  })

  it('knows ancestors and containment', () => {
    expect(t.ancestors('t2').map((n) => n.ID)).toEqual(['f1', 'f2'])
    expect(t.isWithin('t2', 'f1')).toBe(true)
    expect(t.isWithin('f1', 'f2')).toBe(false)
  })
})
