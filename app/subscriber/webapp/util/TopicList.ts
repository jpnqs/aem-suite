/**
 * The topic subscriptions of the form: a list of texts that the user types one by one or pastes comma separated.
 * Plain functions on string lists - the controller keeps them in its model.
 */

/** "a/b, c/> ," -> ["a/b", "c/>"] */
export function splitTopics(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** The list with the texts appended: trimmed, without empty ones and without duplicates. */
export function withTopics(list: string[], texts: string[]): string[] {
  const topics = [...list];
  for (const text of texts.map((t) => t.trim())) if (text && !topics.includes(text)) topics.push(text);
  return topics;
}

/** The history of used topics: the ones just used first, then the earlier ones, each once, at most `max`. */
export function rememberTopics(used: string[], history: string[], max: number): string[] {
  return [...new Set([...used, ...history])].slice(0, max);
}
