# Maintenance Review – AEM Test Suite

| | |
|---|---|
| **Date** | 2026-10-17 |
| **Base** | `5d99648` (main), reviewed on branch `chore/maintenance-review` |
| **Scope** | Whole repository: `srv/`, `db/`, `app/`, `test/`, `e2e/`, `scripts/`, `local/`, build and deployment config, docs (~22,000 lines in 297 tracked files) |
| **Method** | Read-through of all source files, split into four areas (backend, UI, tests, build/deploy/docs). Every finding has a file:line reference, and the High ones were re-checked by hand. `npm run verify` and `npm run sync:ui -- --check` were run as a baseline. |
| **Previous review** | [archive/clean-code-review-2026-10-15.md](archive/clean-code-review-2026-10-15.md) (2026-10-15, commit `3c4d9d2`). Most of its findings are fixed. The ones still open are carried over here (section 7), so this document is the single list to work from. |


## Status

State of branch `chore/maintenance-review` after working through sections 2–7 (2026-10-17) and the remaining open items (2026-10-18). `npm run verify` and `npm run e2e` pass. Commit = where the change is. The IDs of the previous review in section 7 (B28, U13, T3, T8, T13, T16, T18, ...) are covered by the new IDs they map to. Totals: 72 Fixed, 5 Open – decision needed, 3 Partly fixed, 2 Open – not done.

| ID | Status | Commit | Note |
|---|---|---|---|
| G1 | Fixed | 496b982 | TOC self-links removed, "Advanced settings" added, TOC update on save off for the workspace, unused `page` argument removed |
| G2 | Fixed | ebb9c34 | `.github/workflows/ci.yml` (Node 22, verify, Playwright e2e with CI=true, report artifact). Not run on GitHub yet; no `mbt build` smoke step |
| G3 | Fixed | ebb9c34, 496b982 | `defineConfig`, no Jest globals for Playwright specs, `no-restricted-syntax` rule against `.only`/`fdescribe`/`fit` (no new plugin), screenshots config/spec type-checked, `eslint.useFlatConfig` removed |
| B1 | Fixed | a8baccb | first rejected broker loop is rethrown so `failRuns` runs; topic/correlation id cut to their columns. The optional per-result ERROR fallback is not done |
| B2 | Fixed | 9161236 | `@assert.range` on all enum types and on ackTimeoutMs/priority/connectTimeoutMs; node-validation reads the limits from the model |
| B3 | Fixed | 9161236 | `validateVariables` also for broker variables |
| B4 | Fixed | b233ecf | `@restrict` on ReceivedMessages (read/save/createTestCase for testers, delete own; admins delete any); not updatable in the service |
| B5 | Fixed | c4bfe31 | 404 for unknown broker, 400 for inactive broker and failed connect (400 rather than 502: CAP hides 5xx texts in production) |
| B6 | Fixed | 71fc969 | descriptor in `srv/lib/test-fields.ts` (not `lib/nodes.ts`: circular import), guarded by `test/test-fields.test.ts` incl. the agent CDS signatures |
| B7 | Fixed | 4d7b60d | `srv/common.cds` (namespace `aem.suite.api`); RunRef has `total` in both services |
| B8 | Fixed | 33f262f | skippedCount/repetitions/iteration/sequence exposed, `skipped` in the summary, failures filtered in the query |
| B9 | Fixed | 474e687, a8baccb | `lib/model.ts#columnLength` for every cut; redundant preset length checks removed |
| B10 | Fixed | 5bd5b1d | separate `disposed` flag; `bindFlow` timeout guard |
| B11 | Open – decision needed | – | ⚖ not changed: a stopped run still ends DONE/PASSED |
| B12 | Fixed | 135ddca, 33f262f | comments fixed, `@mcp.instructions` extended, createRun/executeRunInBackground/normalizeOptions no longer exported |
| B13 | Fixed | 35c5ed0 | enum unions come from the cds-typer models; preset SOURCE_TYPES check replaced by `@assert.range` |
| B14 | Fixed | 135ddca | `lib/live.ts#emitLive`; all loggers `aem-` (audit logger is now `aem-agent`) |
| B15 | Fixed | df0a3cb | `errMsg` everywhere, `req.reject` in on-handlers (before-handlers keep collecting with `req.error`) |
| B16 | Fixed | df0a3cb | one FAKER_PREFIX, `generatedSlots`/`TemplateScope.generated`/`withGenerated`, `referencedNames`+`isBuiltin` removed, quote-aware faker arguments |
| B17 | Fixed | 35c5ed0 | cds-typer entities and row types in tree, nodes, test-runner, home, agent, copy, export/import, number ranges, credentials; `@singular` fixes; typecheck/test/e2e server generate the models. Two `NumberRanges.current` updates stay by name (typer types Integer64 as number) |
| B17a | Fixed | 8b33008 | `keyOf` returns a Partial key, `idOf` rejects without ID, `keyValue` for Destinations and Help |
| B18 | Fixed | 8b33008 | `lib/unique-name.ts#nameTaken`, case-insensitive for global variables, number ranges and setups |
| B19 | Fixed | 4a9b982 | agent relies on startRun/createRun (with its own message limit); its refusal text now says "messages" |
| B20 | Fixed | 4a9b982 | test compares CDS outcome/criticality with `runOutcome` for every status combination |
| B21 | Fixed | 5cca662 | stats of deleted test cases are deleted in TestService (association kept: as a composition drafts would copy stats) |
| B22 | Fixed | 5cca662 | `type Username : String(200)` |
| B23 | Fixed | 5cca662 | stored as `repetitionOrder` (`order` is an SQL keyword), shown on the run page and to the agent |
| B24 | Fixed | 5cca662 | `@assert.unique` on NumberRanges.name |
| B25 | Fixed | 72b3ddf, 1f416fa | titles and tooltips on db/schema.cds |
| B26 | Fixed | e2e4986 | progress emits throttled (250 ms + final), copy inserts one per level, renumbering skips unchanged rows. The per-result UPDATE stays one per row (the B1 failure handling relies on it) |
| B27 | Open – decision needed | – | ⚖ not changed |
| U1 | Fixed | 32819a0 | `app/router/resources/` deleted |
| U2 | Fixed | 4eba3ea | `heartbeat(subscriptionId)` action; `activeSubscriptions` read-only |
| U3 | Fixed | b88f001 | early return when only drafts are selected |
| U4 | Fixed | b88f001, 4d7b60d | total from the run/RunRef, honest strip text, label from saved node, selection bound to the message, bindings destroyed/reset, "… and N more", launchpad frame options, sap.ui.layout |
| U5 | Fixed | 522167b | `app/_shared/Apps.js`, Navigation takes the app key; launchpad test compares tiles (incl. icons) and manifests. Backend link strings remain (U8); e2e intents stay test data |
| U6 | Fixed | 28db6fb | `test/ui5-version.test.ts` |
| U7 | Fixed | 72b3ddf | titles on the schema, shared variables layout in app/common.cds, "<what> At" for timestamps, semantics in srv and UI in app (rule in the technical docs 8.3) |
| U8 | Open – not done | 4dfa72b | tried: intent-based navigation opens the Test Cases list (not the test case) inside the launchpad and cannot navigate standalone, so the hash links stay; documented in the technical docs |
| U9 | Fixed | 27432a8, ab1f95e, b15f46a | no committed copies: a UI5 build task and dev server middleware (scripts/ui5) give every app its modules; checked with ui5 build, cds-tsx serve and e2e. `mbt build` itself could not be run here (no GNU make) |
| U14 | Fixed | a1423e6 | `ext/RunDialog.js`, `ext/FileIO.js` (flat import chain); new e2e spec for export/import |
| U15 | Fixed | 4e9c8b1 | `util/SubscriptionSession.ts`, `util/MessageBuffer.ts`, `util/TopicList.ts` (+ Jest test). Start/stop/heartbeat not e2e-tested (needs a broker); controller still ~700 lines |
| U16 | Fixed | 523eea8 | app/testcases/webapp/ext completely TypeScript (ui5-tooling-transpile, strict); Component.js stays JS |
| U17 | Fixed | b4fe91f, 9b7fbde | run dialog finds its broker list via its own events; the payload status binds to the view model (aem>/typedPayload) - no tree walk. The preview action stays id-toggled: a manifest `visible` binding on `kind` does not hide it (e2e) |
| U18 | Fixed | b4fe91f | Prefs in `app/_shared`, used by the subscriber (same storage key) |
| U19 | Partly fixed | 1f416fa, e2ba2bb, 1a3cac7, c75eae6, 5dbc606 | all apps: annotations (_i18n), manifests, views, fragments and code texts in bundles (English). Not yet: the launchpad tiles (static sandbox config), the computed kindText, the server's messages |
| U20 | Fixed | b4fe91f | one `status(text)`, one popover per view |
| U21 | Fixed | b4fe91f, e2ba2bb | TypeColumn uses `kindText`; the create menu labels are `{{kind.folder}}` / `{{kind.testCase}}` of the app bundle (e2e check) |
| U22 | Fixed | b4fe91f | Help.d.ts complete, unused ids handled, `catch (e)`, `Actions.errorText`, braces, real plurals |
| T1 | Fixed | 8d7e8c3, aba536d | checks that the app opens, not "no runs" |
| T2 | Fixed | 8d7e8c3 | fixtures in beforeAll, range reset before each test |
| T3 | Fixed | 8d7e8c3 | unique names and cleanup after each test (`e2e/cleanup.ts`) |
| T4 | Fixed | 7bca07c | timestamps instead of wall clock, bounded `waitFor`, fake timers in the session tests |
| T5 | Fixed | 7bca07c | messages asserted, noRole 403, own-run stop, stats before/after, language check |
| T6 | Partly fixed | 38e2305, 9b7fbde | `.all()` after `toHaveCount`, tile list, the payload editor has our own id; the Fiori elements filter-field ids and the object page route id remain (generated by FE, no handle we can add) |
| T7 | Fixed | 7bca07c | `runAndWait` in helpers.ts |
| T8 | Fixed | 7bca07c | `withDestinations`/`useDestinations`, restore instead of delete |
| T9 | Fixed | 7bca07c, 38e2305 | `draft.*`, `mcpRpc`, `MCP_HEADERS`; e2e `PING_ID`, `previewTestCase`, `testCaseUrl` |
| T10a | Fixed | 7bca07c, 8d7e8c3 | finally, resetDatabase(), redundant deletes removed |
| T11 | Fixed | 38e2305 | `playwright.base.ts` |
| T12 | Fixed | 4bc4754 | `*-unit.test.ts` for tree, number ranges, fake data |
| T13a | Fixed | 4bc4754, 896b8b5 | shadowed `test` renamed, help.test cleaned, the big agent and run tests split; the username test stays one (steps build on each other, one finally) |
| T14 | Fixed | 38e2305, 9b7fbde | no `waitForTimeout` left: settle() waits for network, busy indicators and animations; the silent catch is gone |
| T15 | Fixed | 7bca07c | comment in the shim |
| 5.3 | Fixed | 7bca07c, 748b69c, 4eba3ea, 5bd5b1d, c4bfe31, 4a9b982 | all listed gaps have tests now, incl. direct tests of preview, copy-nodes and the import parsing, the LiveService context isolation and the server.ts listeners. The websocket *login* cannot be tested locally (mocked users let anonymous clients in). Found and fixed on the way: emitLive was rejected outside a request (748b69c) |
| D1 | Fixed | (D1 commit) | redirect URIs: only the approuter's route (`app-api`); `http://localhost:8765/**` only via `dev.mtaext` (`npm run deploy:dev`); test/mta.test.ts keeps the wildcard out |
| D2 | Open – decision needed | – | ⚖ names unchanged; the collision is documented (§9) |
| D3 | Fixed | 81786a8 | `app/router/package-lock.json`, `builder: npm-ci` |
| D4 | Fixed | ffc35e5 | layout, services, model, security, tests per kind, build; the optional mta.test check of the doc table not done |
| D5 | Fixed | ffc35e5 | "Development workflow" in README and technical docs |
| D6 | Open – decision needed | – | ⚖ engines/.nvmrc unchanged (CI uses Node 22 per engines) |
| D7 | Fixed | 32819a0 | archived with a note, links adjusted |
| D8 | Fixed | 32819a0 | .env*, coverage/, *.tgz; Terraform lock no longer ignored (not committed: stack not applied here) |
| D9 | Partly fixed | ffc35e5, ab1f95e | documented; the per-app devDependencies stay - the UI5 CLI only finds custom tasks declared in the app's package.json (verified), npm workspaces would not remove that |
| D10 | Fixed | 70144cc | `.gitattributes`, `.editorconfig`, LF sync script; `--renormalize` changed nothing in the index (already LF), working copy re-checked out |
| D11 | Fixed | 81786a8, e82388e | `repository` field, fixed mtar name, `scripts/set-version.js` (+ `test/version.test.ts`), CHANGELOG.md |
| D12 | Fixed | 81786a8 | caret ranges with tested minimum, `npm dedupe`; the second @sap/cds is bundled in cds-dk and cannot be deduped |
| D13 | Fixed | 81786a8 | health check `/health`, disk quota srv, memory/disk db-deployer |
| D14 | Open – not done | – | caching vs. cachebuster needs a choice; not changed |
| D15 | Fixed | 81786a8 | `mbt` devDependency, `npm run build` / `npm run deploy` |
| D16 | Fixed | 2a5769a | local README, root README, image pinned to 10.26.0, `${SOLACE_ADMIN_PASSWORD:-admin}` |
| D17 | Fixed | 05a722c | LICENSE (proprietary notice), CONTRIBUTING.md pointing to the README |

