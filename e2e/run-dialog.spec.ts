import { test, expect } from '@playwright/test'
import { apps } from './launchpad'

// The run dialog of the Test Cases app: starts a run and follows it to the end.
// Runs against the demo broker "local-docker": without the local Solace container the result is an ERROR, with it PASSED -
// either way the run finishes.

test('the run dialog runs a test case and shows the outcome', async ({ page }) => {
  const sockets: string[] = []
  page.on('websocket', (ws) => sockets.push(ws.url()))
  // demo test case "Ping" (test/data/aem.suite-TestCases.csv)
  await page.goto(`/launchpad.html#${apps.testCases.intent}&/TestCases(ID=c1000000-0000-4000-8000-000000000002,IsActiveEntity=true)`)
  await expect(page).toHaveTitle(/^Ping/)

  await page.getByRole('button', { name: 'Run…' }).click()
  const dialog = page.getByRole('dialog', { name: /^Run Ping/ })
  await expect(dialog).toBeVisible()
  await dialog.getByText('local-docker', { exact: true }).click()
  await dialog.getByPlaceholder('Password').fill('aemsuite')
  // nothing is connected until something runs
  expect(sockets.filter((u) => u.includes('/ws/live'))).toEqual([])

  await dialog.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(dialog.getByText('Finished', { exact: true })).toBeVisible()
  await expect(dialog.getByText('1 / 1').first()).toBeVisible()
  expect(sockets.some((u) => u.includes('/comaemsuitetestcases/ws/live'))).toBe(true)

  // "Open Results" navigates to the run in the Test Runs app
  await dialog.getByRole('button', { name: 'Open Results' }).click()
  await expect(page).toHaveURL(/#AEMSuiteTestRuns-display&\/TestRuns\(/)
})
