import { eventStreamMessages } from '../srv/lib/mcp-json'
import { MCP_HEADERS, startServer, users } from './helpers'

const { POST } = startServer()

const raw = (body: object, auth: object | null = users.tester) =>
  POST('/mcp/agent', body, { ...(auth ?? {}), headers: MCP_HEADERS, responseType: 'text', transformResponse: (r: string) => r })

describe('MCP answers as plain JSON', () => {
  it('answers initialize with one JSON body, no event stream', async () => {
    const res = await raw({
      jsonrpc: '2.0',
      id: 7,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Visual Studio Code', version: '1.105' } }
    })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-accel-buffering']).toBeUndefined()
    expect(Number(res.headers['content-length'])).toBe(Buffer.byteLength(String(res.data)))
    const body = JSON.parse(String(res.data))
    expect(body).toMatchObject({ jsonrpc: '2.0', id: 7, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'TestAgentService' } } })
  })

  it('answers tool calls as JSON too', async () => {
    const res = await raw({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(JSON.parse(String(res.data)).result.tools.length).toBeGreaterThan(0)
  })

  it('leaves answers without a stream alone', async () => {
    const notification = await raw({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(notification.status).toBe(202)
    const anonymous = await raw({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, null)
    expect(anonymous.status).toBe(401)
  })
})

describe('eventStreamMessages', () => {
  it('reads the data of every event and skips comments', () => {
    const stream = ': keep-alive\n\nevent: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n' +
      'event: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":1,"result":{}}\r\n\r\n'
    expect(eventStreamMessages(stream)).toEqual([
      { jsonrpc: '2.0', method: 'notifications/progress' },
      { jsonrpc: '2.0', id: 1, result: {} }
    ])
  })

  it('has nothing in an empty stream', () => expect(eventStreamMessages('')).toEqual([]))
})
