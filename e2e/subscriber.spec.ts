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
})
