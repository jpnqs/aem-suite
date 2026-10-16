import { test, expect } from '@playwright/test'
import { apps, openApp, expectAppOpen } from './launchpad'

// The Number Ranges app (admin): define a range, see what its numbers look like, use the preview, reset.

test.describe('Number Ranges', () => {
  test('creates a range and shows how its numbers look', async ({ page }) => {
    await openApp(page, apps.numberRanges)
    await expectAppOpen(page, apps.numberRanges)
    await page.getByRole('button', { name: 'Create' }).click()

    // the object page (the list report's filter bar has a Name field, too)
    const form = page.locator('[id*="NumberRangesObjectPage"]')
    await form.getByLabel('Name', { exact: true }).fill('E2E_ORDERS')
    await form.getByLabel('Prefix').fill('SO-')
    await form.getByLabel('First Number').fill('4500')
    // new range: the footer button of the draft is "Create"
    await page.getByRole('button', { name: 'Create', exact: true }).last().click()

    // saved: header status shows the next number, nothing issued yet
    await expect(page.getByText('SO-004500').locator('visible=true').first()).toBeVisible()
  })

  test('a test case preview shows the next number without using it up', async ({ page, request }) => {
    // its own range, so the test does not depend on the one the other test creates (tests run in parallel)
    const range = await (await request.post('/odata/v4/admin/NumberRanges', { data: { name: 'E2E_PREVIEW', prefix: 'SO-', length: 6, start: 4500 } })).json()
    expect((await request.post(`/odata/v4/admin/NumberRanges(ID=${range.ID},IsActiveEntity=false)/AdminService.draftActivate`, { data: {} })).ok()).toBe(true)
    const created = await request.post('/odata/v4/test/TestCases', { data: { name: 'e2e number', topic: 'e2e/{{numberRange.E2E_PREVIEW}}', payload: '{"id":"{{numberRange.E2E_PREVIEW}}"}', deliveryMode: 'PERSISTENT' } })
    const { ID } = await created.json()
    expect((await request.post(`/odata/v4/test/TestCases(ID=${ID},IsActiveEntity=false)/TestService.draftActivate`, { data: {} })).ok()).toBe(true)
    for (let i = 0; i < 2; i++) {
      const res = await request.post(`/odata/v4/test/TestCases(ID=${ID},IsActiveEntity=true)/TestService.preview`, { data: {} })
      const preview = await res.json()
      expect(preview.topic).toBe('e2e/SO-004500')
    }
  })
})
