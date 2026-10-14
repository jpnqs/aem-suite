import { MissingPasswordError, needsPassword, resolveConnection, toSmfUrl } from '../srv/lib/credentials/resolve'

describe('toSmfUrl', () => {
  it.each([
    ['https://host:443', 'wss://host:443'],
    ['http://host:80', 'ws://host:80'],
    ['wss://host:443', 'wss://host:443'],
    ['tcps://host:55443', 'tcps://host:55443'],
    ['  wss://host  ', 'wss://host']
  ])('%s -> %s', (input, expected) => expect(toSmfUrl(input)).toBe(expected))

  it('rejects other schemes', () => expect(() => toSmfUrl('ftp://x')).toThrow(/Unsupported/))
})

describe('resolveConnection (DIRECT)', () => {
  const broker = { ID: '1', name: 'dev', credentialMode: 'DIRECT', url: 'wss://h:443', msgVpn: 'v', username: 'u' }

  it('uses the password passed in for this connection', async () => {
    await expect(resolveConnection(broker, undefined, 'pw')).resolves.toMatchObject({ userName: 'u', password: 'pw', vpnName: 'v' })
  })

  it('refuses to connect without a password', async () => {
    await expect(resolveConnection(broker)).rejects.toBeInstanceOf(MissingPasswordError)
  })

  it('needs a password only for direct brokers', () => {
    expect(needsPassword({ credentialMode: 'DIRECT' })).toBe(true)
    expect(needsPassword({ credentialMode: 'DESTINATION' })).toBe(false)
  })
})
