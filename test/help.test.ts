import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderGuide, slug } from '../srv/lib/help-content'
import { startServer, users, withAemSuiteConfig } from './helpers'

const { GET } = startServer()
const root = path.join(__dirname, '..')
const { tester, noRole } = users

describe('help (user guide rendered from Markdown)', () => {
  describe('rendering', () => {
    const markdown = fs.readFileSync(path.join(root, 'docs/user-guide.md'), 'utf8')
    const guide = renderGuide(markdown)
    const byId = new Map(guide.sections.map((s) => [s.id, s]))
    /** the anchors of all sections and their sub headings */
    const allIds = new Set(guide.sections.flatMap((s) => [s.id, ...JSON.parse(s.headings).map((h: { id: string }) => h.id)]))

    it('makes the guide sections, the table of contents is not one of them', () => {
      expect(guide.title).toBe('AEM Test Suite – User Guide')
      expect(guide.sections[0]).toMatchObject({ id: 'overview', number: 1, title: 'Overview' })
      expect(guide.sections.map((s) => s.title)).not.toContain('Contents')
      expect(guide.sections.length).toBeGreaterThanOrEqual(12)
      for (const s of guide.sections) {
        expect(s.html.length).toBeGreaterThan(0)
        expect(s.html).not.toContain('<hr') // the --- between sections is layout
      }
    })

    it('creates the same anchors as GitHub', () => {
      expect(slug('8. Watch messages live (Live Subscriber)')).toBe('8-watch-messages-live-live-subscriber')
      expect(slug('11. Use an AI assistant (MCP)')).toBe('11-use-an-ai-assistant-mcp')
      expect(slug('Export and import')).toBe('export-and-import')
      const twice = renderGuide('# T\n\n## A\n\n### Same\n\n### Same\n')
      expect(JSON.parse(twice.sections[1].headings).map((h: { id: string }) => h.id)).toEqual(['same', 'same-1'])
    })

    it('every link inside the guide leads to a heading of the guide', () => {
      const targets = [...markdown.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1])
      expect(targets.length).toBeGreaterThan(10)
      expect(targets.filter((t) => !allIds.has(t))).toEqual([])
    })

    it('renders tables and code, escapes raw HTML and opens other sites in a new tab', () => {
      const g = renderGuide(
        ['# T', '', '## A', '', '| a | b |', '|---|---|', '| 1 | <b>x</b> |', '', '```json', '{"a":1}', '```', '', '<script>alert(1)</script>', '', '[site](https://example.com) and [here](#a)'].join('\n')
      )
      const html = g.sections[1].html
      expect(html).toContain('<div class="aemDocTable"><table>')
      expect(html).toContain('class="language-json"')
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('<b>x</b>')
      expect(html).toContain('&lt;script&gt;')
      expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"')
      expect(html).toContain('<a href="#a">here</a>')
    })

    it('gives sub headings for the navigation and plain text for the search', () => {
      const s = byId.get('5-create-and-edit-a-test-case')!
      const headings = JSON.parse(s.headings) as { id: string; title: string; level: number }[]
      expect(headings.length).toBeGreaterThan(2)
      expect(headings.every((h) => h.level >= 3 && h.id && h.title)).toBe(true)
      expect(s.text).toMatch(/topic/i)
      expect(s.text).not.toMatch(/<[a-z]+>/) // no markup
    })

    it('links from the apps point to existing sections', () => {
      // the Help buttons of all apps use the sections listed in app/_shared/Help.js
      const help = fs.readFileSync(path.join(root, 'app', '_shared', 'Help.js'), 'utf8')
      const table = /var SECTIONS = \{([^}]*)\}/.exec(help)![1]
      const referenced = [...table.matchAll(/(\w+): "([a-z0-9-]+)"/g)].map((m) => ({ key: m[1], id: m[2] }))
      expect(referenced.map((r) => r.key)).toEqual(
        expect.arrayContaining(['brokers', 'variables', 'folders', 'testcases', 'run', 'runs', 'subscriber', 'messages'])
      )
      expect(referenced.filter((r) => !allIds.has(r.id))).toEqual([])
    })
  })

  describe('service', () => {
    it('serves the sections to every logged-in user, not to anonymous callers', async () => {
      const res = await GET('/odata/v4/help/Sections?$select=id,number,title&$orderby=number', tester)
      expect(res.status).toBe(200)
      expect(res.data.value[0]).toMatchObject({ id: 'overview', number: 1, title: 'Overview' })
      expect(res.data.value.length).toBeGreaterThanOrEqual(12)
      expect((await GET('/odata/v4/help/Sections', noRole)).status).toBe(200)
      expect((await GET('/odata/v4/help/Sections')).status).toBe(401)
    })

    it('serves one section with its HTML', async () => {
      const res = await GET("/odata/v4/help/Sections('6-run-tests')", tester)
      expect(res.status).toBe(200)
      expect(res.data.html).toContain('<h2 id="6-run-tests">')
      expect(res.data.headings).toMatch(/"level":3/)
      expect((await GET("/odata/v4/help/Sections('nope')", tester)).status).toBe(404)
    })

    it('follows changes of the file, and says so if there is none', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aem-help-'))
      const file = path.join(dir, 'guide.md')
      try {
        await withAemSuiteConfig({ help: { file } }, async () => {
          fs.writeFileSync(file, '# Guide\n\nHello\n\n## First\n\nOne\n')
          const first = await GET('/odata/v4/help/Sections?$orderby=number', tester)
          expect(first.data.value.map((s: { title: string }) => s.title)).toEqual(['Overview', 'First'])

          // the modification time is checked on every request
          fs.writeFileSync(file, '# Guide\n\nHello\n\n## First\n\nOne\n\n## Second\n\nTwo\n')
          fs.utimesSync(file, new Date(), new Date(Date.now() + 5000))
          const second = await GET('/odata/v4/help/Sections?$orderby=number', tester)
          expect(second.data.value.map((s: { title: string }) => s.title)).toEqual(['Overview', 'First', 'Second'])

          fs.rmSync(file)
          const gone = await GET('/odata/v4/help/Sections', tester)
          expect(gone.status).toBe(404)
          expect(gone.data.error.message).toMatch(/user guide is not available/)
        })
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
