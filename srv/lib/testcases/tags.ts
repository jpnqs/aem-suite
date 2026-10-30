import { TestCases } from '#cds-models/aem/suite'

/**
 * Tags of test cases and folders: words to find and run them by ("smoke", "regression", "eu"). Stored in
 * TestCases.tags as one text - lower case, without duplicates, sorted, ", " between them - so a filter
 * "contains smoke" finds them and two equal sets are equal texts.
 */

const TAG = /^[a-z0-9][a-z0-9._-]*$/
export const TAG_RULE = 'A tag is one word: letters, digits, . _ - (e.g. smoke, release-2.1)'

/** The tags of a text ("Smoke,  regression smoke" -> ["regression", "smoke"]): separated by commas or blanks. */
export function tagsOf(text: string | null | undefined): string[] {
  return [
    ...new Set(
      (text ?? '')
        .split(/[,;\s]+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    )
  ].sort()
}

/** The stored form: "regression, smoke", null without tags. */
export function joinTags(tags: string[]): string | null {
  return tags.length ? [...new Set(tags)].sort().join(', ') : null
}

export const normalizeTags = (text: string | null | undefined): string | null => joinTags(tagsOf(text))

/** The tags that break the rule. */
export const invalidTags = (text: string | null | undefined): string[] => tagsOf(text).filter((t) => !TAG.test(t) || t.length > 50)

export interface TagCount {
  tag: string
  /** test cases and folders with the tag */
  count: number
}

/** All tags in use (saved test cases and folders), the most used first - the value help of the tags field. */
export async function knownTags(): Promise<TagCount[]> {
  const rows = (await SELECT.from(TestCases).columns('tags').where('tags is not null')) as { tags: string }[]
  const counts = new Map<string, number>()
  for (const row of rows) for (const tag of tagsOf(row.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}
