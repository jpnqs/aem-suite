import type cds from '@sap/cds'

export interface EntityKey {
  ID: string
  IsActiveEntity?: boolean
}

/** Key of the entity a bound action / CRUD request addresses (CAP passes it as string or as object). */
export function keyOf(req: cds.Request): EntityKey {
  const p = req.params?.[0] as unknown
  return typeof p === 'string' ? { ID: p } : ((p as EntityKey | undefined) ?? ({} as EntityKey))
}
