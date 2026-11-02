import { test, expect, type APIRequestContext } from '@playwright/test'
import { deleteAfterEach, uniqueName } from './cleanup'
import { apps, expectAppOpen, openApp, testCaseUrl } from './launchpad'

// Tags as pills (app/testcases/webapp/ext/TagsInput.ts): typed in the object page, shown in the list; the tags in
// use are suggested and can be picked from a value help.

test.describe('tags', () => {
  const track = deleteAfterEach()

  async function createTestCase(request: APIRequestContext, name: string, tags?: string): Promise<{ ID: string }> {
    const draft = await (await request.post('/odata/v4/test/TestCases', { data: { name, topic: 'e2e/tags', payload: '{}', tags } })).json()
    const activated = await request.post(`/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=false)/TestService.draftActivate`, { data: {} })
    expect(activated.ok()).toBeTruthy()
    track(`/odata/v4/test/TestCases(ID=${draft.ID},IsActiveEntity=true)`)
    return draft
  }

  test('typed words become pills, are saved and show in the list', async ({ page }) => {
    const name = uniqueName('E2E_TAGS')
    const draft = await createTestCase(page.request, name)

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

  test('suggests the tags in use and offers them in a value help', async ({ page }) => {
    // a tag only this test uses: "nightly-<unique>"
    const tag = `nightly-${uniqueName('x').slice(2).toLowerCase()}`
    await createTestCase(page.request, uniqueName('E2E_TAGS_USED'), tag)
    const draft = await createTestCase(page.request, uniqueName('E2E_TAGS_VH'))

    await page.goto(testCaseUrl(draft.ID))
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const section = page.locator('[id$="CustomSection::tags"]').first()
    const input = section.getByRole('textbox')
    const pills = section.locator('.aemTag')

    // typing a part of it suggests it (with its count), picking it makes a pill
    await input.click()
    await input.pressSequentially(tag.slice(2, 10))
    const suggestion = page.getByRole('option', { name: new RegExp(tag) })
    await expect(suggestion).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('tags-suggest.png') })
    await suggestion.click()
    await expect(pills).toHaveText([tag])
    await expect(input).toHaveValue('')

    // the value help lists it ticked; a tag ticked before a search stays ticked; unticking removes the pill
    await input.pressSequentially('zz-e2e,')
    await section.locator('.sapMInputBaseIcon').last().click()
    const dialog = page.getByRole('dialog', { name: 'Tags in Use' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('searchbox').fill(tag)
    await dialog.getByRole('searchbox').press('Enter')
    const item = dialog.getByRole('listitem').filter({ hasText: tag }).getByRole('checkbox')
    await expect(item).toBeChecked()
    await expect(dialog.getByRole('listitem')).toHaveCount(1)
    await page.screenshot({ path: test.info().outputPath('tags-value-help.png') })
    await item.click()
    await dialog.getByRole('button', { name: 'Select' }).click()
    await expect(pills).toHaveText(['zz-e2e'])
    // no draft left (the cleanup deletes the active test case)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  })

  test('the list filters by tags, picked as pills', async ({ page }) => {
    const tag = `filter-${uniqueName('x').slice(2).toLowerCase()}`
    const tagged = uniqueName('E2E_TAGS_IN')
    const other = uniqueName('E2E_TAGS_OUT')
    await createTestCase(page.request, tagged, `${tag}, smoke`)
    await createTestCase(page.request, other, 'smoke')

    await openApp(page, apps.testCases)
    await expectAppOpen(page, apps.testCases)
    await page.getByRole('option', { name: 'All Test Cases' }).click()
    // the list loaded (it takes the focus when it is done)
    await expect(page.getByRole('row').filter({ hasText: other })).toBeVisible()
    const field = page.locator('[id*="FilterField::tags"]')
    const filter = field.getByRole('textbox')
    await filter.click()
    // a whole tag and a comma (suggestions: see the test above)
    await filter.pressSequentially(`${tag},`)
    await expect(field.locator('.aemTag')).toHaveText([tag])
    await expect(filter).toHaveValue('')
    // the request: "contains" per tag
    const list = page.waitForRequest((r) => decodeURIComponent(r.postData() ?? '').includes(`contains(tags,'${tag}')`))
    await page.getByRole('button', { name: 'Go', exact: true }).click()
    await list
    await expect(page.getByRole('row').filter({ hasText: tagged })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: other })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('tags-filter.png') })
  })
})
