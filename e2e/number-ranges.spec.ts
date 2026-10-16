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

  test('the demo test case "Order with document numbers" resolves with the demo ranges', async ({ request }) => {
    // test/data: ranges ORDERS, DELIVERIES, INVOICES and the test case in the folder Orders
    const found = await (await request.get('/odata/v4/test/TestCases?$select=ID&$filter=' + encodeURIComponent("name eq 'Order with document numbers'"))).json()
    const brokers = await (await request.get('/odata/v4/test/Brokers?$select=ID&$filter=' + encodeURIComponent("name eq 'local-docker'"))).json()
    const res = await request.post(`/odata/v4/test/TestCases(ID=${found.value[0].ID},IsActiveEntity=true)/TestService.preview`, { data: { brokerId: brokers.value[0].ID } })
    const preview = await res.json()
    expect(preview.valid).toBe(true)
    const payload = JSON.parse(preview.payload)
    expect(payload.orderNumber).toMatch(/^SO-[0-9]{10}$/)
    // the temporary variable: the same number in topic, payload, correlation ID and property
    expect(payload.reference).toBe(payload.orderNumber)
    expect(payload.items[0].order).toBe(payload.orderNumber)
    expect(preview.topic.endsWith(payload.orderNumber)).toBe(true)
    expect(preview.correlationId).toBe(payload.orderNumber)
    expect(JSON.parse(preview.userProperties).orderNumber).toBe(payload.orderNumber)
    // faker test data (and its temporary variable name is not left over in the text)
    expect(payload.customer.email).toContain('@')
    expect(payload.customer.name).not.toContain('{{')
    expect(payload.customer.city.length).toBeGreaterThan(0)
    expect(payload.delivery).toMatch(/^00[0-9]{8}$/)
    expect(payload.invoice).toMatch(/^INV-[0-9]{5}[/]26$/)
  })
})
