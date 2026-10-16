import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'

const out = (name: string) => path.join(__dirname, '..', '..', 'docs', 'images', `${name}.png`)
const PING = 'c1000000-0000-4000-8000-000000000002'
const ORDERS = 'f1000000-0000-4000-8000-000000000001'

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)
}

/** No focus ring or tooltip from the last click / hover in the picture. */
async function calm(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.mouse.move(720, 840)
  await page.waitForTimeout(400)
}

async function open(page: Page, hash: string) {
  await page.goto(`/launchpad.html#${hash}`)
  await settle(page)
}

test.describe.configure({ mode: 'serial' })

test('launchpad', async ({ page }) => {
  await page.goto('/launchpad.html')
  await expect(page.getByText('Test Cases').first()).toBeVisible()
  await settle(page)
  await page.screenshot({ path: out('launchpad') })
})

test('home', async ({ page }) => {
  await open(page, 'AEMSuiteHome-display')
  await page.screenshot({ path: out('home') })
})

test('test cases tree', async ({ page }) => {
  await open(page, 'AEMSuiteTestCases-manage')
  await expect(page.getByText('Orders', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Ping').first()).toBeVisible({ timeout: 30_000 }).catch(() => undefined)
  await page.waitForTimeout(2500)
  // open the first two folders (each click turns the next closed node into an open one)
  for (let i = 0; i < 2; i++) {
    await page.locator('.sapUiTableTreeIconNodeClosed').first().click()
    await page.waitForTimeout(1500)
  }
  await calm(page)
  await page.screenshot({ path: out('test-cases') })
})

test('test case page', async ({ page }) => {
  await open(page, `AEMSuiteTestCases-manage&/TestCases(ID=${PING},IsActiveEntity=true)`)
  await expect(page.getByText('Valid JSON').first()).toBeVisible()
  await calm(page)
  await page.screenshot({ path: out('test-case') })
})

test('folder variables', async ({ page }) => {
  await open(page, `AEMSuiteTestCases-manage&/TestCases(ID=${ORDERS},IsActiveEntity=true)`)
  await page.getByRole('button', { name: 'Edit' }).click()
  await settle(page)
  await page.getByRole('button', { name: 'Create' }).last().click()
  await page.waitForTimeout(800)
  const inputs = page.locator('input:visible').filter({ hasNot: page.locator('[type=search]') })
  const count = await inputs.count()
  await inputs.nth(count - 2).fill('domain')
  await inputs.nth(count - 1).fill('orders')
  await page.waitForTimeout(1200)
  await calm(page)
  await page.screenshot({ path: out('folder-variables') })
})

test('run dialog', async ({ page }) => {
  await open(page, `AEMSuiteTestCases-manage&/TestCases(ID=${PING},IsActiveEntity=true)`)
  await page.getByRole('button', { name: 'Run…' }).click()
  const dialog = page.getByRole('dialog', { name: /^Run Ping/ })
  await expect(dialog).toBeVisible()
  await dialog.getByText('local-docker', { exact: true }).click()
  // the advanced settings open, with a repeated run
  await dialog.getByText('Advanced settings').click()
  const [repetitions, pause] = await dialog.getByRole('spinbutton').all()
  await repetitions.fill('10')
  await repetitions.press('Tab')
  await pause.fill('500')
  await pause.press('Tab')
  await page.waitForTimeout(800)
  await page.screenshot({ path: out('run-dialog') })
})

test('preview', async ({ page }) => {
  await open(page, `AEMSuiteTestCases-manage&/TestCases(ID=${PING},IsActiveEntity=true)`)
  await page.getByRole('button', { name: 'Preview' }).first().click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: out('preview') })
})

test('live subscriber', async ({ page }) => {
  await open(page, 'AEMSuiteSubscriber-display')
  await expect(page.getByText('Not listening yet').first()).toBeVisible()
  const topic = page.getByPlaceholder(/Add a topic/)
  for (const name of ['aem/orders/>', 'aem/notifications/*']) {
    await topic.fill(name)
    await page.getByRole('button', { name: 'Add' }).click()
    await page.waitForTimeout(300)
  }
  await calm(page)
  await page.screenshot({ path: out('live-subscriber') })
})

test('brokers', async ({ page }) => {
  await open(page, 'AEMSuiteBrokers-manage')
  await expect(page.getByText('local-docker', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: out('brokers') })
})

test('number ranges', async ({ page }) => {
  await open(page, 'AEMSuiteNumberRanges-manage')
  await expect(page.getByText('ORDERS', { exact: true }).first()).toBeVisible()
  await page.waitForTimeout(1500)
  await calm(page)
  await page.screenshot({ path: out('number-ranges') })
})

test('help', async ({ page }) => {
  await open(page, 'AEMSuiteHelp-display&/6-run-tests')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: out('help') })
})
