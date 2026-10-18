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

test('typing {{ in the payload suggests variables, built-ins and faker.js', async ({ page }) => {
  const res = await page.request.post('/odata/v4/test/TestCases', {
    data: { topic: 'e2e/completion', payload: '{"a":1}', variables: [{ name: 'e2eCustomer', value: 'ACME' }] }
  })
  expect(res.ok()).toBe(true)
  const { ID } = await res.json()
  await page.goto(`/launchpad.html#${apps.testCases.intent}&/TestCases(ID=${ID},IsActiveEntity=false)`)
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible()

  const editor = page.locator('[id$="--payloadEditor"]').first()
  const popup = page.locator('.ace_autocomplete')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type(',"b":"{{')
  // right after {{: everything, the test case variable with where it comes from
  await expect(popup).toBeVisible()
  await expect(popup).toContainText('e2eCustomer')
  await expect(popup).toContainText('Test case')
  // the built-ins (the popup only renders the rows it shows: filter to see them)
  await page.keyboard.type('uui')
  await expect(popup.locator('.ace_line').first()).toContainText('uuid')
  await expect(popup.locator('.ace_line').first()).toContainText('Built-in')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace')

  // typing filters; Enter inserts the expression with the closing braces
  await page.keyboard.type('e2eCus')
  await expect(popup.locator('.ace_line').first()).toContainText('e2eCustomer')
  await page.keyboard.press('Enter')
  await expect(editor).toContainText('"b":"{{e2eCustomer}}"')
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible()

  // faker.js below its module
  await page.keyboard.press('Control+End')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type(',"c":"{{faker.person.full')
  await expect(popup.locator('.ace_line').first()).toContainText('faker.person.fullName')
  await page.keyboard.press('Enter')
  await expect(editor).toContainText('"c":"{{faker.person.fullName}}"')

  await page.request.delete(`/odata/v4/test/TestCases(ID=${ID},IsActiveEntity=false)`)
})
