import cds from '@sap/cds'
import { getDestination } from '@sap-cloud-sdk/connectivity'
import {
  currentJwt,
  MissingPasswordError,
  MissingUsernameError,
  needsPassword,
  needsUsername,
  resolveConnection
} from '../srv/lib/credentials/resolve'
import { toSmfUrl } from '../srv/lib/broker-url'

// DESTINATION brokers: the BTP Destination service is replaced, as in destinations.test.ts
jest.mock('@sap-cloud-sdk/connectivity', () => ({ getDestination: jest.fn() }))
const lookup = getDestination as jest.Mock

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
  const broker = { ID: '1', name: 'dev', credentialMode: 'DIRECT' as const, url: 'wss://h:443', msgVpn: 'v', username: 'u' }

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

describe('resolveConnection (DESTINATION)', () => {
  const broker = { ID: '2', name: 'aem-dev', credentialMode: 'DESTINATION' as const, destinationName: 'aem-dev-dest' }
  afterEach(() => lookup.mockReset())

  it('takes URL, VPN and credentials from the destination, with the user\'s token', async () => {
    lookup.mockResolvedValue({ url: 'https://mr-dev.messaging.solace.cloud:443', username: 'solace-cloud-client', password: 'secret', originalProperties: { msgVpn: 'dev' } })
    await expect(resolveConnection(broker, 'jwt-1')).resolves.toMatchObject({
      url: 'wss://mr-dev.messaging.solace.cloud:443',
      vpnName: 'dev',
      userName: 'solace-cloud-client',
      password: 'secret',
      brokerName: 'aem-dev'
    })
    expect(lookup).toHaveBeenCalledWith({ destinationName: 'aem-dev-dest', jwt: 'jwt-1', useCache: true })
  })

  it('prefers the smfUrl property and connects without credentials if the destination has none', async () => {
    lookup.mockResolvedValue({ url: 'https://ignored', originalProperties: { smfUrl: 'tcps://mr-dev:55443', msgVpn: 'dev' } })
    await expect(resolveConnection(broker)).resolves.toMatchObject({ url: 'tcps://mr-dev:55443', userName: '', password: '' })
  })

  it.each([
    ['no destination name on the broker', { ...broker, destinationName: null }, undefined, 'Broker "aem-dev": no destination name maintained'],
    ['the destination does not exist', broker, null, 'Destination "aem-dev-dest" not found'],
    ['the destination has no msgVpn', broker, { url: 'https://h', originalProperties: {} }, 'Destination "aem-dev-dest": additional property "msgVpn" missing'],
    ['the destination has no URL', broker, { originalProperties: { msgVpn: 'dev' } }, 'Destination "aem-dev-dest": URL missing'],
    ['the URL is no broker URL', broker, { url: 'ftp://h', originalProperties: { msgVpn: 'dev' } }, 'Unsupported']
  ])('fails when %s', async (_case, b, destination, message) => {
    lookup.mockResolvedValue(destination)
    await expect(resolveConnection(b)).rejects.toThrow(message)
  })
})

describe('currentJwt', () => {
  afterEach(() => {
    cds.context = undefined
  })

  it('is the bearer token of the current request, if there is one', () => {
    const withHeader = (authorization?: string) => (cds.context = { http: { req: { headers: { authorization } } } } as never)
    withHeader('Bearer abc.def')
    expect(currentJwt()).toBe('abc.def')
    withHeader('Basic dGVzdGVyOnRlc3Rlcg==')
    expect(currentJwt()).toBeUndefined()
    cds.context = undefined
    expect(currentJwt()).toBeUndefined()
  })
})
