import { test, expect } from '@playwright/test'
import path from 'node:path'

// The first of the screenshots (the files run in the order of their names): the other ones start runs, and without a
// broker these fail - the picture of the home page shows it as it is when all is well.
test('home', async ({ page }) => {
  await page.goto('/launchpad.html#AEMSuiteHome-display')
  await page.waitForLoadState('networkidle')
  // the demo broker "local-docker" is not reachable: its notice is answered with OK, like a user does
  const ok = page.getByRole('button', { name: 'OK', exact: true })
  while (await ok.count()) {
    const before = await ok.count()
    await ok.first().click()
    await expect(ok).toHaveCount(before - 1)
  }
  await expect(page.locator('.sapUiLocalBusyIndicator:visible, .sapMBusyDialog:visible')).toHaveCount(0)
  await page.mouse.move(720, 840)
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))))
  await page.screenshot({ path: path.join(__dirname, '..', '..', 'docs', 'images', 'home.png') })
})
