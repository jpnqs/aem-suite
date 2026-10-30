import { documentationFromHtml, renderDocumentation } from '../srv/lib/testcases/documentation'
import { draft, resetDatabase, startServer, users } from './helpers'

const { GET, POST, PATCH } = startServer()
const { tester } = users
const TEST = '/odata/v4/test/TestCases'

describe('documentation of test cases and folders (Markdown, edited as HTML)', () => {
  beforeEach(resetDatabase)

  it('renders Markdown without letting HTML of the user through', () => {
    expect(renderDocumentation('# Orders\n\nSends **one** order.')).toBe('<h1>Orders</h1>\n<p>Sends <strong>one</strong> order.</p>\n')
    expect(renderDocumentation('<script>alert(1)</script>')).not.toContain('<script>')
    expect(renderDocumentation('[x](javascript:alert(1))')).not.toContain('href="javascript')
    expect(renderDocumentation('see https://example.com')).toContain('target="_blank"')
    expect(renderDocumentation('  ')).toBeNull()
  })

  it('turns the HTML of the editor into Markdown', () => {
    expect(documentationFromHtml('<h2>Why</h2><p>Checks <strong>orders</strong> and <s>old</s> ones</p><ul><li>EU</li><li>US</li></ul>')).toBe(
      '## Why\n\nChecks **orders** and ~old~ ones\n\n-   EU\n-   US'
    )
    expect(documentationFromHtml('<p>a</p><script>alert(1)</script>')).toBe('a')
    expect(documentationFromHtml('<p></p>')).toBeNull()
  })

  it('keeps Markdown when the object page writes the HTML of the rich text editor', async () => {
    const { data: created } = await POST(TEST, { kind: 'FOLDER', name: 'Orders' }, tester)
    const url = `${TEST}(ID=${created.ID},IsActiveEntity=false)`

    const patched = await PATCH(url, { descriptionHtml: '<h1>Orders</h1><p>All <em>order</em> events</p>' }, tester)
    expect(patched.status).toBe(200)
    expect(patched.data).toMatchObject({ description: '# Orders\n\nAll *order* events', descriptionHtml: '<h1>Orders</h1>\n<p>All <em>order</em> events</p>\n' })

    expect((await draft.activate(POST, 'test', 'TestCases', created.ID)).status).toBe(201)
    const { data: active } = await GET(`${TEST}(ID=${created.ID},IsActiveEntity=true)?$select=description,descriptionHtml`, tester)
    expect(active).toMatchObject({ description: '# Orders\n\nAll *order* events', descriptionHtml: '<h1>Orders</h1>\n<p>All <em>order</em> events</p>\n' })
    // the editor may ask for the HTML alone
    const { data: htmlOnly } = await GET(`${TEST}(ID=${created.ID},IsActiveEntity=true)?$select=descriptionHtml`, tester)
    expect(htmlOnly.descriptionHtml).toBe('<h1>Orders</h1>\n<p>All <em>order</em> events</p>\n')
  })
})
