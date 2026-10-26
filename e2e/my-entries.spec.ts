import { test, expect } from '@playwright/test'
import { apps, openApp, expectAppOpen } from './launchpad'

// Lists that are about the user's own work start with the entries of the logged-in user.

test.describe('"my entries"', () => {
  test('Test Runs start with Started By = the logged-in user (app/_shared/MyEntriesFilter)', async ({ page }) => {
    await openApp(page, apps.runs)
    await expectAppOpen(page, apps.runs)
    // a multi value field: the condition is a token next to the input - "=admin", or the user's name once the
    // value help knows it (mocked users have none, so the id)
    await expect(page.locator('[id$="FilterField::runStartedBy"]').first()).toContainText(/=?admin/)
  })

  test('Test Cases start with the quick variant "My Test Cases", "All Test Cases" shows the others too', async ({ page }) => {
    await openApp(page, apps.testCases)
    await expectAppOpen(page, apps.testCases)
    const mine = page.getByRole('option', { name: 'My Test Cases' })
    await expect(mine).toHaveAttribute('aria-selected', 'true')
    // no "Created By" condition: the quick variant filters
    await expect(page.locator('[id$="FilterField::createdBy"]').first()).not.toContainText('admin')
    await page.getByRole('option', { name: 'All Test Cases' }).click()
    await expect(page.getByRole('option', { name: 'All Test Cases' })).toHaveAttribute('aria-selected', 'true')
  })
})
