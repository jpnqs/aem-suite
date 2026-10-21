import { test, expect, type Locator, type Page } from '@playwright/test'
import path from 'node:path'

/**
 * The pictures of the click guides (docs/user-guide.md, chapter "Click guides"): the spec walks the steps of each
 * guide in the running app and takes a picture where the guide says "you see ..." - what a guide describes is
 * thereby checked against the real screens. The element to click is framed in orange.
 *
 *   npm run docs:screenshots -- guides
 */
const out = (name: string) => path.join(__dirname, '..', '..', 'docs', 'images', 'guides', `${name}.png`)
const FRAME = '3px solid #e9730c'

test.use({ viewport: { width: 1280, height: 780 } })
test.describe.configure({ mode: 'serial' })

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)
}

async function open(page: Page, hash: string) {
  await page.goto(`/launchpad.html#${hash}`)
  await settle(page)
}

/** No focus ring or tooltip of the last click in the picture. */
async function calm(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.mouse.move(640, 770)
  await page.waitForTimeout(400)
}

/** Takes the picture with the given elements framed (the frame is removed again). */
async function shot(page: Page, name: string, ...marked: Locator[]) {
  await take(page, name, true, marked)
}

/** The same while a menu or popup is open (blurring the field would close it). */
async function shotOpen(page: Page, name: string, ...marked: Locator[]) {
  await take(page, name, false, marked)
}

async function take(page: Page, name: string, quiet: boolean, marked: Locator[]) {
  if (quiet) await calm(page)
  // the frames are boxes laid over the page (an outline on the element itself is cut off by menus and scroll areas)
  const boxes = []
  for (const l of marked) {
    const box = await l.first().boundingBox()
    if (box) boxes.push(box)
  }
  await page.evaluate(
    ({ boxes, frame }) => {
      for (const b of boxes) {
        const div = document.createElement('div')
        div.className = 'aemGuideFrame'
        div.style.cssText = `position:fixed;left:${b.x - 4}px;top:${b.y - 4}px;width:${b.width + 8}px;height:${b.height + 8}px;border:${frame};border-radius:6px;pointer-events:none;z-index:2147483647;box-sizing:border-box`
        document.body.appendChild(div)
      }
    },
    { boxes, frame: FRAME }
  )
  await page.waitForTimeout(200)
  await page.screenshot({ path: out(name) })
  await page.evaluate(() => document.querySelectorAll('.aemGuideFrame').forEach((d) => d.remove()))
}

const button = (page: Page, name: string, exact = true) => page.getByRole('button', { name, exact }).first()
/** a field of the object page: the last one with the label (the hidden list report has fields of the same name in its filter bar) */
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).last()

test('guide: add a broker', async ({ page }) => {
  await open(page, 'AEMSuiteBrokers-manage')
  await expect(page.getByText('local-docker', { exact: true }).first()).toBeVisible()
  await shot(page, 'broker-1-list', button(page, 'Create'))

  await button(page, 'Create').click()
  await settle(page)
  await field(page, 'Name').fill('Dev broker')
  await field(page, 'URL').fill('mr-abc123.messaging.solace.cloud')
  await field(page, 'Message VPN').fill('dev-vpn')
  await field(page, 'Username').fill('solace-cloud-client')
  await page.waitForTimeout(800)
  await shot(page, 'broker-2-form', field(page, 'Name'), field(page, 'URL'), field(page, 'Message VPN'), field(page, 'Username'))

  await page.getByRole('button', { name: 'Create', exact: true }).last().click()
  await settle(page)
  await shot(page, 'broker-3-saved', button(page, 'Test Connection'))

  await button(page, 'Test Connection').click()
  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible()
  await shot(page, 'broker-4-test-connection', dialog.getByPlaceholder('Password'))
})

