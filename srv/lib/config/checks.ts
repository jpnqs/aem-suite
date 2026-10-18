import { toSmfUrl } from '../broker/url'
import { errMsg } from '../core/errors'
import { MAX_LENGTH, RANGE_NAME } from '../template/number-ranges'
import { validateVariables, type Reject } from '../testcases/node-validation'

/**
 * The rules of the admin entities, for saving in the apps (AdminService) and for the import of files
 * (./export-import.ts). They get the complete entity - on an update the saved values merged with the changes.
 */

export interface NumberRangeData {
  name?: string | null
  prefix?: string | null
  suffix?: string | null
  length?: number | null
  start?: number | string | null
  step?: number | null
  maximum?: number | string | null
}

export interface BrokerData {
  credentialMode?: string | null
  destinationName?: string | null
  url?: string | null
  msgVpn?: string | null
  variables?: { name?: string | null }[] | null
}

/** Name (as used in the template), sizes and limits of a number range. Unique names are checked by the caller. */
export function checkNumberRange(d: NumberRangeData, checkName: boolean, reject: Reject): void {
  if (checkName && !RANGE_NAME.test(d.name ?? ''))
    reject(400, 'The name must start with a letter and may contain letters, digits, _ and - (it is used as {{numberRange.<name>}})', 'in/name')
  if (d.length != null && (d.length < 0 || d.length > MAX_LENGTH)) reject(400, `The length must be between 0 and ${MAX_LENGTH} digits (0 = no leading zeros)`, 'in/length')
  if (d.step != null && d.step < 1) reject(400, 'The step must be at least 1', 'in/step')
  if (d.start != null && BigInt(d.start) < 0n) reject(400, 'The start must not be negative', 'in/start')
  if (d.maximum != null && d.start != null && BigInt(d.maximum) < BigInt(d.start)) reject(400, 'The maximum must not be below the start', 'in/maximum')
  if (d.prefix && d.prefix.includes('{{')) reject(400, 'Prefix and suffix are plain text, no variables', 'in/prefix')
  if (d.suffix && d.suffix.includes('{{')) reject(400, 'Prefix and suffix are plain text, no variables', 'in/suffix')
}

/** Connection data of a broker (URL already completed) and its variables. */
export function checkBroker(d: BrokerData, event: 'CREATE' | 'UPDATE', reject: Reject): void {
  if (d.credentialMode === 'DESTINATION') {
    if (!d.destinationName) reject(400, 'Destination name is required', 'in/destinationName')
  } else if (d.credentialMode === 'DIRECT' || event === 'CREATE') {
    if (!d.url) reject(400, 'URL is required', 'in/url')
    if (!d.msgVpn) reject(400, 'Message VPN is required', 'in/msgVpn')
    // username is optional: if empty, it is asked for together with the password
  }
  if (d.url) {
    try {
      toSmfUrl(d.url)
    } catch (e) {
      reject(400, errMsg(e), 'in/url')
    }
  }
  // connectTimeoutMs and credentialMode: @assert.range in db/schema.cds
  // broker variables follow the same rules as test case variables (a deep update sends the whole list)
  validateVariables(d.variables, reject)
}
