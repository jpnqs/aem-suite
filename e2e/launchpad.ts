import { expect, type APIRequestContext, type Page } from '@playwright/test'

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

/** the demo test case "Ping" (test/data/aem.suite-TestCases.csv) */
export const PING_ID = 'c1000000-0000-4000-8000-000000000002'

/** The object page of a saved test case, opened through the launchpad. */
export const testCaseUrl = (id: string) => `/launchpad.html#${apps.testCases.intent}&/TestCases(ID=${id},IsActiveEntity=true)`

/** The preview (TestService.preview) of the demo test case with this name, for a demo broker. */
export async function previewTestCase(request: APIRequestContext, name: string, broker = 'local-docker') {
  const idOf = async (entity: string, filter: string) => {
    const found = await (await request.get(`/odata/v4/test/${entity}?$select=ID&$filter=${encodeURIComponent(filter)}`)).json()
    expect(found.value, `${entity} ${filter}`).toHaveLength(1)
    return found.value[0].ID as string
  }
  const id = await idOf('TestCases', `name eq '${name}'`)
  const brokerId = await idOf('Brokers', `name eq '${broker}'`)
  const res = await request.post(`/odata/v4/test/TestCases(ID=${id},IsActiveEntity=true)/TestService.preview`, { data: { brokerId } })
  expect(res.ok()).toBe(true)
  return res.json()
}
