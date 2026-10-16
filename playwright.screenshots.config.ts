import { defineConfig, devices } from '@playwright/test'

/**
 * Takes the screenshots of the README / user guide (docs/images) from the apps running on the demo data:
 *
 *   npm run docs:screenshots
 *
 * Same browser setup as the e2e tests (see playwright.config.ts). No broker is needed.
 */
const port = Number(process.env.SHOTS_PORT ?? 4006)

export default defineConfig({
  testDir: './scripts/screenshots',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    locale: 'en-US',
    httpCredentials: { username: 'admin', password: 'admin' },
    viewport: { width: 1440, height: 860 }
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 860 }, channel: process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined) }
    }
  ],
  webServer: {
    command: 'npx cds-tsx serve all --with-mocks --in-memory',
    url: `http://localhost:${port}/`,
    env: { PORT: String(port) },
    reuseExistingServer: false,
    timeout: 120_000
  }
})
