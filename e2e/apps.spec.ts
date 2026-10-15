import { test, expect } from '@playwright/test'
import { apps, openApp, expectAppOpen } from './launchpad'

// Every app loads through the launchpad and shows the demo data from test/data
// (OData goes through the app-relative odata/ path, like in the HTML5 repo).

test.describe('apps (admin)', () => {
  test('Test Cases lists the demo folders and test cases', async ({ page }) => {
    await openApp(page, apps.testCases)
    await expectAppOpen(page, apps.testCases)
    for (const folder of ['Orders', 'Events', 'Notifications', 'ACL checks'])
      await expect(page.getByText(folder, { exact: true }).first()).toBeVisible()
    await expect(page.getByText('{{app}}/ping/{{broker.name}}').first()).toBeVisible()
  })

  test('Test Cases opens a test case by deep link', async ({ page }) => {
    // demo test case "Ping" (test/data/aem.suite-TestCases.csv)
    await page.goto(`/launchpad.html#${apps.testCases.intent}&/TestCases(ID=c1000000-0000-4000-8000-000000000002,IsActiveEntity=true)`)
    await expect(page).toHaveTitle('Ping ({{app}}/ping/{{broker.name}}) - Test Case')
    await expect(page.getByText('Valid JSON').first()).toBeVisible()
    await expect(page.getByText('"broker": "{{broker.name}}"').first()).toBeVisible()
  })

  test('Test Runs opens (no runs yet)', async ({ page }) => {
    await openApp(page, apps.runs)
    await expectAppOpen(page, apps.runs)
    await expect(page.getByText('No results found').first()).toBeVisible()
  })

  test('Saved Messages opens', async ({ page }) => {
    await openApp(page, apps.messages)
    await expectAppOpen(page, apps.messages)
    await expect(page.getByText('Create Test Case').first()).toBeVisible()
  })

  test('Brokers lists the demo brokers', async ({ page }) => {
    await openApp(page, apps.brokers)
    await expectAppOpen(page, apps.brokers)
    for (const broker of ['local-docker', 'local-docker (publisher)', 'local-docker (subscriber)', 'aem-dev (destination)'])
      await expect(page.getByText(broker, { exact: true }).first()).toBeVisible()
  })

  test('Global Variables lists the demo variables', async ({ page }) => {
    await openApp(page, apps.variables)
    await expectAppOpen(page, apps.variables)
    for (const name of ['app', 'region', 'source']) await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
    await expect(page.getByText('aem', { exact: true }).first()).toBeVisible()
  })

  test('Help shows the user guide and navigates between sections', async ({ page }) => {
    await openApp(page, apps.help)
    await expectAppOpen(page, apps.help)
    await expect(page.getByText('AEM Test Suite – User Guide').first()).toBeVisible()
    await page.getByText('11. Use an AI assistant (MCP)', { exact: true }).first().click()
    await expect(page.getByText('claude mcp add', { exact: false }).first()).toBeVisible()
  })
})
