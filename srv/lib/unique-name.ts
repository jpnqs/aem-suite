/**
 * Names users type and pick from lists (global variables, number ranges, subscriber setups) are unique regardless
 * of case: "Orders" and "orders" side by side only confuse. The tables are small, so the comparison runs in memory
 * and works the same on SQLite and HANA.
 */
export async function nameTaken(entity: string, name: string, ownId: string | undefined, where: Record<string, unknown> = {}): Promise<boolean> {
  const rows = (await SELECT.from(`aem.suite.${entity}`).columns('ID', 'name').where(where)) as { ID: string; name: string | null }[]
  const wanted = name.toLowerCase()
  return rows.some((r) => r.ID !== ownId && (r.name ?? '').toLowerCase() === wanted)
}
