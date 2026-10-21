import { test, expect, type Page } from '@playwright/test'
import { apps } from './launchpad'

// The topic of a test case: a one-line code editor with the suggestions of the payload editor
// (ext/MessageSection.ts). The name follows the topic until the user enters an own name - the server applies the
// rule, the object page only shows the result (side effect topic -> name).

async function newDraft(page: Page, data: object = {}) {
  const res = await page.request.post('/odata/v4/test/TestCases', { data })
  expect(res.ok()).toBe(true)
  const { ID } = await res.json()
  await page.goto(`/launchpad.html#${apps.testCases.intent}&/TestCases(ID=${ID},IsActiveEntity=false)`)
  return ID as string
}

/** the editor of MessageSection.fragment.xml (our id; Fiori elements prefixes it) */
const topicEditor = (page: Page) => page.locator('[id$="--topicEditor"]').first()

/** Replaces the topic and leaves the field with Tab, like a user. */
async function typeTopic(page: Page, text: string) {
  await topicEditor(page).click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type(text)
  await page.keyboard.press('Tab')
}

test('the name follows the topic until the user enters one', async ({ page }) => {
  await newDraft(page)
  const name = page.getByPlaceholder('Empty = topic')
  await expect(topicEditor(page)).toBeVisible()

  await typeTopic(page, 'e2e/name/follows')
  await expect(name).toHaveValue('e2e/name/follows')

  await typeTopic(page, 'e2e/name/follows/v2')
  await expect(name).toHaveValue('e2e/name/follows/v2')

  await name.fill('Own name')
  await name.press('Tab')
  await typeTopic(page, 'e2e/name/other')
  await expect(name).toHaveValue('Own name')
})

test('the topic is one line and suggests template expressions', async ({ page }) => {
  const ID = await newDraft(page, { variables: [{ name: 'e2eRegion', value: 'eu' }] })
  const editor = topicEditor(page)
  await expect(editor).toContainText('e.g. acme/orders/') // the placeholder
  await editor.click()
  await page.keyboard.type('e2e/')
  // Enter adds no line break
  await page.keyboard.press('Enter')
  await page.keyboard.type('topic/{{')
  const popup = page.locator('.ace_autocomplete')
  await expect(popup).toContainText('e2eRegion')
  await page.keyboard.type('e2eReg')
  // the suggestions are loaded asynchronously: on a slow machine the list still has the entries of an earlier key
  // when Enter arrives and takes the wrong one - wait until the narrowed list has selected the entry we mean
  await expect(popup.locator('.ace_selected')).toContainText('e2eRegion')
  await page.keyboard.press('Enter')
  await expect(editor).toContainText('e2e/topic/{{e2eRegion}}')
  // Tab leaves the field and the topic is saved in the draft
  await page.keyboard.press('Tab')
  const name = page.getByPlaceholder('Empty = topic')
  await expect(name).toHaveValue('e2e/topic/{{e2eRegion}}')
  const saved = await (await page.request.get(`/odata/v4/test/TestCases(ID=${ID},IsActiveEntity=false)?$select=topic`)).json()
  expect(saved.topic).toBe('e2e/topic/{{e2eRegion}}')

  await page.request.delete(`/odata/v4/test/TestCases(ID=${ID},IsActiveEntity=false)`)
})
