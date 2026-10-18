import type cds from '@sap/cds'
import { httpError } from './errors'

export interface EntityKey {
  ID: string
  IsActiveEntity?: boolean
}

/**
 * One key element of the entity a request addresses (CAP passes a single key as string, several as object),
 * e.g. the name of a Destination. Undefined if the request addresses no single entity (CREATE, a collection).
 */
export function keyValue(req: cds.Request, element = 'ID'): string | undefined {
  const p = req.params?.[0] as unknown
  if (p === undefined || p === null) return undefined
  return typeof p === 'object' ? ((p as Record<string, unknown>)[element] as string | undefined) : String(p)
}

/** Key of the entity a bound action / CRUD request addresses - parts may be missing (CREATE). */
export function keyOf(req: cds.Request): Partial<EntityKey> {
  const p = req.params?.[0] as unknown
  return { ID: keyValue(req), IsActiveEntity: typeof p === 'object' && p ? (p as EntityKey).IsActiveEntity : undefined }
}

/** The ID of the entity a bound action addresses; a request without one is rejected (400). */
export function idOf(req: cds.Request): string {
  const id = keyValue(req)
  if (!id) throw httpError(400, 'The request addresses no entity (ID missing)')
  return id
}
