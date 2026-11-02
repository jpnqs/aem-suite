import { test, expect } from '@playwright/test'
import { deleteAfterEach, uniqueName } from './cleanup'
import { apps, expectAppOpen, openApp } from './launchpad'

// Saved Messages: "Create Test Case" says what it made and offers to open it (app/messages/webapp/ext/MessageActions.js).

test.describe('saved messages', () => {
  const track = deleteAfterEach()

  test('Create Test Case offers to open the new test case', async ({ page, request }) => {
    const broker = (await (await request.get('/odata/v4/subscribe/Brokers?$select=ID&$top=1')).json()).value?.[0]?.ID as string | undefined
    const topic = uniqueName('e2e/saved').replace(/_/g, '/')
    const res = await request.post('/odata/v4/subscribe/ReceivedMessages', { data: { broker_ID: broker, source: 'e2e/>', sourceType: 'TOPIC', topic, payload: '{"saved":true}' } })
    expect(res.ok()).toBeTruthy()
    const { ID } = await res.json()
    track(`/odata/v4/subscribe/ReceivedMessages(${ID})`)

    await openApp(page, apps.messages)
    await expectAppOpen(page, apps.messages)
    await page.getByRole('row').filter({ hasText: topic }).getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Create Test Case' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText(`Test case "${topic}" created.`)
    await dialog.getByRole('button', { name: 'Open Test Case' }).click()
    await expect(page).toHaveURL(/AEMSuiteTestCases-manage/)
    await expect(page.getByText('"saved": true').first()).toBeVisible()
    // clean up: the test case that was made
    const made = await (await request.get('/odata/v4/test/TestCases?$select=ID&$filter=' + encodeURIComponent(`topic eq '${topic}'`))).json()
    for (const { ID: id } of made.value) track(`/odata/v4/test/TestCases(ID=${id},IsActiveEntity=true)`)
  })
})
