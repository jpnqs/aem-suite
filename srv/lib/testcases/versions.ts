import cds from '@sap/cds'
import { TestCaseProperties, TestCases, TestCaseVariables, TestCaseVersions } from '#cds-models/aem/suite'
import { httpError, truncate } from '../core/errors'
import { columnLength } from '../core/model'
import { selectNodeDeep } from './nodes'
import { TEST_FIELDS } from './test-fields'
import type { PropertyType } from './property-types'

/** the drafts of test cases (lean draft tables of the UI service) */
export const DRAFTS = 'TestService.TestCases.drafts'

/**
 * Versions of test cases and folders: every save keeps the state (fields, user properties, variables) as a
 * TestCaseVersions row; the last MAX_VERSIONS per node stay. A version can be restored - that is a save of its own,
 * so it can be undone the same way.
 */

export const MAX_VERSIONS = 50

interface Snapshot {
  fields: Record<string, unknown>
  userProperties: { name: string; type?: PropertyType | null; value?: string | null }[]
  variables: { name: string; value?: string | null }[]
}

async function snapshotOf(id: string): Promise<Snapshot | undefined> {
  const row = await selectNodeDeep(id)
  if (!row) return undefined
  return {
    fields: Object.fromEntries(Object.keys(TEST_FIELDS).map((f) => [f, (row as Record<string, unknown>)[f] ?? null])),
    userProperties: (row.userProperties ?? []).map((p) => ({ name: p.name, type: p.type ?? null, value: p.value ?? null })).sort((a, b) => a.name.localeCompare(b.name)),
    variables: (row.variables ?? []).map((v) => ({ name: v.name, value: v.value ?? null })).sort((a, b) => a.name.localeCompare(b.name))
  }
}

/** What differs between two snapshots: the field names, "user properties", "variables". */
function changesBetween(before: Snapshot | undefined, after: Snapshot): string[] {
  if (!before) return ['created']
  const fields = Object.keys(after.fields).filter((f) => JSON.stringify(before.fields[f] ?? null) !== JSON.stringify(after.fields[f] ?? null))
  if (JSON.stringify(before.userProperties) !== JSON.stringify(after.userProperties)) fields.push('user properties')
  if (JSON.stringify(before.variables) !== JSON.stringify(after.variables)) fields.push('variables')
  return fields
}

/**
 * Keeps the current state of a node as a new version - unless nothing changed since the last one.
 * `note` is put in front of the changes (e.g. "restored version 3").
 */
export async function recordVersion(id: string, note?: string): Promise<void> {
  const snapshot = await snapshotOf(id)
  if (!snapshot) return
  const last = (await SELECT.one.from(TestCaseVersions).columns('version', 'snapshot').where({ testCase_ID: id }).orderBy('version desc')) as
    | { version: number; snapshot: string }
    | undefined
  const before = last ? (JSON.parse(last.snapshot) as Snapshot) : undefined
  const changes = changesBetween(before, snapshot)
  if (!changes.length && !note) return
  const version = (last?.version ?? 0) + 1
  await INSERT.into(TestCaseVersions).entries({
    ID: cds.utils.uuid(),
    testCase_ID: id,
    version,
    savedAt: new Date().toISOString(),
    savedBy: cds.context?.user?.id ?? null,
    name: truncate(String(snapshot.fields.name ?? ''), columnLength('TestCaseVersions', 'name')),
    changes: truncate([note, ...changes].filter(Boolean).join(', '), columnLength('TestCaseVersions', 'changes')),
    snapshot: JSON.stringify(snapshot)
  })
  if (version > MAX_VERSIONS) await DELETE.from(TestCaseVersions).where({ testCase_ID: id, version: { '<=': version - MAX_VERSIONS } })
}

/** Puts a node back to the state of a version (a new version records that). Refused while someone edits the node. */
export async function restoreVersion(versionId: string): Promise<{ ID: string; version: number }> {
  const v = (await SELECT.one.from(TestCaseVersions).columns('testCase_ID', 'version', 'snapshot').where({ ID: versionId })) as
    | { testCase_ID: string; version: number; snapshot: string }
    | undefined
  if (!v) throw httpError(404, 'Version not found')
  const id = v.testCase_ID
  const node = await SELECT.one.from(TestCases).columns('ID', 'kind').where({ ID: id })
  if (!node) throw httpError(404, 'The test case of this version no longer exists')
  const draft = await SELECT.one.from(DRAFTS).columns('ID').where({ ID: id })
  if (draft) throw httpError(409, 'The test case is being edited - save or discard the draft first')
  const snapshot = JSON.parse(v.snapshot) as Snapshot
  // a folder keeps being a folder: only the fields the version has
  await UPDATE(TestCases, id).with({ ...snapshot.fields, modifiedAt: new Date().toISOString() })
  await DELETE.from(TestCaseProperties).where({ testCase_ID: id })
  if (snapshot.userProperties.length) await INSERT.into(TestCaseProperties).entries(snapshot.userProperties.map((p) => ({ ...p, testCase_ID: id })))
  await DELETE.from(TestCaseVariables).where({ testCase_ID: id })
  if (snapshot.variables.length) await INSERT.into(TestCaseVariables).entries(snapshot.variables.map((x) => ({ ...x, testCase_ID: id })))
  await recordVersion(id, `restored version ${v.version}`)
  return { ID: id, version: v.version }
}
