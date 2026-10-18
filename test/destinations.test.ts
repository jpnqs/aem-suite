import { getAllDestinationsFromDestinationService, getServiceBinding } from '@sap-cloud-sdk/connectivity'
import { listDestinations } from '../srv/lib/broker/destinations'

// The value help for broker destinations: BTP Destination Service and the env variable "destinations".

jest.mock('@sap-cloud-sdk/connectivity', () => ({
  getServiceBinding: jest.fn(),
  getAllDestinationsFromDestinationService: jest.fn()
}))
const binding = getServiceBinding as jest.Mock
const fromService = getAllDestinationsFromDestinationService as jest.Mock

describe('listDestinations', () => {
  const before = process.env.destinations
  afterEach(() => {
    if (before === undefined) delete process.env.destinations
    else process.env.destinations = before
    jest.resetAllMocks()
  })

  it('lists broker destinations of the destination service with the settings the connection uses', async () => {
    binding.mockReturnValue({ name: 'destination' })
    fromService.mockResolvedValue([
      { name: 'aem-prod', url: 'https://mr-prod.messaging.solace.cloud:443', authentication: 'BasicAuthentication', originalProperties: { msgVpn: 'prod' } },
      // only the aem.* properties, and a URL that is not a broker URL
      { name: 'aem-prefixed', url: 'ftp://ignored', authentication: 'NoAuthentication', originalProperties: { 'aem.smfUrl': 'tcps://mr-x:55443', 'aem.msgVpn': 'x' } },
      { name: 'some-api', url: 'ftp://not-a-broker', originalProperties: {} },
      { url: 'https://no-name' }
    ])
    const list = await listDestinations('jwt-1')
    expect(fromService).toHaveBeenCalledWith({ jwt: 'jwt-1', useCache: true })
    expect(list).toEqual([
      { name: 'aem-prefixed', url: 'tcps://mr-x:55443', msgVpn: 'x', authentication: 'NoAuthentication', source: 'BTP' },
      { name: 'aem-prod', url: 'https://mr-prod.messaging.solace.cloud:443', msgVpn: 'prod', authentication: 'BasicAuthentication', source: 'BTP' }
    ])
  })

  it('prefers the destination service over a local destination of the same name', async () => {
    process.env.destinations = JSON.stringify([
      { name: 'shared', url: 'wss://local:443', msgVpn: 'local' },
      { name: 'local-only', url: 'wss://local:443', username: 'u' }
    ])
    binding.mockReturnValue({ name: 'destination' })
    fromService.mockResolvedValue([{ name: 'shared', url: 'wss://btp:443', originalProperties: { msgVpn: 'btp' } }])
    const list = await listDestinations()
    expect(list.map((d) => [d.name, d.source, d.msgVpn])).toEqual([
      ['local-only', 'ENV', null],
      ['shared', 'BTP', 'btp']
    ])
    expect(list[0].authentication).toBe('BasicAuthentication')
  })

  it('still lists local destinations when the destination service fails or is not bound', async () => {
    process.env.destinations = JSON.stringify([{ name: 'local', url: 'wss://local:443' }])
    binding.mockReturnValue({ name: 'destination' })
    fromService.mockRejectedValue(new Error('service down'))
    expect((await listDestinations()).map((d) => d.name)).toEqual(['local'])

    binding.mockReturnValue(undefined)
    expect((await listDestinations()).map((d) => d.name)).toEqual(['local'])
    expect(fromService).toHaveBeenCalledTimes(1)
  })

  it('ignores an env variable that is not valid JSON', async () => {
    process.env.destinations = '[oops'
    expect(await listDestinations()).toEqual([])
  })
})
