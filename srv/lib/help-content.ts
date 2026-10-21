import cds from '@sap/cds'
import fs from 'node:fs'
import path from 'node:path'
import MarkdownIt from 'markdown-it'
import { config } from './core/config'
import { httpError } from './core/errors'

/**
 * In-app help: the user guide (docs/user-guide.md) rendered to HTML sections for the Help app.
 * The Markdown file stays the only source - it is read on the server, so the browser gets finished, safe HTML
 * (raw HTML inside the Markdown is not passed through) and the UI needs no Markdown library.
 */

export interface GuideSection {
  /** anchor id of the heading, same as GitHub would generate (the guide's table of contents links to it) */
  id: string
  number: number
  title: string
  html: string
  /** plain text, for the search of the Help app */
  text: string
  /** JSON list of the sub headings: [{ id, title, level }] */
  headings: string
}

export interface Guide {
  title: string
  sections: GuideSection[]
}

type Token = MarkdownIt.Token

const INTRO_ID = 'overview'
/** sections that only repeat the navigation */
const SKIPPED = ['contents']

/** Pictures in the guide are written as images/<path>.png (relative to docs/, so they also show on GitHub). */
export const GUIDE_IMAGES = 'images/'
/** ...and reach the Help app under this path (relative to the app; srv/server.ts serves the folder) */
export const IMAGE_ROUTE = 'docs-images'

/**
 * Location of the guide: docs/user-guide.md in the project (copied next to the server on deployment, see
 * scripts/build-docs.js). `cds.aemSuite.help.file` overrides it (relative to the project root).
 */
export const guideFile = (): string => path.resolve(cds.root, config().help.file)

/** The pictures of the guide: the images folder next to the guide file. */
export const imagesDir = (): string => path.join(path.dirname(guideFile()), 'images')

let cached: { mtimeMs: number; guide: Guide } | undefined

/** The rendered guide; re-rendered when the file changed (so edits show up while developing). */
export function loadGuide(): Guide {
  const file = guideFile()
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    throw httpError(404, 'The user guide is not available on this system.')
  }
  if (!cached || cached.mtimeMs !== stat.mtimeMs) cached = { mtimeMs: stat.mtimeMs, guide: renderGuide(fs.readFileSync(file, 'utf8')) }
  return cached.guide
}

/** Same anchors as GitHub: lower case, punctuation removed, spaces to hyphens ("8. Watch (Live)" -> "8-watch-live"). */
export function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  )
}

export function renderGuide(markdown: string): Guide {
  const md = new MarkdownIt({ html: false, linkify: false })
  // wide tables scroll inside the page instead of breaking the layout
  md.renderer.rules.table_open = () => '<div class="aemDocTable"><table>\n'
  md.renderer.rules.table_close = () => '</table></div>\n'
  // pictures: images/x.png -> docs-images/x.png (served by the backend), scaled to the page, loaded when scrolled to
  md.renderer.rules.image = (tokens, idx) => {
    const t = tokens[idx]
    const src = String(t.attrGet('src') ?? '')
    const local = src.startsWith(GUIDE_IMAGES) && !src.includes('..')
    const alt = md.utils.escapeHtml(t.content)
    const url = md.utils.escapeHtml(local ? IMAGE_ROUTE + '/' + src.slice(GUIDE_IMAGES.length) : '')
    // a click opens the picture in full size in a new tab
    return `<a href="${url}" target="_blank" rel="noopener noreferrer"><img class="aemDocImage" src="${url}" alt="${alt}" title="${alt}" loading="lazy"></a>`
  }

  const tokens = md.parse(markdown, {})

  // anchor ids for all headings (unique, like GitHub: -1, -2, ... for repeats)
  const used = new Map<string, number>()
  const unique = (title: string) => {
    const base = slug(title)
    const n = used.get(base) ?? 0
    used.set(base, n + 1)
    return n ? `${base}-${n}` : base
  }
  const titleOf = (i: number) => tokens[i + 1]?.content ?? ''
  tokens.forEach((t, i) => {
    if (t.type === 'heading_open') t.attrSet('id', unique(titleOf(i)))
    // links to other sites open in a new tab
    if (t.type === 'inline')
      for (const c of t.children ?? [])
        if (c.type === 'link_open' && /^https?:\/\//i.test(String(c.attrGet('href') ?? ''))) {
          c.attrSet('target', '_blank')
          c.attrSet('rel', 'noopener noreferrer')
        }
  })

  // cut into sections at every top level "## " heading
  // (what comes before the first "## " - the title and the introduction - is the "Overview" section)
  const groups: { id: string; title: string; tokens: Token[] }[] = [{ id: INTRO_ID, title: 'Overview', tokens: [] }]
  let docTitle = 'User guide'
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'hr' && t.level === 0) continue // the "---" lines between sections
    if (t.type === 'heading_open' && t.level === 0 && t.tag === 'h2') groups.push({ id: String(t.attrGet('id')), title: titleOf(i), tokens: [] })
    if (t.type === 'heading_open' && t.tag === 'h1' && docTitle === 'User guide') docTitle = titleOf(i)
    groups[groups.length - 1].tokens.push(t)
  }

  const sections = groups
    .filter((g) => g.tokens.length && !SKIPPED.includes(g.title.toLowerCase()))
    .map((g, index) => ({
      id: g.id,
      number: index + 1,
      title: g.title,
      html: md.renderer.render(g.tokens, md.options, {}),
      text: plainText(g.tokens),
      headings: JSON.stringify(
        g.tokens
          .map((t, i) => ({ t, i }))
          .filter(({ t }) => t.type === 'heading_open' && Number(t.tag.slice(1)) >= 3)
          .map(({ t, i }) => ({ id: String(t.attrGet('id')), title: g.tokens[i + 1].content, level: Number(t.tag.slice(1)) }))
      )
    }))
  return { title: docTitle, sections }
}

function plainText(tokens: Token[]): string {
  const parts: string[] = []
  for (const t of tokens) {
    if (t.type === 'inline' || t.type === 'fence' || t.type === 'code_block') parts.push(t.content)
  }
  return parts.join('\n')
}
