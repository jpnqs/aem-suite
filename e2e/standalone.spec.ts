import { test, expect } from '@playwright/test'
import { apps, openApp, expectAppOpen } from './launchpad'

// The apps also run on their own (outside the launchpad): links to other apps must point to the sibling app
// (/comaemsuite<app>/ - in the HTML5 repo the same), not to paths that only exist in the launchpad.

test.describe('apps opened directly (standalone)', () => {
  test('Help opens the matching section of the Help app', async ({ page, context }) => {
    await page.goto('/comaemsuitebrokers/index.html')
    await expect(page.getByText('local-docker', { exact: true }).first()).toBeVisible()
    const [help] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Help' }).first().click()])
    await expect(help).toHaveURL(/\/comaemsuitehelp\/index\.html#\/2-set-up-brokers-admin$/)
    await expect(help.getByRole('heading', { name: '2. Set up brokers (Admin)' })).toBeVisible()
  })

  test('the Live Subscriber opens Help as well', async ({ page, context }) => {
    await page.goto('/comaemsuitesubscriber/index.html')
    const [help] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Help' }).first().click()])
    await expect(help).toHaveURL(/\/comaemsuitehelp\/index\.html#\/8-watch-messages-live-live-subscriber$/)
  })
})

test.describe('apps in the launchpad', () => {
  test('Help opens the Help app through its intent in a new tab', async ({ page, context }) => {
    await openApp(page, apps.variables)
    await expectAppOpen(page, apps.variables)
    const [help] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Help' }).first().click()])
    await expect(help).toHaveURL(/#AEMSuiteHelp-display&\/3-global-variables-admin$/)
    await expect(help.getByRole('heading', { name: '3. Global variables (Admin)' })).toBeVisible()
  })
})
