import { test, type APIRequestContext } from '@playwright/test'

/**
 * Test data that e2e specs create: unique names (a reused dev server - `cds watch` - keeps what earlier runs
 * created, and names must be unique) and a cleanup after each test, also when the test failed halfway.
 */

/** "E2E_ORDERS" -> "E2E_ORDERS_lx3k9a2" (letters, digits and _ only, so it also fits number range names) */
export function uniqueName(base: string): string {
  return `${base}_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

/**
 * Registers an afterEach that deletes everything added with `track(url)` during the test (OData entity URLs of
 * active entities). Call once inside a describe.
 */
export function deleteAfterEach(): (url: string) => void {
  let urls: string[] = []
  test.afterEach(async ({ request }: { request: APIRequestContext }) => {
    for (const url of urls.reverse()) await request.delete(url).catch(() => undefined)
    urls = []
  })
  return (url) => void urls.push(url)
}
