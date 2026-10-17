import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { PING_ID as PING } from '../../e2e/launchpad'

const out = (name: string) => path.join(__dirname, '..', '..', 'docs', 'images', `${name}.png`)
const ORDERS = 'f1000000-0000-4000-8000-000000000001'

/** Waits until the page is still: no requests, no busy indicators, no running animations (dialogs, popovers). */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.sapUiLocalBusyIndicator:visible, .sapMBusyDialog:visible')).toHaveCount(0)
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))))
}

/** No focus ring or tooltip from the last click / hover in the picture. */
async function calm(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.mouse.move(720, 840)
  await settle(page)
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
  // a missing row would give a wrong picture: fail instead
  await expect(page.getByText('Ping').first()).toBeVisible({ timeout: 30_000 })
  await settle(page)
  // open the first two folders (each click turns the next closed node into an open one)
  const opened = page.locator('.sapUiTableTreeIconNodeOpen')
  const before = await opened.count()
  for (let i = 1; i <= 2; i++) {
    await page.locator('.sapUiTableTreeIconNodeClosed').first().click()
    await expect(opened).toHaveCount(before + i)
    await settle(page)
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
  const inputs = page.locator('input:visible').filter({ hasNot: page.locator('[type=search]') })
  const before = await inputs.count()
  await page.getByRole('button', { name: 'Create' }).last().click()
  // the new variable row: name and value
  await expect(inputs).toHaveCount(before + 2)
  const count = await inputs.count()
  await inputs.nth(count - 2).fill('domain')
  await inputs.nth(count - 1).fill('orders')
  await settle(page)
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
  const fields = dialog.getByRole('spinbutton')
  await expect(fields).toHaveCount(2)
  const [repetitions, pause] = await fields.all()
  await repetitions.fill('10')
  await repetitions.press('Tab')
  await pause.fill('500')
  await pause.press('Tab')
  await expect(dialog.getByText(/10 or more messages/)).toBeVisible()
  await settle(page)
  await page.screenshot({ path: out('run-dialog') })
})

test('preview', async ({ page }) => {
  await open(page, `AEMSuiteTestCases-manage&/TestCases(ID=${PING},IsActiveEntity=true)`)
  await page.getByRole('button', { name: 'Preview' }).first().click()
  await expect(page.getByText(/^Resolved (for broker|with global variables)/).first()).toBeVisible()
  await settle(page)
  await page.screenshot({ path: out('preview') })
})

test('live subscriber', async ({ page }) => {
  await open(page, 'AEMSuiteSubscriber-display')
  await expect(page.getByText('Not listening yet').first()).toBeVisible()
  const topic = page.getByPlaceholder(/Add a topic/)
  for (const name of ['aem/orders/>', 'aem/notifications/*']) {
    await topic.fill(name)
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText(name, { exact: true })).toBeVisible()
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
  await calm(page)
  await page.screenshot({ path: out('number-ranges') })
})

test('help', async ({ page }) => {
  await open(page, 'AEMSuiteHelp-display&/6-run-tests')
  await expect(page.locator('h2[id="6-run-tests"]')).toBeVisible()
  await settle(page)
  await page.screenshot({ path: out('help') })
})
