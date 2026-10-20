import { test, expect } from '@playwright/test'
import { apps } from './launchpad'
import { deleteAfterEach } from './cleanup'

// Payloads that were sent or saved are shown in read-only code editors (formatted JSON), as in the test case.

test.describe('payload viewers', () => {
  const track = deleteAfterEach()

  test('a saved message shows its payload and properties as formatted JSON in code editors', async ({ page, request }) => {
    const created = await request.post('/odata/v4/subscribe/ReceivedMessages', {
      data: {
        brokerName: 'local-docker',
        source: 'aem/orders/>',
        sourceType: 'TOPIC',
        topic: 'aem/e2e/viewer',
        payload: '{"orderId":"1","items":[{"sku":"SKU-100","qty":5}]}',
        userProperties: '{"source":"e2e"}',
        contentType: 'application/json',
        deliveryMode: 'PERSISTENT'
      }
    })
    expect(created.ok()).toBe(true)
    const { ID } = await created.json()
    track(`/odata/v4/subscribe/ReceivedMessages(${ID})`)

    await page.goto(`/launchpad.html#${apps.messages.intent}&/ReceivedMessages(${ID})`)
    const payload = page.locator('[id$="--payloadEditor"]').first()
    await expect(payload).toBeVisible()
    // the one-line payload is formatted, in a read-only editor
    await expect.poll(() => payload.evaluate((el: any) => el.querySelector('.ace_editor').env.editor.getValue())).toBe(
      JSON.stringify({ orderId: '1', items: [{ sku: 'SKU-100', qty: 5 }] }, null, 2)
    )
    expect(await payload.evaluate((el: any) => el.querySelector('.ace_editor').env.editor.getReadOnly())).toBe(true)
    await expect(page.locator('[id$="--propertiesEditor"]').first()).toContainText('"source": "e2e"')
  })

  test('a result that was never sent says so instead of an empty editor', async ({ page, request }) => {
    // no broker listens locally: the run ends with an error before a message was resolved
    const cases = await (await request.get('/odata/v4/test/TestCases?$select=ID&$filter=' + encodeURIComponent("name eq 'Ping'"))).json()
    const brokers = await (await request.get('/odata/v4/test/Brokers?$select=ID&$filter=' + encodeURIComponent("name eq 'local-docker'"))).json()
    const started = await request.post('/odata/v4/test/runTests', {
      data: { testCaseIds: [cases.value[0].ID], brokerIds: [brokers.value[0].ID], credentials: [{ brokerId: brokers.value[0].ID, password: 'wrong' }] }
    })
    expect(started.ok()).toBe(true)
    const { runId } = await started.json()
    let result: { ID: string } | undefined
    await expect
      .poll(async () => {
        const rows = await (await request.get(`/odata/v4/test/RunResults?$select=ID,status&$filter=run_ID eq ${runId} and status ne 'PENDING'`)).json()
        result = rows.value[0]
        return !!result
      })
      .toBe(true)

    await page.goto(`/launchpad.html#${apps.runs.intent}&/RunResults(${result!.ID})`)
    await expect(page.getByText('Nothing was sent').first()).toBeVisible()
    await expect(page.locator('[id$="--resolvedPayloadEditor"]')).toBeHidden()
  })
})
