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

test('payload suggestions', async ({ page }) => {
  await open(page, `AEMSuiteTestCases-manage&/TestCases(ID=${PING},IsActiveEntity=true)`)
  await page.getByRole('button', { name: 'Edit' }).click()
  // edit mode: the editor takes input
  await expect(page.getByRole('button', { name: 'Format' })).toBeEnabled()
  await settle(page)
  const editor = page.locator('[id$="--payloadEditor"]').first()
  await editor.click()
  // a valid payload with an empty string for the customer; the cursor goes into it
  await editor.evaluate((el: HTMLElement) => {
    const ace = (el.querySelector('.ace_editor') as unknown as { env: { editor: { setValue(v: string, c: number): void; gotoLine(l: number, c: number): void; focus(): void } } }).env.editor
    ace.setValue(['{', '  "ts": {{timestamp}},', '  "broker": "{{broker.name}}",', '  "customer": ""', '}'].join(String.fromCharCode(10)), -1)
    ace.gotoLine(4, 15)
    ace.focus()
  })
  await page.keyboard.type('{{')
  // the popup closes when the editor loses the focus: no settle() here, just the suggestions loaded
  await expect(page.locator('.ace_autocomplete:visible')).toContainText('Global', { timeout: 20_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: out('payload-suggestions') })
  // the draft would show as "Saved Version" in the pictures after this one
  await page.request.delete(`/odata/v4/test/TestCases(ID=${PING},IsActiveEntity=false)`)
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

test('data cleanup', async ({ page }) => {
  // a few old saved messages, so the preview has something to show (the server's database is fresh per run)
  for (const [topic, receivedAt] of [
    ['aem/orders/created/v1/4500000001', '2026-01-12T09:15:00Z'],
    ['aem/orders/created/v1/4500000002', '2026-02-03T14:40:00Z'],
    ['aem/notifications/email/v1', '2026-03-21T08:05:00Z']
  ]) {
    const res = await page.request.post('/odata/v4/subscribe/ReceivedMessages', { data: { topic, payload: '{}', sourceType: 'TOPIC', receivedAt } })
    expect(res.ok()).toBe(true)
  }
  // taller than the other shots: the preview sits below the categories
  await page.setViewportSize({ width: 1440, height: 1000 })
  await open(page, 'AEMSuiteCleanup-manage')
  await page.locator('.sapMPanel').filter({ has: page.getByText('Saved messages', { exact: true }) }).getByRole('switch').click()
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Delete…' })).toBeEnabled()
  await calm(page)
  await page.screenshot({ path: out('cleanup') })
})

test('help', async ({ page }) => {
  await open(page, 'AEMSuiteHelp-display&/6-run-tests')
  await expect(page.locator('h2[id="6-run-tests"]')).toBeVisible()
  await settle(page)
  await page.screenshot({ path: out('help') })
})
