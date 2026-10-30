import MarkdownIt from 'markdown-it'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

/**
 * The documentation of a test case or folder (its description) is stored as Markdown - that is what the export
 * files hold. The object page edits it as HTML in a rich text editor: the server renders the Markdown for it
 * (descriptionHtml) and turns what the editor sends back into Markdown.
 */
const md = new MarkdownIt({ html: false, linkify: true })

const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const t = tokens[idx]
  if (/^https?:\/\//i.test(String(t.attrGet('href') ?? ''))) {
    t.attrSet('target', '_blank')
    t.attrSet('rel', 'noopener noreferrer')
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' })
// tables and strikethrough
turndown.use(gfm)
// nothing of the editor that Markdown cannot hold (scripts, styles, embedded objects) gets into the text
turndown.remove(['script', 'style', 'iframe', 'object', 'embed'])

/** HTML of the documentation; null if there is none. */
export function renderDocumentation(markdown?: string | null): string | null {
  if (!markdown?.trim()) return null
  return md.render(markdown)
}

/** Markdown of what the rich text editor sends; null if it is empty. */
export function documentationFromHtml(html?: string | null): string | null {
  if (!html?.trim()) return null
  const markdown = turndown.turndown(html).trim()
  return markdown || null
}
