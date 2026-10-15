import {
  MissingPasswordError,
  MissingUsernameError,
  needsPassword,
  needsUsername,
  resolveConnection,
  toSmfUrl
} from '../srv/lib/credentials/resolve'

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

  describe('username is optional on the broker', () => {
    const noUser = { ...broker, username: null }

    it('takes the username entered for this connection', async () => {
      await expect(resolveConnection(noUser, undefined, 'pw', ' alice ')).resolves.toMatchObject({ userName: 'alice', password: 'pw' })
    })

    it('refuses to connect without any username', async () => {
      await expect(resolveConnection(noUser, undefined, 'pw')).rejects.toBeInstanceOf(MissingUsernameError)
      await expect(resolveConnection(noUser, undefined, 'pw', '  ')).rejects.toBeInstanceOf(MissingUsernameError)
    })

    it('prefers the maintained username over an entered one', async () => {
      await expect(resolveConnection(broker, undefined, 'pw', 'other')).resolves.toMatchObject({ userName: 'u' })
    })

    it('asks for a username only for direct brokers without one', () => {
      expect(needsUsername({ credentialMode: 'DIRECT', username: null })).toBe(true)
      expect(needsUsername({ credentialMode: 'DIRECT', username: '' })).toBe(true)
      expect(needsUsername({ credentialMode: 'DIRECT', username: 'u' })).toBe(false)
      expect(needsUsername({ credentialMode: 'DESTINATION', username: null })).toBe(false)
    })
  })
})
