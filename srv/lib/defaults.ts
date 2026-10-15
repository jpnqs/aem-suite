/**
 * "Smart defaults": completes user input so less has to be typed - and the runtime defaults
 * for values left empty (the same as the `default`s in db/schema.cds).
 */

export const DEFAULT_CLIENT_NAME_PREFIX = 'aem-suite'
export const DEFAULT_CONNECT_TIMEOUT_MS = 10000
export const DEFAULT_ACK_TIMEOUT_MS = 5000

/** Gap between the sortOrder of siblings (10, 20, 30 ...), so a node can be put in between. */
export const SORT_STEP = 10

/** application/json if the payload looks like JSON ({ or [), otherwise text/plain. */
export function detectContentType(payload: string | null | undefined): string {
  const t = (payload ?? '').trim()
  return !t || t.startsWith('{') || t.startsWith('[') ? 'application/json' : 'text/plain'
}

export const STARTER_PAYLOAD = `{
  "id": "{{uuid}}",
  "createdAt": "{{now}}",
  "data": {}
}`

export const STARTER_CORRELATION_ID = '{{uuid}}'