Severity: **High** = bug, security issue or a broken quality gate · **Medium** = maintenance cost that grows with the code · **Low** = local cleanup.

Items marked **⚖ Decision** need a decision from the owner (security policy, deployment landscape, product behaviour) before anyone changes them.

---

## 1. Summary

The code base is in clearly better shape than two days ago. Shared helpers exist (`lib/errors.ts`, `lib/config.ts`, `lib/request.ts`, `app/_shared`), linting covers TypeScript, `npm run verify` exists, and the subscription hub has its own tests.

The remaining maintenance cost comes from five themes:

1. **No automated gate.** There is no CI. `verify` is **red on `main` right now** (G1), and nothing noticed it.
2. **The same facts are kept in many places**, with no test that they agree:
   - the test-case field list (~9 places)
   - the app catalog (7)
   - the UI5 version (24)
   - the CDS result types (2 services)
   - column lengths (~12)
   - enum unions (CDS + TS)
   - the generated `webapp/shared` copies (49 files)
3. **Server-side rules exist only in the UI.** Enum values (B2), saved-message permissions (B4) and broker variable names (B3) are only checked by the UI or by some write paths.
4. **The docs have drifted from the code**: the technical docs list 7 apps where there are 9, wrong service tables, 10 of 26 test files. The developer workflow (`sync:ui`, `verify`) is not documented.
5. **Large client modules are growing instead of shrinking.** `openRunDialog` grew from 225 to 310 lines and the subscriber controller from 556 to 727 lines (U14, U15 of the old review).

### Top 12 to address first

