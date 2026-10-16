import { test, expect } from '@playwright/test'
import { apps, expectAppOpen, openApp } from './launchpad'

// The start page: greeting, what needs attention, one tile per app the user may open, the latest runs.

/** an app tile, by its title (each tile is a card region named after its title) */
const tile = (page: import('@playwright/test').Page, name: string) => page.locator('.aemHomeTile').and(page.getByRole('region', { name, exact: true }))

test.describe('home (admin)', () => {
  test('greets the user and shows a tile for every app', async ({ page }) => {
    await openApp(page, apps.home)
    await expectAppOpen(page, apps.home)
    await expect(page.getByText(/^Good (morning|afternoon|evening), admin$/)).toBeVisible()
    // either something needs attention or all is well - never neither
    await expect(page.getByText('Needs attention').or(page.getByText(/^All good/))).toBeVisible()
    // demo data: test/data/aem.suite-TestCases.csv
    await expect(tile(page, 'Test Cases').getByText(/^\d+ test cases$/)).toBeVisible()
    for (const name of ['Test Runs', 'Live Subscriber', 'Saved Messages', 'Brokers', 'Global Variables', 'Help']) await expect(tile(page, name)).toBeVisible()
    await expect(page.getByText('Latest Runs')).toBeVisible()
  })

  test('a tile opens its app', async ({ page }) => {
    await openApp(page, apps.home)
    await tile(page, 'Global Variables').getByText('Global Variables').click()
    await expect(page).toHaveURL(new RegExp(`#${apps.variables.intent}`))
    await expectAppOpen(page, apps.variables)
  })
})

test.describe('home (tester)', () => {
  test.use({ httpCredentials: { username: 'tester', password: 'tester' } })

  test('shows only the apps the tester can open', async ({ page }) => {
    await openApp(page, apps.home)
    await expectAppOpen(page, apps.home)
    await expect(tile(page, 'Test Cases')).toBeVisible()
    await expect(page.locator('.aemHomeTile')).toHaveCount(5)
    await expect(tile(page, 'Global Variables')).toHaveCount(0)
  })
})
