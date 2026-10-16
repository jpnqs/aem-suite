import { test, expect } from '@playwright/test'
import { apps, openApp, expectAppOpen } from './launchpad'

test.describe('Live Subscriber', () => {
  test('offers the demo brokers and asks for the password of the maintained user', async ({ page }) => {
    await openApp(page, apps.subscriber)
    await expectAppOpen(page, apps.subscriber)
    await expect(page.getByText('Not listening yet').first()).toBeVisible()
    await expect(page.getByText('Password for aem-suite').first()).toBeVisible()
  })

  test('connects the live socket relative to the app', async ({ page }) => {
    // the app-relative ws/ path is what the app's xs-app.json routes to the backend in BTP
    const socket = page.waitForEvent('websocket', (ws) => ws.url().includes('/comaemsuitesubscriber/ws/live'))
    await openApp(page, apps.subscriber)
    const ws = await socket
    await expectAppOpen(page, apps.subscriber)
    expect(ws.isClosed()).toBe(false)
  })

  test('saves a setup, loads it again and deletes it (no password in it)', async ({ page }) => {
    await openApp(page, apps.subscriber)
    await expectAppOpen(page, apps.subscriber)
    const topic = page.getByPlaceholder(/Add a topic/)
    for (const name of ['aem/orders/>', 'aem/events/*']) {
      await topic.fill(name)
      await page.getByRole('button', { name: 'Add' }).click()
    }
    await page.getByPlaceholder('Not stored').fill('secret-password')
    await page.getByRole('button', { name: 'Save as…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save setup' })
    await dialog.getByRole('textbox').fill('E2E orders')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Setup "E2E orders" saved')).toBeVisible()

    // what was stored: topics yes, password nowhere
    const res = await page.request.get(`/odata/v4/subscribe/SubscriberPresets?$filter=${encodeURIComponent("name eq 'E2E orders'")}`)
    const [preset] = (await res.json()).value
    expect(JSON.parse(preset.topics)).toEqual(['aem/orders/>', 'aem/events/*'])
    expect(JSON.stringify(preset)).not.toContain('secret-password')

    // a fresh page: pick the setup and the topics are back
    await openApp(page, apps.subscriber)
    await expectAppOpen(page, apps.subscriber)
    await page.locator('[id$="preset"]').click()
    await page.getByRole('option', { name: 'E2E orders' }).click()
    await expect(page.getByText('aem/orders/>', { exact: true })).toBeVisible()
    await expect(page.getByText('aem/events/*', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Delete the selected setup' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Setup "E2E orders" deleted')).toBeVisible()
  })
})
