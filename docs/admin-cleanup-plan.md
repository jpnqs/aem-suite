# Plan: Data Cleanup app (admin)

Branch: `feat/admin-cleanup` · Status: **plan, not implemented** · 2026-10-18

## Goal

An admin-only UI app that deletes old data. The admin picks **what** to clean up (one or more data
categories), sets **how old** it must be (older than N days / weeks / months / years, or before a fixed date)
plus **further criteria** per category, sees a **preview** (counts and sample rows), and then confirms the
deletion. Every cleanup is logged.

Why it is needed: today nothing can be deleted for test runs at all (`TestService.TestRuns` is `@readonly`),
and saved messages can only be deleted by their owner. `RunResults.resolvedPayload` and
`ReceivedMessages.payload` are `LargeString`s, so these tables are what grows on HANA.

## 1. What can be cleaned up (categories)

| # | Category | Entities | Age is measured on | Further criteria |
|---|---|---|---|---|
| A | **Test runs** | `TestRuns` + `RunResults` | `startedAt` (fallback `createdAt`) | outcome (passed / failed / stopped / aborted), started by, broker involved, summary contains, **keep the newest N runs** |
| B | **Run payloads only** (slim instead of delete) | `RunResults.resolvedPayload` set to null | run `startedAt` | same as A; the run and its results stay visible, only the payload text goes |
| C | **Saved messages** | `ReceivedMessages` | `receivedAt` (fallback `createdAt`) | broker, saved by, source type (topic / queue browse / queue consume), topic contains |
| D | **Subscriber setups** | `SubscriberPresets` | `modifiedAt` (not changed since) | user, broker, broker no longer exists / inactive |
| E | **Orphans** (no age) | `ReceivedMessages` / `SubscriberPresets` whose broker was deleted, `TestCaseStats` without test case, `Variables` without broker | – | per orphan type on/off |

