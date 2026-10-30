import { test, expect } from '@playwright/test'
import { deleteAfterEach, uniqueName } from './cleanup'
import { apps, expectAppOpen, openApp, testCaseUrl } from './launchpad'

// Tags as pills (app/testcases/webapp/ext/TagsInput.ts): typed in the object page, shown in the list.

test.describe('tags', () => {
  const track = deleteAfterEach()

  test('typed words become pills, are saved and show in the list', async ({ page }) => {
    const name = uniqueName('E2E_TAGS')
    const draft = await (await page.request.post('/odata/v4/test/TestCases', { data: { name, topic: 'e2e/tags', payload: '{}' } })).json()
    const activated = await page.request.post(`/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=false)/TestService.draftActivate`, { data: {} })
    expect(activated.ok()).toBeTruthy()
    track(`/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=true)`)

    await page.goto(testCaseUrl(draft.ID))
    const section = page.locator('[id$="CustomSection::tags"]').first()
    await expect(section.getByText('No tags')).toBeVisible()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(section.getByText('No tags')).toBeHidden()

    const input = section.getByRole('textbox')
    await input.click()
    // a comma ends a tag, Enter too; upper case becomes lower case; a word with "/" is refused and stays
    await input.pressSequentially('Smoke,')
    await input.pressSequentially('EU')
    await input.press('Enter')
    await input.pressSequentially('no/slash')
    await input.press('Enter')
    const pills = section.locator('.aemTag')
    await expect(pills).toHaveText(['eu', 'smoke'])
    await expect(input).toHaveValue('no/slash')
    await input.fill('')
    await expect(section.locator('.sapMInputBaseContentWrapperError')).toHaveCount(0)

    await page.screenshot({ path: test.info().outputPath('tags-edit.png') })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
    await expect(pills).toHaveText(['eu', 'smoke'])
    const saved = await (await page.request.get(`/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=true)?$select=tags`)).json()
    expect(saved.tags).toBe('eu, smoke')

    await openApp(page, apps.testCases)
    await expectAppOpen(page, apps.testCases)
    await page.getByRole('option', { name: 'All Test Cases' }).click()
    const row = page.getByRole('row').filter({ hasText: name })
    await expect(row.locator('.aemTag')).toHaveText(['eu', 'smoke'])
    await page.screenshot({ path: test.info().outputPath('tags-list.png') })

    // "Edit Selected" adds and removes tags as pills too
    // the selection cells of the tree table (the row header) are rendered apart from the rows, by row index
    const index = await row.getAttribute('data-sap-ui-rowindex')
    await page.locator(`div.sapUiTableRow[data-sap-ui-rowindex="${index}"]`).first().click()
    await page.getByRole('button', { name: 'Edit Selected…' }).click()
    const dialog = page.getByRole('dialog')
    const [add, remove] = [dialog.getByRole('textbox').nth(0), dialog.getByRole('textbox').nth(1)]
    await add.click()
    await add.pressSequentially('regression ')
    await remove.click()
    await remove.pressSequentially('eu,')
    await expect(dialog.locator('.aemTag')).toHaveText(['regression', 'eu'])
    await page.screenshot({ path: test.info().outputPath('tags-bulk.png') })
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(row.locator('.aemTag')).toHaveText(['regression', 'smoke'])
  })
})
