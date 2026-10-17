import cds from '@sap/cds'

/**
 * Facts of db/schema.cds read from the loaded model, so column sizes and enum values are kept in one place.
 * Entity names without the namespace: columnLength('RunResults', 'resolvedTopic').
 */

type Element = { length?: number; enum?: Record<string, unknown>; '@assert.range'?: unknown }

export function elementOf(entity: string, element: string): Element | undefined {
  const def = cds.model?.definitions[`aem.suite.${entity}`] as { elements?: Record<string, Element> } | undefined
  return def?.elements?.[element]
}

/**
 * Length of a String column. Direct database writes are not checked by CAP, and HANA rejects a value that is
 * too long (SQLite does not), so everything written that way is cut to this length.
 * Without a loaded model (unit tests of single modules) there is no limit.
 */
export function columnLength(entity: string, element: string): number {
  if (!cds.model) return Infinity
  const length = elementOf(entity, element)?.length
  if (!length) throw new Error(`aem.suite.${entity}.${element} is not a String column with a length`)
  return length
}

/** The values of an enum-typed element. */
export const enumValues = (entity: string, element: string): string[] => Object.keys(elementOf(entity, element)?.enum ?? {})

/** The limits of a numeric element with @assert.range: [min, max]. */
export function rangeOf(entity: string, element: string): [number, number] | undefined {
  const range = elementOf(entity, element)?.['@assert.range']
  return Array.isArray(range) && range.length === 2 ? [Number(range[0]), Number(range[1])] : undefined
}
