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
    for (const name of ['Test Runs', 'Live Subscriber', 'Saved Messages', 'Brokers', 'Global Variables', 'Number Ranges', 'Data Cleanup']) await expect(tile(page, name)).toBeVisible()
    // the tiles are grouped by role: the apps for testers first, then the ones for administrators
    const testing = page.locator('.aemHomeGroup').filter({ has: page.getByRole('heading', { name: 'Testing' }) })
    const admin = page.locator('.aemHomeGroup').filter({ has: page.getByRole('heading', { name: 'Administration' }) })
    for (const name of ['Test Cases', 'Test Runs', 'Live Subscriber', 'Saved Messages']) await expect(testing.locator('.aemHomeTile').and(page.getByRole('region', { name, exact: true }))).toBeVisible()
    for (const name of ['Brokers', 'Global Variables', 'Number Ranges', 'Data Cleanup']) await expect(admin.locator('.aemHomeTile').and(page.getByRole('region', { name, exact: true }))).toBeVisible()
    await expect(page.locator('.aemHomeGroup')).toHaveCount(2)
    // Help is the button of the page, not a tile
    await expect(tile(page, 'Help')).toHaveCount(0)
    await expect(page.getByText('Latest Runs')).toBeVisible()
  })

  test('a notice can be dismissed with OK, stays hidden, and comes back with "Show again"', async ({ page, request }) => {
    // no local broker: the connection test fails and the broker is marked as failing - a notice on the start page
    const LOCAL_DOCKER = 'b1000000-0000-4000-8000-000000000001'
    await request.post(`/odata/v4/admin/Brokers(ID=${LOCAL_DOCKER},IsActiveEntity=true)/AdminService.testConnection`, { data: { password: 'wrong' } })

    await openApp(page, apps.home)
    await expectAppOpen(page, apps.home)
    const notice = page.getByText('Broker "local-docker" failed its last connection test')
    await expect(notice).toBeVisible()

    await page.getByRole('listitem').filter({ has: notice }).getByRole('button', { name: 'OK' }).click()
    await expect(notice).toHaveCount(0)
    await expect(page.getByText(/^[0-9]+ notices? hidden[.]$/)).toBeVisible()
    // not the "all good" line: the broker is still failing

    // stays hidden after a reload (remembered in this browser)
    await page.reload()
    await expectAppOpen(page, apps.home)
    await expect(page.getByText(/^Good (morning|afternoon|evening), admin$/)).toBeVisible()
    await expect(notice).toHaveCount(0)

    await page.getByRole('link', { name: 'Show again' }).click()
    await expect(notice).toBeVisible()
    await expect(page.getByText(/notices? hidden[.]/)).toHaveCount(0)
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
    // the apps for role Tester (app/_shared/Apps.js), in one group, without the admin apps
    const testerApps = ['Test Cases', 'Test Runs', 'Live Subscriber', 'Saved Messages']
    for (const name of testerApps) await expect(tile(page, name)).toBeVisible()
    await expect(page.locator('.aemHomeTile')).toHaveCount(testerApps.length)
    await expect(page.getByRole('heading', { name: 'Testing' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Administration' })).toHaveCount(0)
    await expect(tile(page, 'Global Variables')).toHaveCount(0)
  })
})
