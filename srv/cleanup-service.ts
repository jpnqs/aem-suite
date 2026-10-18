import cds from '@sap/cds'
import type { CategoryCount } from './lib/cleanup/cleanup'
import { execute, preview } from './lib/cleanup/cleanup'
import { CleanupRequest, selectionsOf } from './lib/cleanup/categories'
import { HttpError } from './lib/core/errors'

export default class CleanupService extends cds.ApplicationService {
  async init() {
    const { CleanupRules } = this.entities

    this.on('preview', (req) => preview((req.data as { request?: CleanupRequest }).request))

    this.on('execute', (req) => {
      const { request, expected, ruleName } = req.data as { request?: CleanupRequest; expected?: CategoryCount[]; ruleName?: string }
      return execute(request, expected, ruleName)
    })

    this.on('users', async () => {
      const names = new Set<string>()
      for (const entity of ['TestRuns', 'ReceivedMessages', 'SubscriberPresets']) {
        const rows = (await SELECT.distinct.from(`aem.suite.${entity}`).columns('createdBy')) as { createdBy: string | null }[]
        for (const r of rows) if (r.createdBy) names.add(r.createdBy)
      }
      return [...names].sort((a, b) => a.localeCompare(b))
    })

    // a saved rule must hold a request that a cleanup would take
    this.before(['CREATE', 'UPDATE'], CleanupRules, async (req) => {
      const { request } = req.data as { request?: string | null }
      if (request === undefined && req.event === 'UPDATE') return
      let parsed: CleanupRequest
      try {
        parsed = JSON.parse(request ?? '') as CleanupRequest
      } catch {
        return req.reject(400, 'The selection of the rule is no valid JSON', 'request')
      }
      try {
        await selectionsOf(parsed)
      } catch (e) {
        if (e instanceof HttpError) return req.reject(400, e.message, 'request')
        throw e
      }
    })

    return super.init()
  }
}
