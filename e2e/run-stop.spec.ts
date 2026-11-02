import { test, expect } from '@playwright/test'
import { apps } from './launchpad'

// A run in progress offers Stop on its page in Test Runs (app/runs/webapp/ext/RunPageExt.controller.js); a finished
// one does not. A run is in progress only for as long as its broker takes to answer, so the page is opened on a
// finished run whose status the browser sees as RUNNING.

test('the page of a run in progress offers Stop, a finished run does not', async ({ page, request }) => {
  const find = async (path: string) => (await (await request.get(path)).json()).value[0].ID as string
  const testCase = await find('/odata/v4/test/TestCases?$select=ID&$filter=' + encodeURIComponent("name eq 'Ping'"))
  const broker = await find('/odata/v4/test/Brokers?$select=ID&$filter=' + encodeURIComponent("name eq 'local-docker'"))
  const { runId } = await (await request.post('/odata/v4/test/runTests', { data: { testCaseIds: [testCase], brokerIds: [broker], credentials: [{ brokerId: broker, password: 'x' }] } })).json()
  await expect
    .poll(async () => (await (await request.get(`/odata/v4/test/TestRuns(${runId})?$select=status`)).json()).status, { timeout: 40_000 })
    .not.toBe('RUNNING')

  const stop = page.getByRole('button', { name: 'Stop Run' })
  await page.goto(`/launchpad.html#${apps.runs.intent}&/TestRuns(${runId})`)
  await expect(page.getByRole('button', { name: 'Compare…' })).toBeVisible()
  await expect(stop).toBeHidden()

  // the same run, shown as in progress
  await page.route('**/$batch', async (route) => {
    const response = await route.fetch()
    const body = await response.text()
    await route.fulfill({ response, body: route.request().postData()?.includes('TestRuns(') ? body.replace(/"status":"(DONE|FAILED|STOPPED)"/g, '"status":"RUNNING"') : body })
  })
  let cancelled = ''
  page.on('request', (r) => {
    const data = r.postData() ?? ''
    if (r.method() === 'POST' && data.includes('cancelRun')) cancelled = data
  })
  await page.reload()
  await expect(stop).toBeVisible()
  await stop.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Stop Run' }).click()
  await expect.poll(() => cancelled).toContain(runId)
  // the page keeps reading the run: no request may still be answered by the route when the test ends
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
