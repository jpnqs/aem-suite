import { defineConfig } from '@playwright/test'
import { baseConfig } from './playwright.base'

/**
 * End-to-end tests of the UI apps in a real browser (e2e/*.spec.ts), against the CAP dev server
 * with mocked users and the demo data from test/data. No broker is needed.
 *
 *   npm run e2e            (e2e:ui = interactive runner, e2e:headed = visible browser, e2e:trace -- <trace.zip>)
 *
 * Browser and server: see playwright.base.ts.
 */
const port = Number(process.env.E2E_PORT ?? 4005)
const base = baseConfig(port, { reuseExistingServer: !process.env.CI })

export default defineConfig({
  ...base,
  testDir: './e2e',
  timeout: 60_000,
  // UI5 and Fiori elements load from the CDN and render asynchronously
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { ...base.use, trace: 'retain-on-failure' }
})
