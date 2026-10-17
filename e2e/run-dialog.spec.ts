import { test, expect } from '@playwright/test'
import { PING_ID, testCaseUrl } from './launchpad'

// The run dialog of the Test Cases app: starts a run and follows it to the end.
// Runs against the demo broker "local-docker": without the local Solace container the result is an ERROR, with it PASSED -
// either way the run finishes.

test('the run dialog runs a test case and shows the outcome', async ({ page }) => {
  const sockets: string[] = []
  page.on('websocket', (ws) => sockets.push(ws.url()))
  await page.goto(testCaseUrl(PING_ID))
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

test('the advanced settings repeat the message and show what is about to happen', async ({ page }) => {
  await page.goto(testCaseUrl(PING_ID))
  await expect(page).toHaveTitle(/^Ping/)
  await page.getByRole('button', { name: 'Run…' }).click()
  const dialog = page.getByRole('dialog', { name: /^Run Ping/ })
  await dialog.getByText('local-docker', { exact: true }).click()
  await dialog.getByPlaceholder('Password').fill('aemsuite')

  await dialog.getByText('Advanced settings').click()
  // all() does not wait: first wait until the panel shows both fields
  const fields = dialog.getByRole('spinbutton')
  await expect(fields).toHaveCount(2)
  const [repetitions, pause] = await fields.all()
  await repetitions.fill('3')
  await repetitions.press('Tab')
  await pause.fill('200')
  await pause.press('Tab')
  await expect(dialog.getByText(/3 or more messages/)).toBeVisible()
  await expect(dialog.getByText(/pauses alone take about 1 s/)).toBeVisible()
  // the order only matters with repetitions
  await expect(dialog.getByText('Whole selection')).toBeVisible()

  await dialog.getByRole('button', { name: 'Run', exact: true }).click()
  // without a local broker every message ends as ERROR - but all three were created and the run ends
  await expect(dialog.getByText('Finished', { exact: true })).toBeVisible()
  await expect(dialog.getByText('3 / 3').first()).toBeVisible()
})