Never touched: `RUNNING` runs (and any run in the runner's `activeRuns` map), brokers, test cases, variables
in use, number ranges, code lists. `TestCaseStats` (the "last result" of a test case) stays when its run is
deleted; only `run_ID` is set to null, so the test case list still shows the last outcome.

Age input: `olderThan: { value: Integer, unit: DAYS | WEEKS | MONTHS | YEARS }` **or** `before: Date`.
Months / years are calendar-based (31 Mar − 1 month = 28/29 Feb). The cutoff is computed on the server
(UTC) and shown back in the preview ("everything before 18 Jul 2026, 00:00 UTC").

## 2. Backend

New service **`CleanupService`** (`srv/cleanup-service.cds` / `.ts`), `@path: '/odata/v4/cleanup'`,
`@requires: 'Admin'` – separate from `AdminService` to keep that one small, and never exposed to MCP.

```cds
type AgeCriterion  { value : Integer; unit : AgeUnit; before : Date; }
type CleanupRequest {
  runs          : RunCriteria;        // null = category not selected
  runPayloads   : RunCriteria;
  messages      : MessageCriteria;
  presets       : PresetCriteria;
  orphans       : OrphanCriteria;
}
type CategoryResult { category : String; count : Integer; cutoff : Timestamp; samples : many Sample; }

action preview(request : CleanupRequest) returns many CategoryResult;   // dry run, no write
action execute(request : CleanupRequest, expected : many CategoryCount) returns CleanupLog;
entity CleanupLogs        as projection on db.CleanupLogs;   // read-only history
entity CleanupRules       as projection on db.CleanupRules;  // saved selections (see 4.)
```

Logic in `srv/lib/cleanup/`:

- `cutoff.ts` – age criterion → timestamp (pure, unit-tested: month ends, leap years, `before` vs. `olderThan`).
- `selectors.ts` – one function per category: criteria → CQN `where` (shared by preview and execute, so the
  preview counts exactly what execute deletes).
- `execute.ts` – deletes in **chunks** (e.g. 500 IDs per statement) in one transaction per chunk, children
  first (`RunResults` before `TestRuns`, since the composition is not cascaded by a plain `DELETE` on the db
  entity), then updates `TestCaseStats.run_ID`. Re-checks `status != 'RUNNING'` and `activeRuns` per chunk.
- **Safety net:** `execute` gets the counts the user saw in the preview. If the real count is higher (new data
  matched in between), it refuses with 409 "data changed, preview again". Lower is fine.
- Validation: at least one category, `value >= 1`, a minimum age (e.g. 1 day) so "older than 0 days" cannot
  wipe everything; `keepNewest >= 0`.

New db entities (`db/schema.cds`):

- `CleanupLogs : cuid, managed` – who, when, criteria (JSON), per-category counts, duration, status
  (DONE / FAILED / PARTIAL). Audit trail; itself cleanable (category F, later).
- `CleanupRules : cuid, managed` – name + saved `CleanupRequest` (JSON) so recurring cleanups are one click.

## 3. UI app `app/cleanup` (freestyle UI5, TypeScript)

Fiori Elements does not fit a multi-category form with a dry run, so this follows the
`app/subscriber` pattern (TS, own view/controller, `_shared` modules). One page, three areas:

1. **Selection** – one panel per category with a switch (on/off) and its criteria:
   age (`StepInput` + unit `Select`, or a `DatePicker` via segmented button "older than / before"),
   multi-selects for status / source type, user and broker value helps (from the service), text filters,
   "keep newest N". A rule dropdown on top loads / saves `CleanupRules`.
2. **Preview** – button *Preview* → table: category, cutoff, count, expandable sample rows (newest 20, with
   links to the run / message). Nothing is deleted.
3. **Delete** – enabled only after a preview with the unchanged selection. Confirmation dialog lists the
   counts; for > 1000 rows the admin types the number to confirm. After execution a `MessageStrip` with the
   result and the entry in **History** (table of `CleanupLogs`, bottom of the page or second tab).

Wiring (the existing consistency tests enforce most of it):

- `app/_shared/Apps.js` – `cleanup: { intent: "AEMSuiteCleanup-manage", icon: "sap-icon://eraser", role: "admin" }`
- `app/launchpad/webapp/index.html` – sandbox tile (`test/launchpad.test.ts` checks it)
- `app/home/webapp/controller/Main.controller.js` + i18n – home tile and line text
- `mta.yaml` – HTML5 module `aem-suite-cleanup` + zip in the content deployer (`test/mta.test.ts`)
- `package.json` `typecheck` – add `tsc --noEmit -p app/cleanup`; `scripts/build-ui.js` if it lists apps
- Help: a chapter in `docs/user-guide.md` / help content, header *Help* action like the other apps
- `xs-security.json`: nothing new – the `Admin` role is reused

## 4. Saved rules and scheduling

- **v1:** saved rules (`CleanupRules`), run manually from the app.
- **v2 (decision below):** optional automatic run per rule (`schedule: DAILY | WEEKLY`, `enabled`).
  Simplest: an in-process timer started on `served` (like `failRuns`), guarded so only one CF instance
  runs it (HANA row lock on the rule / `lastRunAt` check). Alternative: SAP BTP Job Scheduling service
  calling an `executeRule` action – more robust, but one more service in `mta.yaml`.

## 5. Tests

- Unit: `cutoff.ts`, selectors (criteria → where), confirmation-count logic.
- Service (`test/cleanup.test.ts`, `cds.test`): preview == execute counts per category; RUNNING runs never
  deleted; `keepNewest`; `RunResults` deleted with their run; `TestCaseStats` kept with `run_ID` null;
  payload-only mode keeps rows; 409 when data grew after the preview; `tester` and `norole` get 403;
  chunking with > chunk size rows; a `CleanupLogs` entry per execution.
- Consistency tests (launchpad, mta, shared-ui, ui5-version) updated for the new app.
- e2e (`e2e/cleanup-app.spec.ts`): open as admin, preview, delete, history row; tester does not see the tile
  (`authorization.spec.ts`). Note: `e2e/cleanup.ts` already exists (test-data cleanup helper) – name the
  spec differently.

## 6. Implementation order

1. Schema (`CleanupLogs`, `CleanupRules`, enums) + `cutoff.ts` + selectors with unit tests
2. `CleanupService` preview / execute + service tests
3. App skeleton + wiring (Apps.js, launchpad, home, mta, typecheck) – consistency tests green
4. Selection UI → preview → confirm/delete → history
5. Saved rules
6. Help / user guide / screenshot, e2e
7. (v2) scheduling

## 7. Open decisions

1. **Scheduled automatic cleanup** – v1 manual only (recommended), or in v1 already? Timer vs. BTP Job Scheduling?
2. **Test cases as a category** ("never run / not run since X") – recommended: no, too destructive for a bulk tool.
3. **Payload-only slimming** (category B) – keep it? Recommended: yes, it frees most space while keeping history.
4. **Soft delete / undo** – recommended: no; the preview + count confirmation + log is the safety net.
5. **Should testers clean up their own data** (own runs / saved messages) – recommended: admin only for v1.
