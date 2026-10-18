import { defaultSelection, fromRequest, hasSelection, toRequest } from '../app/cleanup/webapp/util/CleanupRequest'

// The selection of the Data Cleanup app (app/cleanup/webapp/util/CleanupRequest.ts) - plain functions, no UI5.

describe('cleanup app selection', () => {
  it('sends nothing while no category is switched on', () => {
    expect(toRequest(defaultSelection())).toEqual({})
    expect(hasSelection(defaultSelection())).toBe(false)
  })

  it('sends the switched-on categories with the filled criteria only', () => {
    const s = defaultSelection()
    s.runs.enabled = true
    s.runs.outcomes = ['PASSED']
    s.runs.summaryContains = '  nightly '
    s.messages.enabled = true
    s.messages.age = { mode: 'BEFORE', value: 6, unit: 'MONTHS', before: '2026-01-01' }
    s.orphans.stats = true
    expect(toRequest(s)).toEqual({
      runs: { age: { value: 3, unit: 'MONTHS' }, outcomes: ['PASSED'], summaryContains: 'nightly' },
      messages: { age: { before: '2026-01-01' } },
      orphans: { stats: true }
    })
    expect(hasSelection(s)).toBe(true)
  })

  it('reads a saved request back into the same selection', () => {
    const s = defaultSelection()
    s.runPayloads.enabled = true
    s.runPayloads.keepNewest = 5
    s.runPayloads.brokerIds = ['b1']
    s.presets.enabled = true
    s.presets.inactiveBroker = true
    s.orphans.variables = true
    const json = JSON.parse(JSON.stringify(toRequest(s)))
    expect(fromRequest(json)).toEqual(s)
    expect(toRequest(fromRequest(json))).toEqual(json)
  })

  it('falls back to the defaults for missing or broken parts', () => {
    expect(fromRequest(null)).toEqual(defaultSelection())
    const s = fromRequest({ runs: { age: { value: 0 } }, orphans: { messages: 1 as never } })
    expect(s.runs).toMatchObject({ enabled: true, age: defaultSelection().runs.age, outcomes: [] })
    expect(s.orphans.messages).toBe(true)
  })
})
