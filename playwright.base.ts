import { devices, type PlaywrightTestConfig } from '@playwright/test'

/**
 * What the e2e tests (playwright.config.ts) and the screenshots (playwright.screenshots.config.ts) share: the browser,
 * the CAP dev server with mocked users and the demo data from test/data, the user admin and the locale.
 *
 * Browser: Windows uses the installed Edge; elsewhere run `npx playwright install chromium` once.
 * PW_CHANNEL=chrome / msedge picks another installed browser.
 */
export function baseConfig(port: number, opts: { reuseExistingServer: boolean; viewport?: { width: number; height: number } }): PlaywrightTestConfig {
  return {
    use: {
      baseURL: `http://localhost:${port}`,
      locale: 'en-US',
      httpCredentials: { username: 'admin', password: 'admin' }
    },
    projects: [
      {
        name: 'chromium',
        use: {
          ...devices['Desktop Chrome'],
          ...(opts.viewport ? { viewport: opts.viewport } : {}),
          channel: process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined)
        }
      }
    ],
    webServer: {
      command: 'npx cds-tsx serve all --with-mocks --in-memory',
      url: `http://localhost:${port}/`,
      env: { PORT: String(port) },
      reuseExistingServer: opts.reuseExistingServer,
      timeout: 120_000
    }
  }
}
