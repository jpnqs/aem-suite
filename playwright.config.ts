import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests of the UI apps in a real browser (e2e/*.spec.ts), against the CAP dev server
 * with mocked users and the demo data from test/data. No broker is needed.
 *
 *   npm run e2e            (e2e:ui = interactive runner, e2e:headed = visible browser, e2e:trace -- <trace.zip>)
 *
 * Browser: Windows uses the installed Edge; elsewhere run `npx playwright install chromium` once.
 * PW_CHANNEL=chrome / msedge picks another installed browser.
 */
const port = Number(process.env.E2E_PORT ?? 4005)

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // UI5 and Fiori elements load from the CDN and render asynchronously
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    locale: 'en-US',
    httpCredentials: { username: 'admin', password: 'admin' },
    trace: 'retain-on-failure'
  },
  // Windows: the installed Edge, no browser download needed; elsewhere Playwright's Chromium
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined) }
    }
  ],
  webServer: {
    command: 'npx cds-tsx serve all --with-mocks --in-memory',
    url: `http://localhost:${port}/`,
    env: { PORT: String(port) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
})
