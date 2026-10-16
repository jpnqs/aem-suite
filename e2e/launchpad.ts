import { expect, type Page } from '@playwright/test'

/** The tiles of the sandbox launchpad (app/launchpad/webapp/index.html). */
export const apps = {
  home: { intent: 'AEMSuiteHome-display', title: 'AEM Suite – Home' },
  testCases: { intent: 'AEMSuiteTestCases-manage', title: 'AEM Suite – Test Cases' },
  runs: { intent: 'AEMSuiteTestRuns-display', title: 'AEM Suite – Test Runs' },
  subscriber: { intent: 'AEMSuiteSubscriber-display', title: 'AEM Suite – Live Subscriber' },
  messages: { intent: 'AEMSuiteSavedMessages-display', title: 'AEM Suite – Saved Messages' },
  brokers: { intent: 'AEMSuiteBrokers-manage', title: 'AEM Suite – Brokers' },
  variables: { intent: 'AEMSuiteVariables-manage', title: 'AEM Suite – Global Variables' },
  numberRanges: { intent: 'AEMSuiteNumberRanges-manage', title: 'AEM Suite – Number Ranges' },
  help: { intent: 'AEMSuiteHelp-display', title: 'AEM Suite – Help' }
} as const

export type App = (typeof apps)[keyof typeof apps]

const LOAD_ERROR = 'App could not be opened'

/** Opens an app through its launchpad intent, the way a user does with a tile. */
export async function openApp(page: Page, app: App) {
  await page.goto(`/launchpad.html#${app.intent}`)
}

/** Waits until the shell shows the app (window title) and no load error appeared. */
export async function expectAppOpen(page: Page, app: App) {
  await expect(page).toHaveTitle(app.title)
  await expect(page.getByText(LOAD_ERROR)).toHaveCount(0)
}

export async function expectLoadError(page: Page) {
  await expect(page.getByText(LOAD_ERROR)).toBeVisible()
}
