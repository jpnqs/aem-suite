import type { Application, Request, Response, NextFunction } from 'express'
import type { OutgoingHttpHeaders } from 'node:http'

/**
 * Answers MCP requests with plain JSON instead of a server-sent event stream.
 *
 * `@cap-js/mcp` (stateless, no option for it) answers every request as `text/event-stream`. Proxies between the
 * client and Cloud Foundry (company web filters, VPNs) may hold such a stream back, so the client waits forever
 * for the answer to `initialize`. The endpoint is stateless and sends nothing but the answer, so the stream is
 * collected here and its JSON-RPC response sent as `application/json` - which every MCP client accepts
 * (streamable HTTP transport). Notifications sent before the answer (progress) are dropped; `: keep-alive`
 * comments too.
 */

/** Header names of the stream that make no sense for a JSON body. */
const STREAM_HEADERS = ['content-type', 'content-length', 'cache-control', 'connection', 'transfer-encoding', 'x-accel-buffering']

/** The JSON-RPC messages of an event stream (the `data:` lines of each event). */
export function eventStreamMessages(text: string): unknown[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n')
    )
    .filter(Boolean)
    .map((data) => JSON.parse(data) as unknown)
}

const isResponse = (m: unknown) => !!m && typeof m === 'object' && 'id' in m && ('result' in m || 'error' in m)

function contentType(res: Response, headers: unknown): string {
  const own = headers && typeof headers === 'object' && !Array.isArray(headers) ? (headers as OutgoingHttpHeaders) : undefined
  const type = Object.entries(own ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? res.getHeader('content-type')
  return String(type ?? '')
}

function jsonAnswers(_req: Request, res: Response, next: NextFunction) {
  const { writeHead, write, end } = res
  let chunks: Buffer[] | undefined
  let status = 200
  let headers: OutgoingHttpHeaders = {}

  res.writeHead = function (this: Response, code: number, ...rest: unknown[]) {
    const own = rest.find((r) => r && typeof r === 'object') as OutgoingHttpHeaders | undefined
    if (!contentType(this, own).startsWith('text/event-stream')) return (writeHead as (...a: unknown[]) => Response).call(this, code, ...rest)
    chunks = []
    status = code
    headers = own ?? {}
    return this
  } as typeof res.writeHead

  res.write = function (this: Response, chunk: unknown, ...rest: unknown[]) {
    if (!chunks) return (write as (...a: unknown[]) => boolean).call(this, chunk, ...rest)
    if (chunk != null && typeof chunk !== 'function') chunks.push(Buffer.from(chunk as string | Uint8Array))
    return true
  } as typeof res.write

  res.end = function (this: Response, chunk?: unknown, ...rest: unknown[]) {
    if (!chunks) return (end as (...a: unknown[]) => Response).call(this, chunk, ...rest)
    if (chunk != null && typeof chunk !== 'function') chunks.push(Buffer.from(chunk as string | Uint8Array))
    const stream = Buffer.concat(chunks)
    chunks = undefined
    let messages: unknown[]
    try {
      messages = eventStreamMessages(stream.toString('utf8'))
    } catch {
      // not ours to judge: pass the stream on as it came
      ;(writeHead as (...a: unknown[]) => Response).call(this, status, headers)
      return (end as (...a: unknown[]) => Response).call(this, stream)
    }
    const responses = messages.filter(isResponse)
    const body = JSON.stringify(responses.length === 1 ? responses[0] : responses)
    const kept = Object.fromEntries(Object.entries(headers).filter(([k]) => !STREAM_HEADERS.includes(k.toLowerCase())))
    for (const name of STREAM_HEADERS) this.removeHeader(name)
    ;(writeHead as (...a: unknown[]) => Response).call(this, status, {
      ...kept,
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body)
    })
    return (end as (...a: unknown[]) => Response).call(this, body)
  } as typeof res.end

  next()
}

export function registerMcpJson(app: Application) {
  app.post('/mcp/agent', jsonAnswers)
}
