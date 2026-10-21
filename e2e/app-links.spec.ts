import { test, expect } from '@playwright/test'
import { apps } from './launchpad'

// Links from one app to another (the test case of a result) go through the launchpad's Navigation service
// (app/_shared/Navigation.js) - SAP Build Work Zone cannot resolve a hash that was set by hand.

test('the test case link of a result opens the test case', async ({ page, request }) => {
  const navigated: string[] = []
  page.on('console', (m) => m.text().startsWith('NAV ') && navigated.push(m.text()))
  await page.addInitScript(() => {
    const timer = setInterval(() => {
      const container = (window as unknown as { sap?: { ushell?: { Container?: { getServiceAsync(n: string): Promise<{ navigate(t: unknown): Promise<void> }> } } } }).sap?.ushell?.Container
      if (!container) return
      clearInterval(timer)
      void container.getServiceAsync('Navigation').then((nav) => {
        const navigate = nav.navigate.bind(nav)
        nav.navigate = (t: unknown) => (console.log('NAV ' + JSON.stringify(t)), navigate(t))
      })
    }, 50)
  })

  // a run without a reachable broker still has a result with its links
  const find = async (path: string) => (await (await request.get(path)).json()).value[0].ID as string
  const testCase = await find('/odata/v4/test/TestCases?$select=ID&$filter=' + encodeURIComponent("name eq 'Ping'"))
  const broker = await find('/odata/v4/test/Brokers?$select=ID&$filter=' + encodeURIComponent("name eq 'local-docker'"))
  const { runId } = await (await request.post('/odata/v4/test/runTests', { data: { testCaseIds: [testCase], brokerIds: [broker], credentials: [{ brokerId: broker, password: 'x' }] } })).json()
  let result = ''
  await expect.poll(async () => (result = await find(`/odata/v4/test/RunResults?$select=ID&$filter=run_ID eq ${runId}`).catch(() => ''))).not.toBe('')

  await page.goto(`/launchpad.html#${apps.runs.intent}&/RunResults(${result})`)
  await page.getByRole('link', { name: 'Ping' }).first().click()
  await expect(page).toHaveTitle(/^Ping/)
  expect(navigated.join()).toContain('"semanticObject":"AEMSuiteTestCases","action":"manage"')
})
