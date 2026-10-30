/** Minimal typings for turndown-plugin-gfm (the package ships none). */
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown'
  /** tables, strikethrough, task lists and highlighted code blocks */
  export const gfm: TurndownService.Plugin
}
