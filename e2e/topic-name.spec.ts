import { test, expect } from '@playwright/test'
import { apps } from './launchpad'

// The name of a test case follows its topic until the user enters an own name. The server applies the rule,
// the object page only shows the result (side effect topic -> name).

test('the name follows the topic until the user enters one', async ({ page }) => {
  const res = await page.request.post('/odata/v4/test/TestCases', { data: {} })
  expect(res.ok()).toBe(true)
  const { ID } = await res.json()
  await page.goto(`/launchpad.html#${apps.testCases.intent}&/TestCases(ID=${ID},IsActiveEntity=false)`)

  const topic = page.getByPlaceholder(/^e\.g\. acme\/orders\//)
  const name = page.getByPlaceholder('Empty = topic')
  await expect(topic).toBeVisible()

  await topic.fill('e2e/name/follows')
  await topic.press('Tab')
  await expect(name).toHaveValue('e2e/name/follows')

  await topic.fill('e2e/name/follows/v2')
  await topic.press('Tab')
  await expect(name).toHaveValue('e2e/name/follows/v2')

  await name.fill('Own name')
  await name.press('Tab')
  await topic.fill('e2e/name/other')
  await topic.press('Tab')
  await expect(name).toHaveValue('Own name')
})