test('guide: global variables', async ({ page }) => {
  await open(page, 'AEMSuiteVariables-manage')
  await expect(page.getByText('region', { exact: true }).first()).toBeVisible()
  await shot(page, 'variables-1-list', button(page, 'Create'))

  await button(page, 'Create').click()
  await settle(page)
  await field(page, 'Name').fill('customer')
  await field(page, 'Value').fill('ACME')
  await page.waitForTimeout(600)
  await shot(page, 'variables-2-form', field(page, 'Name'), field(page, 'Value'))
})

test('guide: a number range', async ({ page }) => {
  await open(page, 'AEMSuiteNumberRanges-manage')
  await expect(page.getByText('ORDERS', { exact: true }).first()).toBeVisible()
  await button(page, 'Create').click()
  await settle(page)
  await field(page, 'Name').fill('SHIPMENTS')
  await field(page, 'Prefix').fill('SH-')
  await field(page, 'Digits').fill('8')
  await field(page, 'First Number').fill('1000')
  await page.waitForTimeout(800)
  await shot(page, 'numberrange-1-form', field(page, 'Name'), field(page, 'Prefix'), field(page, 'Digits'), field(page, 'First Number'))

  await page.getByRole('button', { name: 'Create', exact: true }).last().click()
  await settle(page)
  // "Object created" disappears after a few seconds; the status is a tab of the page
  await page.waitForTimeout(4000)
  await page.getByRole('tab', { name: 'Status' }).click()
  await page.waitForTimeout(1500)
  await shot(page, 'numberrange-2-saved', button(page, 'Count Up'), button(page, 'Count Down'), button(page, 'Reset'))
})

test('guide: a folder and a test case', async ({ page }) => {
  await open(page, 'AEMSuiteTestCases-manage')
  await expect(page.getByText('Orders', { exact: true }).first()).toBeVisible()
  await page.waitForTimeout(2000)
  await button(page, 'Create', false).click()
  await page.waitForTimeout(600)
  await shotOpen(page, 'testcase-1-create-menu', page.getByRole('menuitem', { name: 'Test Case' }))

  await page.getByRole('menuitem', { name: 'Test Case' }).click()
  await settle(page)
  await page.waitForTimeout(1500)
  const topic = page.locator('[id$="--topicEditor"]').first()
  await topic.click()
  await page.keyboard.type('shop/orders/{{region}}/created/v1/{{uuid}}')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await shot(page, 'testcase-2-topic', topic)

  // the payload with suggestions
  const payload = page.locator('[id$="--payloadEditor"]').first()
  await payload.scrollIntoViewIfNeeded()
  await payload.click()
  // a valid payload with an empty string; the cursor goes into it
  await payload.evaluate((el: HTMLElement) => {
    const editor = (el.querySelector('.ace_editor') as unknown as { env: { editor: { setValue(v: string, c: number): void; gotoLine(l: number, c: number): void; focus(): void } } }).env.editor
    editor.setValue('{\n  "orderId": "{{uuid}}",\n  "customer": ""\n}', -1)
    editor.gotoLine(3, 15)
    editor.focus()
  })
  await page.keyboard.type('{{')
  await expect(page.locator('.ace_autocomplete:visible')).toBeVisible()
  await page.waitForTimeout(800)
  await shotOpen(page, 'testcase-3-suggestions', page.locator('.ace_autocomplete:visible'))
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(1500)
  await shot(page, 'testcase-4-preview', dialog.getByRole('button', { name: 'Resolve' }))
})

