import { test, expect, type Page } from '@playwright/test'
import { apps, openApp, expectAppOpen } from './launchpad'

// "Test Connection" of the Brokers app (app/brokers/webapp/ext/ConnectionTest.js): direct brokers ask for the
// password in a masked field, destination brokers are tested without a dialog. No broker runs here, so every
// test ends with "connection failed" - what matters is the way there.

/** the demo brokers of test/data/aem.suite-Brokers.csv */
const LOCAL_DOCKER = 'b1000000-0000-4000-8000-000000000001'
const ASK_FOR_USER = 'b1000000-0000-4000-8000-000000000003'
const DESTINATION = 'b1000000-0000-4000-8000-000000000002'

async function openBroker(page: Page, id: string) {
  await page.goto(`/launchpad.html#${apps.brokers.intent}&/Brokers(ID=${id},IsActiveEntity=true)`)
  await expect(page).toHaveTitle(/ - Broker$/)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  // with a long title, the header actions move into the overflow menu
  const button = page.getByRole('button', { name: 'Test Connection', exact: true })
  if (!(await button.isVisible())) await page.getByRole('button', { name: 'Additional Options' }).click()
  await button.click()
}

test.describe('broker connection test', () => {
  test('asks a direct broker for the password only, in a masked field', async ({ page }) => {
    await openBroker(page, LOCAL_DOCKER)
    const dialog = page.getByRole('dialog', { name: 'Test Connection: local-docker' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('input')).toHaveCount(1)
    const password = dialog.getByPlaceholder('Password')
    await expect(password).toHaveAttribute('type', 'password')
    await password.fill('wrong')
    await dialog.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toContainText('local-docker: connection failed')
  })

  test('asks for the username too if the broker has none', async ({ page }) => {
    await openBroker(page, ASK_FOR_USER)
    const dialog = page.getByRole('dialog', { name: 'Test Connection: local-docker (ask for user)' })
    await expect(dialog.getByPlaceholder('Username')).toBeVisible()
    await expect(dialog.getByPlaceholder('Password')).toHaveAttribute('type', 'password')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('tests a destination broker without a dialog', async ({ page }) => {
    await openBroker(page, DESTINATION)
    await expect(page.getByRole('alertdialog')).toContainText('aem-dev (destination): connection failed')
    await expect(page.getByPlaceholder('Password')).toHaveCount(0)
  })

  test('tests the brokers selected in the list', async ({ page }) => {
    await openApp(page, apps.brokers)
    await expectAppOpen(page, apps.brokers)
    await page.getByRole('row').filter({ hasText: 'aem-dev (destination)' }).getByRole('checkbox').click()
    await page.getByRole('button', { name: 'Test Connection', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toContainText('aem-dev (destination): connection failed')
  })
})
