import { test, expect } from '@playwright/test'
import { apps } from './launchpad'

// The payload section of a test case: JSON status while typing, Format, and the template expression help.

test('the payload editor checks, formats and explains the payload', async ({ page }) => {
  const res = await page.request.post('/odata/v4/test/TestCases', { data: { topic: 'e2e/payload', payload: '{"a":1}' } })
  expect(res.ok()).toBe(true)
  const { ID } = await res.json()
  await page.goto(`/launchpad.html#${apps.testCases.intent}&/TestCases(ID=${ID},IsActiveEntity=false)`)

  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible()

  // typing: the status follows every key
  // the editor of PayloadSection.fragment.xml (our id; Fiori elements prefixes it)
  const editor = page.locator('[id$="--payloadEditor"]').first()
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(',')
  await expect(page.getByText(/^Invalid JSON: /)).toBeVisible()
  await page.keyboard.press('Backspace')
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Format' }).click()
  await expect(editor).toContainText('"a": 1')

  await page.getByRole('button', { name: 'Template variables and built-ins' }).click()
  await expect(page.getByText('Template expressions')).toBeVisible()
  await expect(page.getByText('{{randomInt(1,100)}}')).toBeVisible()
})
