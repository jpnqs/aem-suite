import cds from '@sap/cds'
import { getAllDestinationsFromDestinationService, getServiceBinding } from '@sap-cloud-sdk/connectivity'
import { isBrokerUrl, readBrokerProps } from '../broker-url'

const LOG = cds.log('aem-destinations')

export interface DestinationInfo {
  name: string
  url: string | null
  msgVpn: string | null
  authentication: string | null
  source: 'BTP' | 'ENV'
}

/**
 * Destinations usable for brokers: from the bound destination service (BTP) and from
 * the env variable "destinations" (local development). Only destinations with a
 * ws(s)/http(s)/tcp(s) URL are listed; msgVpn is shown so the right one is easy to pick.
 */
export async function listDestinations(jwt?: string): Promise<DestinationInfo[]> {
  const result = new Map<string, DestinationInfo>()

  for (const d of fromEnv()) result.set(d.name, d)

  if (getServiceBinding('destination')) {
    try {
      const all = await getAllDestinationsFromDestinationService({ jwt, useCache: true })
      for (const d of all) {
        if (!d.name) continue
        result.set(d.name, {
          name: d.name,
          ...readBrokerProps((d.originalProperties ?? {}) as Record<string, string>, d.url),
          authentication: d.authentication ?? null,
          source: 'BTP'
        })
      }
    } catch (e) {
      LOG.warn('Cannot read destinations from destination service', (e as Error).message)
    }
  }

  return [...result.values()].filter((d) => isBrokerUrl(d.url)).sort((a, b) => a.name.localeCompare(b.name))
}

function fromEnv(): DestinationInfo[] {
  const raw = process.env.destinations
  if (!raw) return []
  try {
    const list = JSON.parse(raw) as Record<string, string>[]
    return list
      .filter((d) => d.name)
      .map((d) => ({
        name: d.name,
        ...readBrokerProps(d, d.url),
        authentication: d.authentication || (d.username ? 'BasicAuthentication' : 'NoAuthentication'),
        source: 'ENV' as const
      }))
  } catch {
    LOG.warn('env variable "destinations" is not valid JSON')
    return []
  }
}