test('guide: run a test and read the result', async ({ page }) => {
  await open(page, 'AEMSuiteTestCases-manage')
  await expect(page.getByText('Orders', { exact: true }).first()).toBeVisible()
  await page.waitForTimeout(2000)
  // select the folder Orders: its row checkbox
  await page.locator('[id$="-innerTable-rowsel0"]').click() // the selection cell of the first row (Orders)
  await shot(page, 'run-1-select', button(page, 'Run…'))

  await button(page, 'Run…').click()
  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible()
  await dialog.getByText('local-docker', { exact: true }).first().click()
  await dialog.getByPlaceholder('Password').fill('aemsuite')
  await dialog.getByText('Advanced settings').click()
  const [repetitions] = await dialog.getByRole('spinbutton').all()
  await repetitions.fill('2')
  await repetitions.press('Tab')
  await page.waitForTimeout(800)
  await shot(page, 'run-2-dialog', dialog.getByText('Advanced settings'), dialog.getByRole('button', { name: 'Run', exact: true }))

  await dialog.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(dialog.getByText('Finished', { exact: true })).toBeVisible()
  await page.waitForTimeout(800)
  await shot(page, 'run-3-finished', dialog.getByRole('button', { name: 'Open Results' }))

  await dialog.getByRole('button', { name: 'Open Results' }).click()
  await settle(page)
  await page.waitForTimeout(1500)
  await shot(page, 'results-1-run')

  await open(page, 'AEMSuiteTestRuns-display')
  await expect(page.getByText('Order created').first()).toBeVisible()
  await page.waitForTimeout(1500)
  await shot(page, 'results-2-list')
})

test('guide: live subscriber setups', async ({ page }) => {
  await open(page, 'AEMSuiteSubscriber-display')
  await expect(page.getByText('Not listening yet').first()).toBeVisible()
  const topic = page.getByPlaceholder(/Add a topic/)
  for (const name of ['shop/orders/>', 'shop/events/*']) {
    await topic.fill(name)
    await page.getByRole('button', { name: 'Add' }).click()
    await page.waitForTimeout(300)
  }
  await shot(page, 'subscriber-1-topics', page.getByRole('button', { name: 'Add' }), button(page, 'Start'))

  await page.getByRole('button', { name: 'Save as…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save setup' })
  await dialog.getByRole('textbox').fill('Shop events on dev')
  await shot(page, 'subscriber-2-save-setup', dialog.getByRole('button', { name: 'Save' }))
})

test('guide: saved messages become test cases', async ({ page, request }) => {
  const created = await request.post('/odata/v4/subscribe/ReceivedMessages', {
    data: {
      brokerName: 'local-docker',
      source: 'shop/orders/>',
      sourceType: 'TOPIC',
      topic: 'shop/orders/eu/created/v1/4711',
      payload: '{"orderId":"4711","customer":"ACME","items":[{"sku":"SKU-100","qty":5}]}',
      userProperties: '{"source":"live subscriber"}',
      contentType: 'application/json',
      deliveryMode: 'PERSISTENT'
    }
  })
  const { ID } = await created.json()
  await open(page, 'AEMSuiteSavedMessages-display')
  await expect(page.getByText('shop/orders/eu/created/v1/4711').first()).toBeVisible()
  await shot(page, 'messages-1-list')
  await open(page, `AEMSuiteSavedMessages-display&/ReceivedMessages(${ID})`)
  await expect(page.locator('[id$="--payloadEditor"]').first()).toBeVisible()
  await shot(page, 'messages-2-page', button(page, 'Create Test Case'))
})

test('guide: export and import', async ({ page }) => {
  await open(page, 'AEMSuiteTestCases-manage')
  await expect(page.getByText('Orders', { exact: true }).first()).toBeVisible()
  await page.waitForTimeout(2000)
  await page.locator('[id$="-innerTable-rowsel0"]').click() // the selection cell of the first row (Orders)
  await shot(page, 'export-1-toolbar', button(page, 'Export'), button(page, 'Import'))
})

test('guide: clean up old data', async ({ page }) => {
  await open(page, 'AEMSuiteCleanup-manage')
  await expect(page.getByText('Choose what to delete').first()).toBeVisible()
  const testRuns = page.getByRole('switch').first()
  await testRuns.click()
  await page.waitForTimeout(800)
  await shot(page, 'cleanup-1-form', testRuns, button(page, 'Preview'))
})
