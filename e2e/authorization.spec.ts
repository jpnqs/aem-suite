import { test, expect } from '@playwright/test'
import { apps, openApp, expectAppOpen, expectLoadError } from './launchpad'

// role Tester only: the tester apps work, the admin apps cannot load their service
test.use({ httpCredentials: { username: 'tester', password: 'tester' } })

test.describe('authorization (tester)', () => {
  for (const app of [apps.home, apps.testCases, apps.runs, apps.subscriber, apps.messages, apps.help]) {
    test(`opens ${app.title}`, async ({ page }) => {
      await openApp(page, app)
      await expectAppOpen(page, app)
    })
  }

  for (const app of [apps.brokers, apps.variables]) {
    test(`cannot open ${app.title}`, async ({ page }) => {
      await openApp(page, app)
      await expectLoadError(page)
    })
  }

  test('admin service is forbidden', async ({ request }) => {
    expect((await request.get('/odata/v4/admin/Brokers')).status()).toBe(403)
  })
})
