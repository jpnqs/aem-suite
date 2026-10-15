import { test, expect } from '@playwright/test'
import { apps, expectAppOpen } from './launchpad'

test.describe('launchpad', () => {
  test('shows one tile per app and none of the sandbox samples', async ({ page }) => {
    await page.goto('/launchpad.html')
    await expect(page).toHaveURL(/\/comaemsuitelaunchpad\/index\.html/)
    for (const app of Object.values(apps)) await expect(page.getByText(app.title, { exact: true })).toBeVisible()
    await expect(page.getByText('Sample Applications')).toHaveCount(0)
  })

  test('a tile opens its app', async ({ page }) => {
    await page.goto('/launchpad.html')
    await page.getByText(apps.help.title, { exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`#${apps.help.intent}`))
    await expectAppOpen(page, apps.help)
  })
})
