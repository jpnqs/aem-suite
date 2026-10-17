import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { apps, openApp, expectAppOpen } from './launchpad'
import { deleteAfterEach, uniqueName } from './cleanup'

// Export and import of the Test Cases list (app/testcases/webapp/ext/FileIO.js): the browser saves the file, and
// picks one that is checked, confirmed and imported as new test cases.

test.describe('export and import (Test Cases)', () => {
  const track = deleteAfterEach()

  test('exports the whole tree as a JSON file', async ({ page }) => {
    await openApp(page, apps.testCases)
    await expectAppOpen(page, apps.testCases)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^aem-suite-test-cases-\d{4}-\d{2}-\d{2}\.json$/)
    const content = JSON.parse(fs.readFileSync(await file.path(), 'utf8'))
    expect(content.format).toBe('aem-suite.test-cases')
    // the demo folders of test/data
    expect(content.nodes.map((n: { name: string }) => n.name)).toEqual(expect.arrayContaining(['Orders', 'Events']))
  })

  test('imports a file after a check and a confirmation', async ({ page }) => {
    const name = uniqueName('e2e imported')
    const file = { format: 'aem-suite.test-cases', version: 1, nodes: [{ kind: 'TEST', name, topic: 'e2e/imported', payload: { a: 1 } }] }
    await openApp(page, apps.testCases)
    await expectAppOpen(page, apps.testCases)
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await (await chooser).setFiles({ name: 'suite.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })

    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('Import 1 test case from "suite.json" into the top level?')
    await confirm.getByRole('button', { name: 'Import' }).click()
    await expect(page.getByText('Imported 1 test case')).toBeVisible()

    const found = await (await page.request.get('/odata/v4/test/TestCases?$select=ID&$filter=' + encodeURIComponent(`name eq '${name}'`))).json()
    expect(found.value).toHaveLength(1)
    track(`/odata/v4/test/TestCases(ID=${found.value[0].ID},IsActiveEntity=true)`)
  })
})
