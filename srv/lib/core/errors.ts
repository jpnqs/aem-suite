/** An error CAP sends to the client with the given HTTP status (instead of 500). */
export class HttpError extends Error {
  readonly code: number
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.code = status
  }
}

export function httpError(status: number, message: string): HttpError {
  return new HttpError(status, message)
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Cuts a text to `max` characters, marking the cut with "...". */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s
}
