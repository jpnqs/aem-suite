import { test, expect } from '@playwright/test'
import { apps, openApp, expectAppOpen, PING_ID, testCaseUrl } from './launchpad'

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

  test('Test Cases offers a folder or a test case to create (labels from the i18n bundle)', async ({ page }) => {
    await openApp(page, apps.testCases)
    await expectAppOpen(page, apps.testCases)
    await page.getByRole('button', { name: 'Create' }).first().click()
    await expect(page.getByRole('menuitem', { name: 'Folder' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Test Case' })).toBeVisible()
  })

  test('Test Cases opens a test case by deep link', async ({ page }) => {
    await page.goto(testCaseUrl(PING_ID))
    await expect(page).toHaveTitle('Ping ({{app}}/ping/{{broker.name}}) - Test Case')
    await expect(page.getByText('Valid JSON').first()).toBeVisible()
    await expect(page.getByText('"broker": "{{broker.name}}"').first()).toBeVisible()
  })

  test('a folder page has no payload and no Preview', async ({ page }) => {
    // demo folder "Orders" (test/data/aem.suite-TestCases.csv)
    await page.goto(testCaseUrl('f1000000-0000-4000-8000-000000000001'))
    await expect(page.getByRole('button', { name: 'Run…' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Preview' })).toHaveCount(0)
    await expect(page.getByText('Valid JSON')).toHaveCount(0)
  })

  test('Test Runs opens', async ({ page }) => {
    // not "no runs yet": the run dialog specs start runs on the same server in parallel
    await openApp(page, apps.runs)
    await expectAppOpen(page, apps.runs)
    await expect(page.getByRole('columnheader', { name: 'Test Case', exact: true }).first()).toBeVisible()
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
    // the search says how many sections mention the text (a text of the app's i18n bundle)
    await page.getByPlaceholder('Search the help').fill('faker')
    await expect(page.getByText(/^\d+ of \d+ sections mention "faker"$/)).toBeVisible()
  })

  test('Help shows the pictures of the step-by-step guides', async ({ page }) => {
    await openApp(page, apps.help)
    await expectAppOpen(page, apps.help)
    await page.getByText('2. Set up brokers (Admin)', { exact: true }).first().click()
    // the pictures come from the backend (docs-images/): at least the first one loads and has a size
    const picture = page.locator('img.aemDocImage').first()
    await expect(picture).toBeVisible()
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(300)
  })
})
