import { defineConfig } from '@playwright/test'
import { baseConfig } from './playwright.base'

/**
 * Takes the screenshots of the README / user guide (docs/images) from the apps running on the demo data:
 *
 *   npm run docs:screenshots
 *
 * Same browser and server as the e2e tests (playwright.base.ts), on its own port. No broker is needed.
 */
const port = Number(process.env.SHOTS_PORT ?? 4006)

export default defineConfig({
  ...baseConfig(port, { reuseExistingServer: false, viewport: { width: 1440, height: 860 } }),
  testDir: './scripts/screenshots',
  timeout: 120_000,
  workers: 1,
  reporter: 'list'
})
