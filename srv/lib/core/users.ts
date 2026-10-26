import cds from '@sap/cds'
import { Users } from '#cds-models/aem/suite'

/** The name last written per user by this instance: the table is only written when a name is new or changed. */
const written = new Map<string, string>()

/**
 * Keeps the name of the login (XSUAA / IAS token: given_name, family_name) in aem.suite.Users, so lists can show
 * it for createdBy. Mocked and technical users have no name - nothing to keep. Written after the request
 * (cds.spawn), so the request neither waits for it nor fails with it.
 */
export function rememberUser(user: cds.User): void {
  const attr = user.attr as { givenName?: string; familyName?: string } | undefined
  const firstName = String(attr?.givenName ?? '').trim()
  const lastName = String(attr?.familyName ?? '').trim()
  if (!firstName && !lastName) return
  const name = [firstName, lastName].filter(Boolean).join(' ')
  if (written.get(user.id) === name) return
  written.set(user.id, name)
  cds.spawn({ user: cds.User.privileged }, async () => {
    try {
      await UPSERT.into(Users).entries({ ID: user.id, firstName: firstName || null, lastName: lastName || null, name })
    } catch (e) {
      written.delete(user.id)
      cds.log('users').warn(`Could not keep the name of user ${user.id}:`, e)
    }
  })
}