| # | Finding | Severity | Area |
|---|---|---|---|
| 1 | [G1](#g1--npm-run-verify-is-red-on-main-high) `npm run verify` fails on `main` (user guide TOC) | High | Gates |
| 2 | [G2](#g2--no-ci-pipeline-high) No CI pipeline, so G1 went unnoticed | High | Gates |
| 3 | [B1](#b1--a-failing-db-write-during-a-run-is-swallowed-and-the-run-ends-done-high) A failed DB write during a run is swallowed; the run ends `DONE` with `PENDING` results | High | Backend |
| 4 | [D1](#d1--xsuaa-redirect-uri-wildcard-over-the-shared-cf-domain-high--decision) XSUAA redirect URI is a wildcard over the whole shared CF domain | High ⚖ | Deploy |
| 5 | [B4](#b4--any-tester-can-modify-or-delete-other-users-saved-messages-medium) Any Tester can update/delete other users' saved messages | Medium | Backend |
| 6 | [B2](#b2--enum-values-are-not-checked-on-the-odata-paths-medium) Enum values are not checked on the OData paths | Medium | Backend |
| 7 | [T1](#t1--e2e-test-runs-opens-no-runs-yet-races-with-the-run-dialog-specs-high) E2E race: "Test Runs opens (no runs yet)" vs. the run dialog specs | High | Tests |
| 8 | [T2](#t2--testnumber-rangestestts-depends-on-test-order-high) `number-ranges.test.ts` depends on test order | High | Tests |
| 9 | [U2](#u2--the-heartbeat-keeps-orphaned-subscriptions-alive-medium) The heartbeat keeps orphaned subscriptions alive | Medium | UI/Backend |
| 10 | [U3](#u3--exporting-only-unsaved-drafts-exports-the-whole-tree-medium) Exporting only unsaved drafts exports the whole tree | Medium | UI |
| 11 | [D4](#d4--technical-documentation-has-drifted-from-the-code-medium) Technical docs have drifted (apps, services, tests) | Medium | Docs |
| 12 | [B6](#b6--the-test-case-field-list-is-maintained-in-about-9-places-medium) / [U5](#u5--app-catalog-intent-icon-title-help-section-is-kept-in-7-places-medium) / [U6](#u6--the-ui5-version-is-pinned-in-24-places-medium) Single sources of truth: fields, app catalog, UI5 version | Medium | All |

---

## 2. Quality gates and CI

#### G1 – `npm run verify` is red on `main` (High)
[docs/user-guide.md:10-11](user-guide.md#L10-L11), [test/help.test.ts:44](../test/help.test.ts#L44)

Baseline run on `5d99648`: **1 failed, 266 passed**, plus 1 lint warning.

- In commit `be7e0a83`, an editor's TOC generator rewrote the table of contents. It now links to the H1 title (`#aem-test-suite--user-guide`) and to `#contents` itself.
- `help-content.ts` does not render the title or the "Contents" section as headings. So `help.test.ts` ("every link inside the guide leads to a heading") fails.
- The generated TOC also misses the new "Advanced settings" heading ([user-guide.md:230](user-guide.md#L230)), so it is out of date as well.
- Lint: `e2e/number-ranges.spec.ts:24` has an unused `page` argument.

**Recommendation:**
- Remove the two self-links from the TOC and add "Advanced settings".
- Rename the argument to `_page` or drop it.
- Disable "update TOC on save" for this file, or make the test ignore links to the H1 and to `#contents`. Removing the lines is the simpler fix.

#### G2 – No CI pipeline (High)
There is no `.github/`, `.gitlab-ci.yml`, `Jenkinsfile` or `.pipeline/`. The remote is GitHub (`jpnqs/aem-suite`). `playwright.config.ts:20-23,41` branches on `process.env.CI`, but nothing sets it.

Several consistency checks exist only as Jest tests, so they protect nothing unless someone runs them by hand:
- `mta.test.ts` (apps vs. MTA)
- `shared-ui.test.ts` (shared copies)
- `launchpad.test.ts` (tiles vs. manifests)
- `help.test.ts` (help anchors)

**Recommendation:** add `.github/workflows/ci.yml` with these steps: `npm ci` → `npm run verify` → `npx playwright install --with-deps chromium && npm run e2e`. Use the Node version from D6 and upload the Playwright report as an artifact. Optionally add `mbt build` as a build smoke test.

#### G3 – Lint and typecheck gaps (Low)
- [eslint.config.mjs:29-30](../eslint.config.mjs#L29-L30) gives **Jest** globals to `e2e/**/*.ts`. Playwright has no `describe`/`it` globals, so a stray `describe(` lints clean and fails at runtime.
- No guard against a committed `.only` in Jest. Playwright has `forbidOnly` on CI only, and there is no CI. Add `eslint-plugin-jest` with `no-focused-tests` (or a tiny custom rule).
- `tseslint.config(...)` is deprecated in favour of ESLint's `defineConfig`.
- [e2e/tsconfig.json:8](../e2e/tsconfig.json#L8) only includes `playwright.config.ts`. `playwright.screenshots.config.ts` and `scripts/screenshots/shots.spec.ts` are never type-checked.
- [.vscode/settings.json:2](../.vscode/settings.json#L2): `eslint.useFlatConfig` is obsolete with ESLint 9.

---

## 3. Backend (`srv/`, `db/`)

### 3.1 Bugs and security

#### B1 – A failing DB write during a run is swallowed and the run ends `DONE` (High)
[srv/lib/test-runner.ts:313-314](../srv/lib/test-runner.ts#L313-L314), [:230-238](../srv/lib/test-runner.ts#L230-L238)

```ts
await Promise.allSettled(brokerIds.map((brokerId) => runBroker(brokerId, pending.filter(...), ctx)))
await ctx.progress.complete()
```

- If `progress.finish` throws (it does its own `UPDATE`), that broker's loop stops. `allSettled` discards the rejection, and `complete()` writes `status: 'DONE'`.
- The remaining results stay `PENDING` and the counts are wrong.
- The `.catch → failRuns` safety net from the previous review (B1 there) is never reached.

A realistic trigger: `resolvedTopic` (String(500)) and `correlationId` (String(200)) are written after template expansion **without truncation**. Variables can push them past the column length. HANA rejects that and SQLite does not, so Jest cannot catch it.

The comment at `:317` ("every result ends PASSED, FAILED or ERROR") is therefore not guaranteed, and it does not mention SKIPPED.

**Recommendation:**
- Inspect the settled results and rethrow the first rejection, so `failRuns` runs.
- Truncate `resolvedTopic` and `correlationId` to their column lengths (see B9).
- Optionally, let a failed per-result write mark only that result `ERROR`.

#### B2 – Enum values are not checked on the OData paths (Medium)
[db/schema.cds:22-75](../db/schema.cds#L22-L75), [srv/test-service.ts:40-46](../srv/test-service.ts#L40-L46), [srv/lib/node-validation.ts:8-12](../srv/lib/node-validation.ts#L8-L12)

- CAP validates enum values only when an element has `@assert.range`, and none does.
- `validateEnums` is called by the agent, the import and `createNode`, but not by `TestService`'s `before(['CREATE','UPDATE'], TestCases)` handler.
- So a direct OData PATCH can store `deliveryMode: 'FOO'`, `TestCaseProperties.type: 'X'` or `Brokers.credentialMode: 'X'`.
- The `credentialMode` case matters: `needsPassword` ([resolve.ts:103-105](../srv/lib/credentials/resolve.ts#L103-L105)) treats any value other than `'DESTINATION'` as DIRECT.
- The header comment of `node-validation.ts` ("all ways in apply exactly the same checks") is therefore not true.

**Recommendation:**
- Annotate the enum-typed elements with `@assert.range`.
- Move the hand-coded numeric ranges into the schema the same way: `ackTimeoutMs 100..120000` and `priority 0..255` (node-validation.ts:128-130), `connectTimeoutMs 1000..120000` (admin-service.ts:89).
- Keep `validateEnums` for the direct DB writes.

#### B3 – Broker variables are never validated (Medium)
[srv/admin-service.cds:41](../srv/admin-service.cds#L41), [srv/admin-service.ts:114-124](../srv/admin-service.ts#L114-L124), [app/brokers/annotations.cds:107-112](../app/brokers/annotations.cds#L107-L112)

- Only `GlobalVariables` gets name and duplicate checks. The "Broker Variables" table on the broker object page accepts any name.
- A name like `my var` saves fine but can never be referenced: `EXPR` in [template/resolve.ts:63](../srv/lib/template/resolve.ts#L63) requires `[A-Za-z_][\w.-]*`.
- Duplicate names resolve to whichever row loads last ([test-case-spec.ts:62-68](../srv/lib/test-case-spec.ts#L62-L68)).

**Recommendation:** extract `validateVariables(list, reject, targetPrefix)` from `validateNode` and call it from the Brokers `before(['CREATE','UPDATE'])` handler as well.

#### B4 – Any Tester can modify or delete other users' saved messages (Medium)
[srv/subscribe-service.cds:20-24](../srv/subscribe-service.cds#L20-L24), [app/messages/annotations.cds:86-90](../app/messages/annotations.cds#L86-L90)

- `ReceivedMessages` has no `@restrict` and is not `@readonly`. "Not updatable" and "no create" exist only as UI annotations.
- Any Tester can PATCH or DELETE any user's saved message over OData.
- `SubscriberPresets` in the same service already uses `where: 'createdBy = $user'`.

**Recommendation:** `@restrict: [{ grant: 'READ', to: 'Tester' }, { grant: 'DELETE', to: 'Tester', where: 'createdBy = $user' }, { grant: '*', to: 'Admin' }]`, adjusted to what the UI needs (it creates through the `createTestCase` action and through the live view's save). Then move `Updatable: false` from the UI annotations into the service.

#### B5 – `startSubscription` returns 500 for user errors (Medium)
[srv/lib/solace/subscription-hub.ts:115-122](../srv/lib/solace/subscription-hub.ts#L115-L122), [srv/lib/credentials/resolve.ts:29-33](../srv/lib/credentials/resolve.ts#L29-L33), [srv/lib/solace/session.ts:121](../srv/lib/solace/session.ts#L121)

- `resolveConnection` errors become `httpError(400)`.
- `loadBroker` throws a plain `Error('Broker … not found')`, and a failed `openSession` (wrong password, unreachable host) throws a plain `Error('Connect failed: …')`. Both reach the client as **500**.
- The hub also does not check `broker.active`, while `createRun` rejects inactive brokers.

**Recommendation:**
- `loadBroker` → `httpError(404)`.
- Wrap the connect failure as 400 or 502.
- Reject inactive brokers.
- Add tests for these paths (see T10).

#### B6 – The test case field list is maintained in about 9 places (Medium)

| Place | |
|---|---|
| `TEST_FIELDS` | [agent-service.ts:29-41](../srv/agent-service.ts#L29-L41) |
| `TestNodes` and the parameters of `createTestCase`/`updateTestCase` | [agent-service.cds:23-45, :167-200](../srv/agent-service.cds#L23-L45) |
| `NodeDoc`, `Row`, `toDoc`, and the text/whole lists in `nodeData` | [export-import.ts:32-48, :77-90, :133-148, :264-265](../srv/lib/export-import.ts#L32-L48) |
| `TestCaseRecord` | [test-case-spec.ts:12-28](../srv/lib/test-case-spec.ts#L12-L28) |
| the length-checked fields | [node-validation.ts:89](../srv/lib/node-validation.ts#L89) |

Adding a field such as `replyTo` means touching all of them. If one is forgotten, export/import or the agent drops the field without an error.

**Recommendation:** one descriptor in `lib/nodes.ts` (for example `TEST_FIELDS = { topic: 'text', ttl: 'int', … }`) used by export, import, the agent and validation. Even better, derive it from `cds.model.definitions['aem.suite.TestCases'].elements`. Add a test that the descriptor covers every element of the entity, except the technical ones.

#### B7 – The same result types are declared twice in CDS (Medium)
[srv/test-service.cds:162-192, :224-241](../srv/test-service.cds#L162-L192) vs. [srv/agent-service.cds:214-243, :252-275](../srv/agent-service.cds#L214-L243)

- `ExportResult`, `ImportRoot`, `ImportResult`, `Preview`, `BrokerCredential` and `RunRef` are copies.
- The two `RunRef` copies have already drifted: the agent's copy has `total`.

**Recommendation:** move them to a shared `srv/common.cds` (or the `aem.suite` namespace) and reference them from both services.

#### B8 – The agent API has not caught up with SKIPPED, repetitions and stop (Medium)
[srv/agent-service.cds:99-115, :294-306](../srv/agent-service.cds#L99-L115), [srv/agent-service.ts:202-220](../srv/agent-service.ts#L202-L220)

- `TestRuns` has no `skippedCount`/`repetitions`, `RunResults` has no `iteration`/`sequence`, and `RunSummary` has no `skipped`.
- A stopped run reports SKIPPED rows to the agent as failures, while the `failed` count excludes them.
- Bug: `.where({ status: { '!=': 'PASSED' } }).limit(MAX_FAILURES)` runs **before** `.filter((f) => f.status !== 'PENDING')`. With PENDING rows, fewer than 25 failures come back even though more exist.

**Recommendation:**
- Add the new fields to the projection and summary.
- Exclude PENDING in the `where`.
- Report SKIPPED separately.
- Extend `@mcp.instructions` (see B12).

#### B9 – Column lengths are hardcoded in about 12 places (Medium)
- Hardcoded:
  - `MAX_ERROR = 2000` and the values 500 and 1000 in [test-runner.ts:13-14, :83, :429-430](../srv/lib/test-runner.ts#L13-L14)
  - [broker-check.ts:41](../srv/lib/broker-check.ts#L41)
  - [subscribe-service.ts:102-103](../srv/subscribe-service.ts#L102-L103)
  - `.slice(0, 200)` in [copy-nodes.ts:59](../srv/lib/copy-nodes.ts#L59) and [test-service.ts:35](../srv/test-service.ts#L35)
- `node-validation.ts:62-67` already reads the lengths from the model (`elementOf`).
- `subscribe-service.ts:127-144` re-checks preset lengths that CAP already enforces for OData input.

**Recommendation:** move `elementOf` into `lib/model.ts` as `columnLength(entity, element)`, use it for every `truncate` (this also fixes the trigger of B1), and drop the redundant preset checks.

#### B10 – Session cleanup gaps in the Solace session (Medium)
[srv/lib/solace/session.ts:251-253, :300-306, :321-337](../srv/lib/solace/session.ts#L300-L306)

- (a) `onDisconnected()` sets `closed = true`, and then `close()` returns early (`if (this.closed) return`). After a broker-side drop, `session.dispose()` is never called.
- (b) `bindFlow` has no timeout guard, unlike `connect`. If the bind never answers, `open()` hangs, and the slot reserved in `starting` ([subscription-hub.ts:91-98](../srv/lib/solace/subscription-hub.ts#L91-L98)) counts against `maxPerUser` for good.

**Recommendation:** use a separate `disposed` flag so that `close()` always disposes exactly once, and give `bindFlow` the same timeout guard as `connect`.

#### B11 – A stopped run looks like a successful one (Low) ⚖ Decision
[srv/lib/test-runner.ts:250-260, :383-386](../srv/lib/test-runner.ts#L250-L260), [srv/test-service.cds:94-99](../srv/test-service.cds#L94-L99)

A cancelled run ends `status: 'DONE'` with the outcome PASSED (green) if nothing failed. Only `skippedCount` tells it apart. **Option:** add a `STOPPED` value to `RunStatus`, or let the outcome show it. This changes product behaviour, and `run-options.test.ts:109` currently asserts the existing behaviour.

### 3.2 Duplication and consistency

| # | What | Where | Recommendation |
|---|---|---|---|
| B12 | Stale comments | [live-service.cds:27](../srv/live-service.cds#L27) says "(UP, DOWN, ERROR)", but the code emits STOPPED/DOWN/THROTTLED/RESUMED. [defaults.ts:1-4](../srv/lib/defaults.ts#L1-L4) still says "completes user input" (that moved to `broker-url.ts`). [number-ranges.ts:42](../srv/lib/number-ranges.ts#L42) names a `count` parameter, but the function takes `last`. [test-runner.ts:107-110](../srv/lib/test-runner.ts#L107-L110) still describes calling `executeRunInBackground` by hand. [agent-service.cds:16](../srv/agent-service.cds#L16) `@mcp.instructions` does not mention `{{newUuid}}`, `{{numberRange.X}}` or `{{faker.…}}` | Fix the texts. Un-export `createRun`, `executeRunInBackground` and `normalizeOptions` if only the module uses them |
| B13 | Enum literal unions re-declared in TS: `PropertyType`, `DeliveryMode`, `NodeKind`, `CredentialMode`, `SourceType` (3× incl. `SOURCE_TYPES`), `'OK'\|'ERROR'`, `'FOLDER'\|'TEST'`. Some fields are plain `string` where the schema has an enum (`session.ts:66`, `subscription-hub.ts:49`, `node-validation.ts:101`) | [property-types.ts:5](../srv/lib/property-types.ts#L5), [session.ts:29](../srv/lib/solace/session.ts#L29), [tree.ts:10](../srv/lib/tree.ts#L10), [resolve.ts:8](../srv/lib/credentials/resolve.ts#L8), [subscription-hub.ts:10](../srv/lib/solace/subscription-hub.ts#L10), [subscribe-service.ts:117](../srv/subscribe-service.ts#L117) | Take them from cds-typer (B17 below), or re-export them from one `lib/types.ts` |
| B14 | Two ways to push to `LiveService`: the runner connects once, while the hub calls `cds.connect.to('LiveService')` per message. Logger names are mixed (`aem-runner`, `aem-subscribe`, `aem-destinations`, plain `agent`) | [test-runner.ts:266-287](../srv/lib/test-runner.ts#L266-L287), [subscription-hub.ts:268-275](../srv/lib/solace/subscription-hub.ts#L268-L275), [agent-service.ts:13](../srv/agent-service.ts#L13) | One `lib/live.ts#emitLive(event, data, context)`, and the `aem-` prefix for every logger |
| B15 | Error style is mixed: `return req.error(404)` / `req.reject(404)` / `throw httpError`. `(e as Error).message` is used instead of `errMsg(e)` in ~12 places (a non-Error throw gives `undefined`) | `test-service.ts:82`, `subscribe-service.ts:75`, `agent-service.ts:89,109,124,147`, `admin-service.ts:86`, `destinations.ts:38`, `export-import.ts:206`, `fake-data.ts:85`, `node-validation.ts:124`, `preview.ts:32`, `session.ts:148,172,191,220,334` | `req.reject` in handlers, `httpError` in `lib/`, `errMsg` everywhere |
| B16 | Template module: `FAKER_PREFIX` is defined twice. The `isBuiltin` list repeats the `fixed` keys. `NumberSlot` now also carries faker values (`range: ''`), so the names `numberSlots` and `TemplateScope.numbers` are misleading. `referencedNames` is used only in tests. `parseArgs` splits on every comma, including inside quoted strings | [fake-data.ts:11, :49](../srv/lib/fake-data.ts#L11), [template/resolve.ts:40-47, :75-83, :99, :129, :164, :203](../srv/lib/template/resolve.ts#L40-L47) | One constant. Derive `isBuiltin` from `fixed`. Rename to `generatedSlots`/`generated`. Use a quote-aware split |
| B17a | Key reading bypasses `keyOf`, and `keyOf` returns `{} as EntityKey`, so `.ID` is typed `string` but can be `undefined` | [admin-service.ts:146](../srv/admin-service.ts#L146), [help-service.ts:8](../srv/help-service.ts#L8), [request.ts:11](../srv/lib/request.ts#L11) | Use `keyOf` everywhere, typed as `Partial<…>` or with a throw-on-missing variant |
| B18 | Name uniqueness: case-insensitive for NumberRanges, case-sensitive for GlobalVariables and presets | [admin-service.ts:119-122, :185-186](../srv/admin-service.ts#L119-L122), [subscribe-service.ts:129](../srv/subscribe-service.ts#L129) | Pick one rule (case-insensitive) in a shared helper |
| B19 | `startRun` logic: the agent handler repeats the unknown-test-case check and `expandToTests` that `createRun` already does | [agent-service.ts:174-177](../srv/agent-service.ts#L174-L177), [test-runner.ts:119-122](../srv/lib/test-runner.ts#L119-L122) | Let the agent rely on `createRun` |
| B20 | Criticality and outcome are still written twice (CDS `case` vs. TS `runOutcome`), and the PASSED/FAILED/ERROR `case` is repeated within `test-service.cds` | [test-service.cds:93-99, :118-135](../srv/test-service.cds#L93-L99), [test-runner.ts:379-386](../srv/lib/test-runner.ts#L379-L386), [admin-service.ts:106-107](../srv/admin-service.ts#L106-L107) | Accept with the existing "keep in sync" comments, but add one test that compares the CDS outcome with `runOutcome` for every status combination |

### 3.3 Schema

| # | What | Where | Recommendation |
|---|---|---|---|
| B21 | `TestCases.lastResult` is an Association, so deleting a test case leaves orphaned `TestCaseStats` rows | [db/schema.cds:143-155](../db/schema.cds#L143-L155) | Composition, or delete the stats in the delete handler |
| B22 | `SubscriberPresets.username` is String(100), `Brokers.username` is String(200) | [db/schema.cds:91, :243](../db/schema.cds#L91) | Use one length (a shared `type Username : String(200)`) |
| B23 | `TestRuns` stores `repetitions`, `delayMs` and `stopOnFailure`, but not `order` | [db/schema.cds:184-187](../db/schema.cds#L184-L187), [test-runner.ts:43](../srv/lib/test-runner.ts#L43) | Store `order` too, so a run can be understood afterwards |
| B24 | `NumberRanges.name` uniqueness is enforced only in code (race between two creates) | [admin-service.ts:185-186](../srv/admin-service.ts#L185-L186) | Add `@assert.unique` |
| B25 | Field titles live in the UI annotations (repeated per app) instead of on the entity | see U7 | `@title` on `db/schema.cds` |

### 3.4 Type safety (carried over)

- **B17 – cds-typer models are still unused (Medium).** Nothing imports `#cds-models`. Entity names are still string literals (TestRuns 11×, RunResults 7×, Brokers 6×, TestCases 6×, plus two private `TABLE` constants in `nodes.ts:7` and `tree.ts:8`). There are 8 `as unknown as` casts and 7 hand-written row shapes for `TestCases` (`TreeNode`, `Sibling`, `NodeRow`, `NodeData`, `TestCaseRecord`, 2× `Row`). `RunRow` in `home-service.ts:9` claims columns that are not selected. **Recommendation:** import the generated entities, starting with `lib/nodes.ts`, `lib/tree.ts` and `test-runner.ts`. This also solves B6, B13 and most casts. Make `typecheck` run `cds-typer` first, so a fresh clone type-checks.
- **B26 – One write per row (Low).**
  - `renumberSiblings` ([tree.ts:100-104](../srv/lib/tree.ts#L100-L104)) and `copySubtree` ([copy-nodes.ts:55-71](../srv/lib/copy-nodes.ts#L55-L71)) write one row per statement.
  - New: `RunProgress.finish`/`skip` open **one transaction and one websocket emit per message**. With `runs.maxResults = 5000` that is up to 5000 of each per run.
  - **Recommendation:** throttle the emits (for example at most every 250 ms, plus the final one). Batch the inserts per depth.

### 3.5 Possible exposure (to verify)

- **B27 – Live websocket contexts are not owner-checked (Low).** Any Tester can `wsContext`-enter any id ([live-service.cds:7-10](../srv/live-service.cds#L7-L10)). Subscription ids are random and only returned to their owner, so the risk is low. If the websocket plugin offers a hook, check the context against `listSubscriptions(user)` or against the run owner.

---

## 4. UI apps (`app/`)

### 4.1 Bugs

#### U1 – `app/router/resources/` is dead and has drifted (Medium)
[app/router/resources/launchpad.html](../app/router/resources/launchpad.html), [app/router/resources/appconfig/fioriSandboxConfig.json](../app/router/resources/appconfig/fioriSandboxConfig.json)

- [app/router/xs-app.json](../app/router/xs-app.json) routes everything to `html5-apps-repo-rt`, and no route has a `localDir`. The technical docs (`:409`) say so themselves.
- The copy still differs from the real launchpad:
  - 7 tiles instead of 9 (Home and Number Ranges are missing)
  - the old icon
  - `./` instead of `../` URLs
  - two more UI5 version pins
- `test/launchpad.test.ts` only checks the real launchpad.

**Recommendation:** delete the folder.

#### U2 – The heartbeat keeps orphaned subscriptions alive (Medium)
[srv/subscribe-service.ts:55-60](../srv/subscribe-service.ts#L55-L60), [app/subscriber/webapp/controller/Main.controller.ts:496-520](../app/subscriber/webapp/controller/Main.controller.ts#L496-L520)

- `activeSubscriptions` touches **every** subscription of the user. It is called every 60 s by each subscriber page and by "Active Subscriptions".
- A subscription left behind by a closed tab is therefore never idle-closed while another tab of the same user is open. The `beforeunload` stop is async and often never completes.
- The name of a read function hides the heartbeat (old U15).

**Recommendation:** add a `heartbeat(subscriptionId)` action that touches only the page's own subscription, and make `activeSubscriptions` read-only.

#### U3 – Exporting only unsaved drafts exports the whole tree (Medium)
[app/testcases/webapp/ext/TestCaseActions.js:425-442](../app/testcases/webapp/ext/TestCaseActions.js#L425-L442), [srv/lib/export-import.ts:112-114](../srv/lib/export-import.ts#L112-L114)

If only drafts are selected, `selectActiveIds` returns `[]` ("Unsaved drafts are skipped"), and `exportNodes([])` means "everything". **Recommendation:** return early when `selectedContexts.length > 0 && ids.length === 0`, as `copySelected` and `runSelected` already do.

#### U4 – Smaller UI bugs (Low)

| What | Where | Fix |
|---|---|---|
| The run dialog poll sets `/done = totalCount` but never `/total`. `/total` is a client estimate that is wrong for folders, so the dialog can show "12 / 2" and over 100 %. While the run is RUNNING the poll updates nothing, although the strip says "checked every few seconds" | [TestCaseActions.js:98-104, :188, :309](../app/testcases/webapp/ext/TestCaseActions.js#L98-L104) | Take total and counts from the run in `poll` |
| `runSelected` takes the label from `selectedContexts[0]`, which can be the skipped draft | [TestCaseActions.js:524](../app/testcases/webapp/ext/TestCaseActions.js#L524) | Let `selectActiveIds` return the active contexts |
| Subscriber: rows are prepended on each flush, but the selection is kept by path (`/messages/n`), so the highlight moves to another message | [Main.controller.ts:578-583](../app/subscriber/webapp/controller/Main.controller.ts#L578-L583), [Main.view.xml:224-233](../app/subscriber/webapp/view/Main.view.xml#L224-L233) | Clear the selection on flush, or re-select by `seq` |
| Subscriber `save()` creates a `bindContext` and a `bindList` and never destroys them. `savePreset` does not `resetChanges()` after a failed batch | [Main.controller.ts:638-641, :340-341](../app/subscriber/webapp/controller/Main.controller.ts#L638-L641) | Destroy in `finally`, reset on error |
| `MAX_PROBLEMS` (50) cuts the problem list without saying so | [TestCaseActions.js:22, :124](../app/testcases/webapp/ext/TestCaseActions.js#L22) | Show "… and N more" |
| The launchpad allows framing by any origin (`data-sap-ui-frame-options="allow"`), while every app uses `trusted` | [app/launchpad/webapp/index.html:92](../app/launchpad/webapp/index.html#L92) | Use `trusted` |
| The testcases manifest does not list `sap.ui.layout`, but the preview dialog uses `SimpleForm` | [PreviewDialog.fragment.xml:32](../app/testcases/webapp/ext/PreviewDialog.fragment.xml#L32), [testcases manifest](../app/testcases/webapp/manifest.json) | Add the library |

### 4.2 Single sources of truth

#### U5 – App catalog (intent, icon, title, help section) is kept in 7 places (Medium)
1. [app/launchpad/webapp/index.html:11-84](../app/launchpad/webapp/index.html#L11-L84)
2. [app/home/webapp/controller/Main.controller.js:16-25](../app/home/webapp/controller/Main.controller.js#L16-L25) ("Icons as on the launchpad tiles")
3. home `i18n` `app.*.title`
4. [app/_shared/Help.js:8-18](../app/_shared/Help.js#L8-L18) (sections)
5. literal intents in `TestCaseActions.js:29`, `Main.controller.ts:714` and `_shared/Help.js:22`
6. backend link strings `'#AEMSuiteBrokers-manage&/…'` in [srv/test-service.cds:115-117](../srv/test-service.cds#L115-L117)
7. [e2e/launchpad.ts:4-14](../e2e/launchpad.ts#L4-L14)

Only the titles, descriptions and intents of the launchpad are tested. **Recommendation:** one `app/_shared/Apps.js` (key, intent, icon, help section, required role), used by Home, Help and the actions. Extend `launchpad.test.ts` to compare it with the manifests and the launchpad tiles, including icons.

#### U6 – The UI5 version is pinned in 24 places (Medium)
- `https://ui5.sap.com/1.148.12` appears in 10 `index.html` files (2× in the launchpad) and in the dead router copy.
- `minUI5Version: "1.148.0"` appears in 9 manifests.
- `@sapui5/types 1.148.12` appears in the root and subscriber `package.json`.
- `ui5.yaml` has no `framework` section.
- No test compares them.

**Recommendation:** add a test (in the style of `launchpad.test.ts`) that all bootstrap URLs, `minUI5Version` values and the types version agree. Or generate `index.html` from one template.

#### U7 – Annotations: duplicated per projection, no common file (Medium)
- `BrokerVariables`, `GlobalVariables` and `TestCaseVariables` (all `db.Variables`) get near-identical HeaderInfo/LineItem blocks: [brokers/annotations.cds:173-186](../app/brokers/annotations.cds#L173-L186), [variables/annotations.cds:1-29](../app/variables/annotations.cds#L1-L29), [testcases/annotations.cds:189-202](../app/testcases/annotations.cds#L189-L202).
- `deliveryMode`, `correlationId`, `topic`, `payload`, `contentType` and `userProperties` repeat the same `@title` in testcases, runs and messages.
- [numberranges/annotations.cds:19,25,42,46](../app/numberranges/annotations.cds#L19) repeat labels that `@title` already sets (`:101-102`).
- [runs/annotations.cds:63, :66](../app/runs/annotations.cds#L63) annotate `createdAt` twice.
- Timestamp labels are inconsistent:
  - 'Started' vs. 'Started At' for two different fields
  - 'Run Started'
  - 'Tested At', 'Executed At', 'Changed At', 'Last Run', 'Run At', 'Last Used'
- Service semantics sit in UI files (`@Core.Computed`, `Capabilities.UpdateRestrictions`, `@Core.Immutable`), while UI annotations sit in `srv/admin-service.cds:9-38,73-78`.

**Recommendation:**
- Put `@title`/`@Common.QuickInfo` on `db/schema.cds`. CAP propagates them to projections.
- Keep only the layout per app.
- Put service semantics in `srv/*.cds` and UI in `app/*/annotations.cds`, and write the rule down in the technical docs.
- Pick one timestamp wording.

#### U8 – Run results links use hardcoded launchpad hashes (Medium)
[app/runs/annotations.cds:108-122, :143-152, :177-191](../app/runs/annotations.cds#L108-L122), [srv/test-service.cds:115-117](../srv/test-service.cds#L115-L117)

- `UI.DataFieldWithUrl` with a backend-built `#Intent&/…` works only inside the launchpad. Standalone, the hash lands in the runs app's own router.
- Testers also see links into the Admin-only Brokers app.

**Recommendation:** `UI.DataFieldWithIntentBasedNavigation` (SemanticObject/Action + mapping). FE then handles both cases and the user's authorisations, and the computed `*Link` columns go away.

#### U9 – Generated shared copies: committed, in every app, partly unused (Medium)
- `scripts/sync-shared-ui.js` copies all 5 modules into 9 apps: 45 JS copies plus 4 `.d.ts`, about 2,600 duplicated lines, all in every Component-preload.
- Actual use: `help` uses none; brokers, messages, numberranges and variables use `Help` (+ `Navigation`); runs uses `Help` and `MyEntriesFilter`; home uses `Actions` and `Navigation`.
- Every change to `_shared` produces a 9-file diff.
- The script writes an LF header in front of CRLF content, so the working copies have **mixed line endings** (`git ls-files --eol` → `w/mixed`). The `--check` hides it by normalising.

**Recommendation:**
- Short term: copy only the modules each app needs (derived from the `sap.ui.define` dependencies, or a list in the manifest), write consistent line endings, and add `.gitattributes` (D10).
- Long term: generate the copies in the UI5 build and dev server (custom task/middleware or a small UI5 library) and git-ignore them.

### 4.3 Structure and typing (carried over, growing)

- **U14 – `openRunDialog` is now 310 lines (Medium).** [TestCaseActions.js:36-346](../app/testcases/webapp/ext/TestCaseActions.js#L36-L346) (was 225). It holds the state model, socket, polling, credentials, estimate/format helpers, prefs and the start/stop calls. `importFile` (`:454-492`) is still a promise pyramid. **Recommendation:** split it into `ext/RunDialog.js` (dialog controller) and `ext/FileIO.js`. `TestCaseActions.js` then keeps only the handlers named in the manifest.
- **U15 – The subscriber controller is now 727 lines (Medium).** [Main.controller.ts](../app/subscriber/webapp/controller/Main.controller.ts) (was 556). **Recommendation:** extract a `SubscriptionSession` (start/stop/heartbeat, see U2), a `MessageBuffer` (buffer/flush/filter, see U4) and a `TopicList` util.
- **U16 – Mixed JS/TS and ES5 (Medium).** All of `testcases/webapp/ext` is ES5 (`var`, `that = this`). The TS controller casts `c.getObject() as Record<string, string>` although `messageCount` is a number (`:507-511`). The class field `brokers` is declared between methods (`:231`). **Recommendation:** migrate `testcases/webapp/ext` to TS with the existing `ui5-tooling-transpile` setup, after U14 has split it. Until then, at least use `const`/`let` and arrow functions consistently.
- **U17 – Fragile control lookups (Low).** `partsOf` walks the control tree ([PayloadSection.js:74-89](../app/testcases/webapp/ext/PayloadSection.js#L74-L89)), `brokerList` matches ids with a regex ([TestCaseActions.js:142-146](../app/testcases/webapp/ext/TestCaseActions.js#L142-L146)), and FE ids are hardcoded ([ObjectPageExt.controller.js:24](../app/testcases/webapp/ext/ObjectPageExt.controller.js#L24)). The manifest already uses runtime `visible` bindings for header actions (`manifest.json:208-218`), so `preview` can use one on `kind` too. **Recommendation:** use `Fragment.byId`/`api.byId`, and bind the payload status to a small JSON model.
- **U18 – Two localStorage prefs implementations (Low).** [testcases/webapp/ext/Prefs.js](../app/testcases/webapp/ext/Prefs.js) and [Main.controller.ts:29, :697-711](../app/subscriber/webapp/controller/Main.controller.ts#L697-L711). **Recommendation:** move `Prefs` to `_shared`.
- **U20 – PayloadSection decides the status twice (Low).** [PayloadSection.js:91-110](../app/testcases/webapp/ext/PayloadSection.js#L91-L110): `show` and `statusText/State/Icon` each call `JsonTemplate.validate`. The popover is a module singleton bound to the first view. **Recommendation:** one `status(text)` function returning `{text, state, icon}`.
- **U21 – Kind labels hardcoded (Low).** 'Folder'/'Test Case' appear in `TypeColumn.fragment.xml:9-10` and in the manifest `nodeType.values` (`:161-162`), although the service delivers `kindText`.
- **U22 – Small inconsistencies (Low).**
  - `_shared/Help.d.ts` declares only `open`/`SECTIONS`, not `openForList`/`openForObjectPage`/`openForRun`.
  - Unused ids: `previewBroker` (`PreviewDialog.fragment.xml:17`) and `topicList` (subscriber `Main.view.xml:188`).
  - `catch {` (ES2019) in otherwise ES5 code (`help/…/Main.controller.js:60`).
  - Hand-formatted error text instead of `Actions.errorText` (`:82`).
  - Brace-less `if`s in `home/…/Main.controller.js:132-146`.
  - Hand-made plurals ("broker(s)", "subscription(s)").

### 4.4 i18n (carried over)

- **U19 – Nearly all UI text is hardcoded English (Medium).**
  - Only `home` uses `{i18n>…}` (59 keys). Every other `i18n.properties` holds only `appTitle`/`appDescription`.
  - Hardcoded texts are everywhere else: all fragments and views, toasts and MessageBoxes, manifest action texts (`"Help"`, `"Run…"`), and all annotations.
  - **Recommendation:** do it together with U7: `_i18n/i18n.properties` for CDS, then per app. It is a large mechanical change, so do it one app at a time.

---

## 5. Tests (`test/`, `e2e/`)

### 5.1 Correctness and stability

#### T1 – E2E "Test Runs opens (no runs yet)" races with the run dialog specs (High)
[e2e/apps.spec.ts:24-28](../e2e/apps.spec.ts#L24-L28), [e2e/run-dialog.spec.ts:8-56](../e2e/run-dialog.spec.ts#L8-L56), [playwright.config.ts:19-22, :41](../playwright.config.ts#L19-L22)

- The test expects "No results found". But `run-dialog.spec.ts` starts runs as the same admin user against the same server.
- Playwright runs with `fullyParallel: true` and 3 workers, so the result depends on timing.
- Locally, `reuseExistingServer: !CI` makes the test fail on any server that already has runs. On CI, `retries: 1` would hide the flake.

**Recommendation:** only assert that the app opens without an error. Or run the specs that start runs in `mode: 'serial'` in their own project.

#### T2 – `test/number-ranges.test.ts` depends on test order (High)
[test/number-ranges.test.ts:42-43, :56, :70, :81, :98, :118, :131-151](../test/number-ranges.test.ts#L42-L43)

- The shared `testCase` is assigned inside an `it` (`:81`).
- The `ORDERS` range comes from the first `it`, and the uniqueness check at `:70` relies on it.
- The exact expected numbers (`:98`, `:118`, `:151` `SO-000100`) depend on what earlier tests consumed.
- `.only` or reordering breaks the file. This is a regression of old T3.

**Recommendation:** create the fixtures in `beforeAll`, use one range per test (or reset in `beforeEach`), and keep each `it` self-contained.

#### T3 – E2E fails on a second run against a reused dev server (Medium)
- `e2e/number-ranges.spec.ts:14, :26` create `E2E_ORDERS`/`E2E_PREVIEW` and never delete them. Names are unique, so the second `npm run e2e` against a running `cds watch` fails, and the preview number is no longer 4500.
- `e2e/subscriber.spec.ts:21-53` deletes "E2E orders" only at the end, so a failure halfway leaves it behind.

**Recommendation:** add a unique suffix per run (`Date.now()`/`testInfo.workerIndex`) and clean up in `test.afterEach`.

#### T4 – Real-time waits and an unbounded loop (Medium)
- [run-options.test.ts:61-69](../test/run-options.test.ts#L61-L69) measures wall-clock time (`took >= 290`, `< 2500`).
- `:97` `while (!published.length) await sleep(20)` has no bound.
- `:105` relies on the cancel arriving within 20×300 ms.
- [session.test.ts:37-41](../test/session.test.ts#L37-L41) waits a real 200 ms (old T18).

**Recommendation:** use fake timers (`doNotFake: ['setImmediate','nextTick']`), as `subscription-hub.test.ts` already does, or a bounded `waitFor(cond, timeoutMs)` helper in `helpers.ts`.

#### T5 – Weak assertions and over-promising names (Medium)
- Status-only checks: `number-ranges.test.ts:76`, `run-options.test.ts:116-124`, `services.test.ts:127-136, :330-333`. A 400 for an unrelated reason still passes. **Fix:** also `toMatch` the error message.
- `fake-data.test.ts:115-118` "uses the language of the setting" only checks `valid === true`.
- `agent.test.ts:77-85` "speaks MCP to testers only" only tests anonymous → 401. **Fix:** add `users.noRole` → 403.
- `agent.test.ts:367` ignores the `getRunSummary` result.
- `run-options.test.ts:92-100` starts and stops the run as admin, so the "own run" branch of `cancelRun` ([test-runner.ts:68](../srv/lib/test-runner.ts#L68)) is never told apart from the Admin branch. **Fix:** add a tester-stops-own-run case and a tester-cannot-stop-other's-run case.
- `run-options.test.ts:83` `stats.find(...)?.run_ID).not.toBe(runId)` also passes when there is no row.
- `services.test.ts:74` asserts `badBroker.url` in an unrelated test.

#### T6 – Brittle E2E selectors (Medium)
- FE-generated ids: `number-ranges.spec.ts:13`, `my-entries.spec.ts:15`, `subscriber.spec.ts:45`.
- CSS classes: `payload.spec.ts:15` `.ace_editor`, `shots.spec.ts:46`.
- `run-dialog.spec.ts:42` and `shots.spec.ts:83`: `const [repetitions, pause] = await dialog.getByRole('spinbutton').all()`. `.all()` does not wait, so if the panel has not rendered yet the test throws a TypeError.
- `home.spec.ts:37` hardcodes `toHaveCount(5)`.

**Recommendation:** use `getByLabel(...)` locators, or `expect(...).toHaveCount(2)` before `.all()`. Add labels where FE ids are the only handle.

### 5.2 Duplication

| # | What | Where | Recommendation |
|---|---|---|---|
| T7 | The `runTests` payload plus `waitForRun` is repeated, and `run-options.test.ts:15-18` already has a local `run()` | `number-ranges.test.ts:94,112,124,145,164`, `services.test.ts`, `tree.test.ts:140-146` | `runAndWait()` in `helpers.ts` |
| T8 | `process.env.destinations` is set and deleted by hand, and `afterAll` deletes instead of restoring | `agent.test.ts:54,73`, `services.test.ts:91-113, :498-514`, `destinations.test.ts:15,37,52,63` | `withDestinations(list, fn)` next to `withAemSuiteConfig` |
| T9 | Draft plumbing: 9 + 3 inline `draftActivate` URLs. `MCP_HEADERS` is defined twice. The "find test case + preview" helper and the Ping test case ID are each in 3-4 e2e files | `services.test.ts:63,101,106,119,131,145,427,450,481`, `tree.test.ts:59,65,271`, `agent.test.ts:6`, `mcp-oauth.test.ts:4`, `e2e/demo-data.spec.ts:5-12`, `e2e/number-ranges.spec.ts:40-43`, `e2e/apps.spec.ts:18`, `run-dialog.spec.ts:12,34`, `shots.spec.ts:5` | `draft.activateExpectingError()`, `draft.edit()`, `mcpRpc()` in `helpers.ts`; `previewTestCase()` and `PING_ID` in `e2e/launchpad.ts` |
| T10a | Leftovers from the old T4/T6: `services.test.ts:110` restores `active` inside `try` instead of `finally`. `tree.test.ts:36` has its own table list. `number-ranges.test.ts:51` and `run-options.test.ts:128` add a redundant `DELETE NumberRanges` | as listed | Use `finally` and `resetDatabase()` |
| T11 | The two Playwright configs repeat the channel, web server, locale and credentials. The screenshots config sets `viewport` twice | [playwright.config.ts](../playwright.config.ts), [playwright.screenshots.config.ts:19-30](../playwright.screenshots.config.ts#L19-L30) | `playwright.base.ts` that both spread |

### 5.3 Coverage gaps

| Module | Gap |
|---|---|
| `srv/admin-service.ts` | Broker validation messages (URL/VPN required, unsupported scheme, timeout range), the "saved, but the connection test failed" warning, GlobalVariables invalid name, NumberRanges reset 404/negative. None of these messages appear in a test |
| `srv/lib/credentials/resolve.ts` | All DESTINATION error branches (`:59-73`) and `currentJwt()`. `resolve.test.ts` covers DIRECT only. Mock `getDestination` the same way `destinations.test.ts` does |
| `srv/lib/solace/session.ts` | `subscribe` (OK/error/timeout), queue consumer/browser/`bindFlow`, connect guard timeout, `DOWN_ERROR`, close timeout, non-text messages |
| `srv/lib/solace/subscription-hub.ts` | Subscribe failure → session closed + 400, flow `DOWN_ERROR`, ack failure. `FakeSubscriberSession` has no failure modes: add `failSubscribe`/`emitFlowDown()` |
| `srv/lib/test-runner.ts` | "Test case was deleted" (`:357-360`), TemplateError → ERROR (`:375`), progress websocket emits, `served`/`shutdown` wiring in `server.ts`, B1 |
| `srv/lib/number-ranges.ts` | Optimistic-lock retry and the "is busy" error (`:100-113`) |
| `srv/lib/preview.ts`, `copy-nodes.ts`, parse/validate of `export-import.ts` | HTTP tests only, no direct unit tests |
| `srv/subscribe-service.ts` | `start` success over HTTP, `stop`, non-empty `activeSubscriptions` |
| `srv/live-service.cds` | E2E only; websocket auth and context are not covered by Jest |
| Demo data (`test/data`) | Only checked by e2e (6 of 13 test cases). Optional: a Jest test that previews every demo test node |

### 5.4 Smaller items

- **T12** – `startServer()` runs at module level in `tree.test.ts:6`, `number-ranges.test.ts:36` and `fake-data.test.ts:71`, so their DB-free `describe`s pay for a server boot (14 of 25 files start one). Split them into `*-unit.test.ts` files.
- **T13a** – Big `it`s (old T8): `agent.test.ts:167-213`, `services.test.ts:54-75, :178-216, :228-275`. `const test = …` shadows the Jest global in `node-validation.test.ts:12`. The callback body in `help.test.ts:109-124` is mis-indented, and the guide and `allIds` are built twice in that file (`:13/:36`, `:37-41/:75-79`).
- **T14** – The screenshot spec has 11 `waitForTimeout`s, and `shots.spec.ts:42` `.catch(() => undefined)` turns a missing row into a silently wrong screenshot. Acceptable for a docs tool, but fix `:42`.
- **T15** – Keep the `@toon-format/toon` shim: it is still needed because the package is ESM-only and `@cap-js/mcp` loads it with `require`. Add a comment to [test/shims/toon.js](../test/shims/toon.js) explaining why, and that the TOON text channel of successful tool results is therefore not tested.

---

## 6. Build, deployment, tooling, docs

### 6.1 Deployment and security

#### D1 – XSUAA redirect URI wildcard over the shared CF domain (High) ⚖ Decision
[mta.yaml:267-270](../mta.yaml#L267-L270)

```yaml
redirect-uris:
  - https://*.${default-domain}/**
  - http://localhost:8765/**
```

- `${default-domain}` is the **shared** landscape domain (for example `cfapps.eu10-004.hana.ondemand.com`), so any app of any customer there is a valid redirect target.
- The client credentials are handed to AI clients (`aem-suite-auth-key`, `mta.yaml:128-130`), which makes this worse.
- The localhost entry (old T13) is allowed in every environment.

**Recommendation:** restrict the URI to the approuter's own route, for example `https://${org}-${space}-aem-suite.${default-domain}/**` (or the `app-api` URL). Move localhost into a `dev.mtaext`. If localhost stays, document it as an accepted risk in the technical docs.

#### D2 – Fixed role collection names collide across spaces (Medium) ⚖ Decision
[xs-security.json:27-38](../xs-security.json#L27-L38), [mta.yaml:264](../mta.yaml#L264)

- `xsappname` is unique per org/space, but `AEM_Suite_Admin`/`AEM_Suite_Tester` are fixed.
- Role collection names must be unique per subaccount, so a second space in the same subaccount fails to deploy.

**Recommendation:** suffix the names per environment through `.mtaext`, or drop `role-collections` from `xs-security.json` and create them per subaccount. Document the constraint.

#### D3 – Approuter dependencies are not reproducible (Medium)
[app/router/package.json](../app/router/package.json), [mta.yaml:46-47](../mta.yaml#L46-L47)

`"@sap/approuter": "^23"` with no lockfile and `builder: npm`, so each `mbt build` resolves the newest 23.x. **Recommendation:** commit `app/router/package-lock.json` and use `builder: npm-ci`, or make `app/*` npm workspaces (see D9).

#### D4 – Technical documentation has drifted from the code (Medium)
[docs/technical-documentation.md](technical-documentation.md):

- **§4 repository layout (`:59-86`)** is missing:
  - apps: `numberranges`, `help`, `home`, `_shared`
  - services: `help-service`, `home-service`, `agent-service`
  - folders and scripts: `e2e/`, `docs/`, `scripts/sync-shared-ui.js`, `scripts/screenshots/`
- **`:157`** documents `NumberRanges` under SubscribeService. It belongs to AdminService.
- **`:134, :141`** show the `runTest`/`runTests` signatures without `options`. `cancelRun` is missing, and `:54` still says one row "per test case × broker" (without repetitions).
- **§8.1 (`:383`)** is missing `numberranges`.
- **§8.2 (`:396-411`)** places `MyEntriesFilter`/`LiveSocket` in `testcases/webapp/ext` and talks about "the two LiveSocket clients". They are in `_shared` now.
- **§9 (`:416`)** omits Help/Home (`authenticated-user`) and the agent service.
- **§11 (`:472-490`)** lists 10 of 26 test files and 4 of 12 e2e specs.
- **`:487`** says "the seven tiles" and **`:521`** "the seven apps". There are nine.
- **§12 (`:507`)** lists 8 HTML5 modules. There are 10.
- [README.md:121](../README.md#L121) lists `/odata/v4/{admin,test,subscribe}` without `help` and `home`.

**Recommendation:** fix these. Replace the per-file test lists with a short description per test category, because full lists drift. Optionally, extend `mta.test.ts` to compare the doc's module table with `mta.yaml`.

#### D5 – The developer workflow is not documented (Medium)
README and the technical docs never mention `npm run sync:ui`, `verify`, `lint`, `build:ui` or `typer`. That `app/*/webapp/shared/*` are generated files that must not be edited by hand is stated only in the file header and enforced only by a test. **Recommendation:** add a "Development workflow" section to the README (edit `app/_shared` → `npm run sync:ui`; `npm run verify` before pushing; the commit convention).

#### D6 – Node version unpinned and inconsistent (Medium) ⚖ Decision (which LTS)
- `package.json` has `">=22.12"`, `app/router/package.json` has `">=22"`, and `@types/node` is `^22`.
- The local machine runs Node 24.22.
- The CF buildpack resolves `>=` to the newest Node it has, so production can jump a major version.
- There is no `.nvmrc`.

**Recommendation:** use `"^22.12"` (or `^24`) in both files, add `.nvmrc` with the same major, and keep `@types/node` on that major.

#### D7 – `docs/clean-code-review.md` is stale (Medium)
- It is pinned to `3c4d9d2` and has no status per finding.
- It contains statements that are no longer true ("There is also no `lint` script").
- 6 relative links are broken (`../app/brokers/webapp/ext/Help.js`, `../app/testcases/webapp/ext/LiveSocket.js`, `../app/subscriber/webapp/util/LiveSocket.ts`, …).

**Recommendation:** move it to `docs/archive/clean-code-review-2026-10-15.md` with a note at the top that it was superseded by this document, which carries its open items over (section 7).

### 6.2 Hygiene

| # | What | Where | Recommendation |
|---|---|---|---|
| D8 | `.gitignore` gaps: `.env*` is not ignored although `local/README.md:64` suggests a "local `.env`". `coverage/` and `*.tgz` are missing too. `local/terragrunt/.gitignore` ignores `.terraform.lock.hcl`, which should be committed, and the provider is `~> 1.0` | [.gitignore](../.gitignore), [local/terragrunt/.gitignore](../local/terragrunt/.gitignore) | Add the entries; commit the lock file when the stack is next applied |
| D9 | Per-app `package.json` files repeat `ui5-task-zipper ^3.7.0` (×10), and the subscriber repeats `@sapui5/types`/`ui5-tooling-transpile`. No app declares `@ui5/cli`: builds only work because the root `node_modules/.bin` is on the PATH after `before-all: npm ci` | `app/*/package.json`, [mta.yaml:8-11](../mta.yaml#L8-L11) | Remove the duplicated devDependencies (keep `scripts`) and document that the root installs the tooling. Or make `app/*` npm workspaces |
| D10 | No `.gitattributes`/`.editorconfig`, and `core.autocrlf=true`. 12 files are `w/mixed` (`app/*/ui5.yaml`, shared copies, `db/src/.hdiconfig`, `db/undeploy.json`) | repo root | `.gitattributes` with `* text=auto eol=lf` (+ `*.png binary`), an `.editorconfig` (2 spaces, LF, final newline), then renormalise once |
| D11 | Version `1.0.0` is hardcoded in `mta.yaml`, the root and 10 app `package.json` files, and 10 manifests, and has never been bumped. The docs hardcode `aem-suite_1.0.0.mtar`. There is no `repository` field and no CHANGELOG | [mta.yaml:3](../mta.yaml#L3), [README.md:246](../README.md#L246) | Add `repository`. Use `mta_archives/aem-suite_*.mtar` in the docs. Optional: a `scripts/set-version.js` and a CHANGELOG |
| D12 | Version ranges in three styles; `@sap/cds` is in the lockfile twice (10.1.1, plus 10.1.0 nested under cds-dk) | [package.json](../package.json) | `npm dedupe`. Use caret ranges with a minimum minor everywhere except deliberate pins (`@playwright/test`, `@sapui5/types`, faker 9) |
| D13 | MTA runtime settings: `aem-suite-srv` has no `health-check-type: http` (`/health`) and no `disk-quota`; the db-deployer has no `memory`/`disk-quota` | [mta.yaml:15-40](../mta.yaml#L15-L40) | Add the health check and quotas |
| D14 | All UI assets are served `no-cache, no-store` while each `ui5.yaml` generates cachebuster info | `app/*/xs-app.json` (for example [brokers:17](../app/brokers/xs-app.json#L17)) | Either allow caching of versioned resources, or drop the cachebuster step. Document the choice |
| D15 | `mbt` is installed globally and unpinned (`npm i -g mbt`). There are no `build`/`deploy` scripts | [README.md:244](../README.md#L244), [package.json](../package.json) | `mbt` as devDependency, `"build": "mbt build"`, `"deploy": "cf deploy mta_archives/aem-suite_*.mtar"` |
| D16 | Local setup: `local/README.md:58-64` points to VPN `default` and env-based config (the app uses VPN `aem-local` and the demo brokers). PowerShell is a missing prerequisite. The root README does not say `docker compose` runs in `local/`. `docker-compose.yml:21` has the literal password `admin`. The image is `:latest` (old T16) | [local/README.md](../local/README.md), [local/docker-compose.yml](../local/docker-compose.yml) | Fix the text, use `${SOLACE_ADMIN_PASSWORD:-admin}`, pin the image to a concrete tag |
| D17 | No LICENSE/NOTICE (`"license": "UNLICENSED"` only) and no CONTRIBUTING | repo root | Optional: a one-line proprietary notice. CONTRIBUTING can be the README section from D5 |

---

## 7. Carried over from the previous review

| Old ID | Status | Now |
|---|---|---|
| B14 (criticality twice) | Partly open | B20 |
| B15 / B26 (defaults, lengths, truncation) | Partly open | B9 |
| B17 (cds-typer unused) | Open | B17 |
| B19 (status strings untyped) | TS side open | B13 |
| B28 (row-by-row writes) | Open, plus new per-message tx/emit | B26 |
| U13 (per-app config copies) | Accepted, now with guards | U6, U9 |
| U14, U15, U16, U17, U19 | Open, U14 and U15 grew | §4.3, §4.4 |
| T3 (order dependence) | Regressed in `number-ranges.test.ts` | T2 |
| T8 (big `it`s) | Open | T13a |
| T13 (localhost redirect) | Fixed | D1 |
| T16 (`:latest` image) | Open | D16 |
| T18 (real-time wait) | Open, spread | T4 |
| everything else | Fixed | – |

---

## 8. Suggested order of work

1. **Green and guarded:** G1, G2, G3. Fix `main`, add CI, close the lint gaps, so every later change is checked.
2. **Bugs and server-side rules:** B1, B2, B3, B4, B5, B8, B10, U2, U3, U4, T1, T2, T3.
3. **Hygiene with no behaviour change:**
   - D10 (`.gitattributes`), D8, D7 (archive the old review), U1 (dead router folder)
   - D4 + D5 (docs), D6 (Node), D3, D9, D12, D13, D15, D16
4. **Single sources of truth, guarded by tests:** U5 (app catalog), U6 (UI5 version), B7 (CDS types), B9 (column lengths), B6 (field descriptor), U9 (shared copies).
5. **Test hygiene:** T4–T11, T15, and the coverage gaps in 5.3.
6. **Smaller consistency fixes:** B12–B16, B17a, B18, B19, B21–B24, U17, U18, U20–U22.
7. **Larger refactors:** B17 (cds-typer), U14, U15, then U16 (TS migration), U7 + U19 (annotations and i18n), U8.
8. **Decisions for the owner:** D1, D2, D6 (LTS line), B11 (STOPPED status), B27.
