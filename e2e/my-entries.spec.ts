import { test, expect } from '@playwright/test'
import { apps, openApp, expectAppOpen } from './launchpad'

// Lists that are about the user's own work start filtered to the logged-in user (app/_shared/MyEntriesFilter).

test.describe('"my entries" filter', () => {
  for (const [app, field] of [
    [apps.testCases, 'createdBy'],
    [apps.runs, 'runStartedBy']
  ] as const) {
    test(`${app.title} starts with ${field} = the logged-in user`, async ({ page }) => {
      await openApp(page, app)
      await expectAppOpen(page, app)
      // a multi value field: the condition is a token ("=admin") next to the input
      await expect(page.locator(`[id$="FilterField::${field}"]`).first()).toContainText('=admin')
    })
  }
})
