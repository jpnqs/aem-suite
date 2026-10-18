import { test, expect, type Page } from '@playwright/test'
import { apps, openApp, expectAppOpen } from './launchpad'
import { deleteAfterEach, uniqueName } from './cleanup'

// The Data Cleanup app (admin): select, preview, confirm, history. Only saved messages with a topic of this test
// are matched - the other specs run in parallel on the same data.

test.describe('Data Cleanup', () => {
  const track = deleteAfterEach()
  const messageUrl = (id: string) => `/odata/v4/subscribe/ReceivedMessages(${id})`

  async function savedMessage(page: Page, topic: string, receivedAt: string) {
    const res = await page.request.post('/odata/v4/subscribe/ReceivedMessages', { data: { topic, payload: '{}', sourceType: 'TOPIC', receivedAt } })
    expect(res.ok()).toBe(true)
    const { ID } = await res.json()
    track(messageUrl(ID))
    return ID as string
  }

  /** the panel of a category, by its title */
  const panel = (page: Page, title: string) => page.locator('.sapMPanel').filter({ has: page.getByText(title, { exact: true }) })

  async function selectMessages(page: Page, topic: string) {
    await openApp(page, apps.cleanup)
    await expectAppOpen(page, apps.cleanup)
    const messages = panel(page, 'Saved messages')
    await messages.getByRole('switch').click()
    const topicInput = messages.getByPlaceholder('e.g. acme/orders')
    await topicInput.fill(topic)
    await topicInput.press('Enter')
    return messages
  }

  test('previews, deletes after confirming and logs the cleanup', async ({ page }) => {
    const topic = uniqueName('e2e/cleanup')
    const old = await savedMessage(page, `${topic}/old`, '2020-01-01T00:00:00Z')
    const young = await savedMessage(page, `${topic}/new`, new Date().toISOString())

    await selectMessages(page, topic)
    const deleteButton = page.getByRole('button', { name: 'Delete…' })
    await expect(deleteButton).toBeDisabled()
    await page.getByRole('button', { name: 'Preview', exact: true }).click()

    // one row: the old message only
    const row = page.locator('[id$="previewTable"] tbody tr').first()
    await expect(row).toContainText('Saved messages')
    await expect(row).toContainText('1')
    await row.getByRole('button', { name: 'Show' }).click()
    await expect(page.getByRole('dialog').getByText(`${topic}/old`)).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()

    await deleteButton.click()
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'cannot be undone' })
    await expect(confirm).toContainText('Saved messages: 1')
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect.poll(async () => (await page.request.get(messageUrl(old))).status()).toBe(404)
    expect((await page.request.get(messageUrl(young))).status()).toBe(200)

    await page.getByRole('tab', { name: 'History' }).click()
    await expect(page.getByText('Saved messages 1').first()).toBeVisible()
  })

  test('a changed selection needs a new preview before deleting', async ({ page }) => {
    const topic = uniqueName('e2e/cleanup')
    await savedMessage(page, `${topic}/old`, '2020-01-01T00:00:00Z')
    const messages = await selectMessages(page, topic)
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const deleteButton = page.getByRole('button', { name: 'Delete…' })
    await expect(deleteButton).toBeEnabled()

    const topicInput = messages.getByPlaceholder('e.g. acme/orders')
    await topicInput.fill(`${topic}/other`)
    await topicInput.press('Enter')
    await expect(page.getByText('The selection changed since the preview')).toBeVisible()
    await expect(deleteButton).toBeDisabled()
  })
})
