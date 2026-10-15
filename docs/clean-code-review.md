# Clean Code Review – AEM Test Suite

| | |
|---|---|
| **Date** | 2026-10-15 |
| **Commit** | `3c4d9d2` (main) |
| **Scope** | `srv/`, `db/`, `app/`, `test/`, `e2e/`, build & deployment config (~9,100 lines) |
| **Method** | Manual read-through of all source files, `tsc --noEmit -p tsconfig.test.json` (passes), `eslint .` (44 problems, see T1) |

Severity: **High** = bug or structural problem with real impact · **Medium** = maintainability cost that grows with the code · **Low** = local cleanup.

---

## 1. Summary

Overall the codebase is in good shape. The modules are small and focused. Comments explain *why*, not *what*. Security is handled carefully: passwords are never stored, agents cannot handle credentials, and the tests assert both. The broker sits behind a seam (`setConnector`), so the Jest suite runs without network access.

The main weaknesses are:

1. **Duplication across boundaries.** The same helper is re-implemented in each service or app: `httpError` (5×), `keyOf`, config access, `Help.js` (7×), `LiveSocket` (JS + TS), `MyEntriesFilter`, and the test setup. Several bugs below come straight from this, because a fix landed in one copy but not the others.
2. **Type safety is weaker than the TypeScript setup suggests.** cds-typer generates models that no file uses. Entities are addressed by string names, there are 15 `as unknown as` casts in `srv/`, ESLint lints no `.ts` file at all, and ts-jest only warns on type errors.
3. **A few long functions mix concerns:** `executeRun`, `importNodes`, `openRunDialog` (225 lines), and the subscriber controller (556 lines).
4. **Hardcoded texts.** Every `i18n.properties` file contains only the app title.

### Top 10 to address first

| # | Finding | Severity | Area |
|---|---------|----------|------|
| 1 | [B1](#b1--a-crashed-run-stays-running-forever-high) A crashed run stays `RUNNING` forever and permanently blocks agent run slots | High | Backend |
| 2 | [U1](#u1--standalone-fallback-urls-point-to-paths-that-do-not-exist-high) Help / "Open Results" / "Open Test Case" give a 404 outside the launchpad | High | UI |
| 3 | [U2](#u2--the-run-dialogs-livesocket-has-no-reconnect-or-close-handling-high) The run dialog can show "Running…" forever when the websocket drops | High | UI |
| 4 | [T1](#t1--eslint-does-not-check-any-typescript-and-lints-build-output-high) ESLint does not check any TypeScript and lints `dist/` output | High | Tooling |
| 5 | [T3](#t3--tests-depend-on-the-order-they-run-in-high) Tests depend on the order they run in (shared `let` state) | High | Tests |
| 6 | [U5](#u5--action-bindings-holding-passwords-are-only-destroyed-on-success-medium) Action bindings that hold passwords are not destroyed on error | Medium | UI |
| 7 | [B2](#b2--messages-saved-from-the-live-view-bypass-the-node-rules-medium) "Create test case from message" skips validation and sort order | Medium | Backend |
| 8 | [B17](#23-type-safety-and-the-data-model) Use the generated cds-typer models instead of string entity names and casts | Medium | Backend |
| 9 | [U7](#32-duplication) / [B6–B16](#22-duplication) Pull the duplicated helpers into shared modules | Medium | All |
| 10 | [T10](#t10--subscription-hubts-has-no-tests-and-cannot-be-tested-as-written-high) Make `subscription-hub.ts` testable and test it | High | Tests |

---

## 2. Backend (`srv/`, `db/`)

### 2.1 Correctness issues found while reviewing

#### B1 – A crashed run stays `RUNNING` forever (High)
[srv/lib/test-runner.ts:119-128](../srv/lib/test-runner.ts#L119-L128), [srv/lib/test-runner.ts:130-232](../srv/lib/test-runner.ts#L130-L232)

`executeRunInBackground` only logs when `executeRun` throws (for example when the DB read in `loadTestCases` / `loadVariableScopes` fails, or the final `UPDATE … status: 'DONE'` fails). Nothing ever sets the run to `FAILED`, although `RunStatus` has a `FAILED` value ([db/schema.cds:32-36](../db/schema.cds#L32-L36)) that no code writes. A server restart in the middle of a run has the same effect.

Effects:
- The run shows "RUNNING" in the UI for good. `getRunSummary` polls it until it times out.
- The agent limit `maxActiveRuns` counts `status = 'RUNNING'` rows ([srv/agent-service.ts:191](../srv/agent-service.ts#L191)), so each crashed run blocks one of the user's agent run slots for good.

**Recommendation:** in the `.catch` of `executeRunInBackground`, mark the run as `FAILED` (`finishedAt`, and the remaining `PENDING` results as `ERROR`) in its own transaction. On startup, set orphaned `RUNNING` runs to `FAILED`.

#### B2 – Messages saved from the live view bypass the node rules (Medium)
[srv/subscribe-service.ts:61-98](../srv/subscribe-service.ts#L61-L98)

`createTestCase` writes straight to `aem.suite.TestCases`, which skips everything `node-validation.ts` was built to share ("so both ways in apply exactly the same checks"):
- No `nextSortOrder`, so the new test case gets `sortOrder 0` and is listed **first** at top level instead of last.
- No `validateNode`, so there are no length checks (`topic` is `String(500)`; a received topic or `correlationId` can be longer) and no enum checks.
- It infers property types with its own logic (`Number.isInteger(value)`) instead of `inferPropertyType` from [srv/lib/defaults.ts:46](../srv/lib/defaults.ts#L46).

**Recommendation:** route this through the same `createNode` path the agent uses (move `createNode` from `agent-service.ts` into `lib/`), or at least call `validateNode` / `nextSortOrder` / `inferPropertyType`.

#### B3 – Destination value help and connection use different property names (Medium)
[srv/lib/credentials/destinations.ts:33-34](../srv/lib/credentials/destinations.ts#L33-L34), [srv/lib/credentials/destinations.ts:56-57](../srv/lib/credentials/destinations.ts#L56-L57) vs [srv/lib/credentials/resolve.ts:59-61](../srv/lib/credentials/resolve.ts#L59-L61)

`resolveConnection` accepts both `smfUrl` / `aem.smfUrl` and `msgVpn` / `aem.msgVpn`. `listDestinations` ignores `aem.smfUrl` for BTP destinations and ignores both `aem.*` names for env destinations. A destination that only has `aem.smfUrl=tcps://…` connects fine but can be filtered out of the value help (when its `URL` is not a broker URL), or shows the wrong URL and an empty VPN.

**Recommendation:** add one `readBrokerProps(props)` helper that returns `{ url, msgVpn }` and use it in both files.

#### B4 – Large integer user properties lose precision without an error (Low)
[srv/lib/node-validation.ts:104](../srv/lib/node-validation.ts#L104), [srv/lib/defaults.ts:48](../srv/lib/defaults.ts#L48), [srv/lib/solace/session.ts:359-361](../srv/lib/solace/session.ts#L359-L361)

Three different rules decide what an `INT` is. Validation accepts any number of digits (`/^-?\d+$/`). Inference only accepts up to 15 digits. `buildMessage` uses `Number(p.value)`, which rounds any value above 2^53 without an error (`Number.isInteger` still returns true). The `BOOL` words (`yes/no/1/0`) are also defined separately in validation and in `buildMessage`.

**Recommendation:** put the `INT`/`BOOL` parsing in one module that `defaults.ts`, `node-validation.ts` and `session.ts` all use. Reject `INT` values outside `Number.MIN_SAFE_INTEGER..MAX_SAFE_INTEGER`, or send them via `BigInt`/`Long`.

#### B5 – Subscription topics are joined into one string and split again (Low)
[srv/lib/solace/subscription-hub.ts:78](../srv/lib/solace/subscription-hub.ts#L78), [srv/lib/solace/subscription-hub.ts:113](../srv/lib/solace/subscription-hub.ts#L113)

`source = topics.join(', ')` is later split again with `source.split(', ')` to subscribe. Any topic that contains `", "` is split into the wrong pieces. Also, the per-user limit is checked before the `await connect`, so two quick `start` calls can both pass it.

**Recommendation:** keep `topics: string[]` on the `Subscription` and build the display string only for `listSubscriptions`. Reserve the slot (put a placeholder in the map) before connecting.

### 2.2 Duplication

| # | What | Where | Recommendation |
|---|------|-------|----------------|
| B6 | `httpError(status, message)` is defined 4 times, plus a fifth inline copy | [copy-nodes.ts:95](../srv/lib/copy-nodes.ts#L95), [export-import.ts:338](../srv/lib/export-import.ts#L338), [test-runner.ts:264](../srv/lib/test-runner.ts#L264), [subscription-hub.ts:267](../srv/lib/solace/subscription-hub.ts#L267), [help-content.ts:53](../srv/lib/help-content.ts#L53). `resolve.ts` adds a third style with `MissingPasswordError` | Add one `lib/errors.ts` with `httpError` (or a small `HttpError` class) and use it everywhere |
| B7 | `keyOf(req)` / reading `req.params[0]` is written 3 times with different return types | [admin-service.ts:122](../srv/admin-service.ts#L122), [test-service.ts:143](../srv/test-service.ts#L143), [subscribe-service.ts:62](../srv/subscribe-service.ts#L62), and inline at [admin-service.ts:85](../srv/admin-service.ts#L85), [admin-service.ts:110](../srv/admin-service.ts#L110) | One `lib/request.ts#keyOf<T>()` |
| B8 | Config is read from `cds.env` with an ad-hoc `as unknown as {...}` cast in 6 places, and the defaults are spread across files | [admin-service.ts:60](../srv/admin-service.ts#L60), [agent-service.ts:18-27](../srv/agent-service.ts#L18-L27), [subscription-hub.ts:52-59](../srv/lib/solace/subscription-hub.ts#L52-L59), [mcp-oauth.ts:23](../srv/lib/mcp-oauth.ts#L23), [mcp-oauth.ts:30](../srv/lib/mcp-oauth.ts#L30), [help-content.ts:40](../srv/lib/help-content.ts#L40) | One typed `lib/config.ts` with an `AemSuiteConfig` interface and all defaults (the table in `docs/technical-documentation.md` §10 already lists them) |
| B9 | "Renumber siblings 10, 20, 30 while keeping `modifiedAt/By`" is written twice | [test-service.ts:52-81](../srv/test-service.ts#L52-L81) (`moveBefore`), [copy-nodes.ts:80-89](../srv/lib/copy-nodes.ts#L80-L89) | Move a `renumberSiblings(parentId, order?)` into `tree.ts` and add a `SORT_STEP = 10` constant (`10` also appears in `node-validation.ts` and `export-import.ts`) |
| B10 | The `problems.push(\`${target.replace(/^in\//,'')}: …\`)` collector is written 3 times, and `Rejector` duplicates the `Reject` type | [agent-service.ts:244-257](../srv/agent-service.ts#L244-L257), [export-import.ts:249-250](../srv/lib/export-import.ts#L249-L250) | Export a `collectProblems()` helper from `node-validation.ts`. One async version is enough for both the sync and async callers |
| B11 | `startRun` (UI) and the agent's `runTests` handler both do the "create run, take the JWT, run after `succeeded`" steps | [test-service.ts:132-141](../srv/test-service.ts#L132-L141), [agent-service.ts:195-199](../srv/agent-service.ts#L195-L199) | Move `startRun` into `test-runner.ts` |
| B12 | The deep read (`t.userProperties(...)`, `t.variables(...)`) is written 5 times | [test-service.ts:104](../srv/test-service.ts#L104), [copy-nodes.ts:48](../srv/lib/copy-nodes.ts#L48), [test-case-spec.ts:34](../srv/lib/test-case-spec.ts#L34), [agent-service.ts:291](../srv/agent-service.ts#L291), [export-import.ts:95](../srv/lib/export-import.ts#L95) | One `selectNodesDeep(where?)` helper. It also removes 15 of the `any` annotations |
| B13 | The variable-name regex is defined twice | [admin-service.ts:80](../srv/admin-service.ts#L80), [node-validation.ts:15](../srv/lib/node-validation.ts#L15) | Export `VAR_NAME` and reuse it |
| B14 | The criticality `case` expressions (PASSED→3, FAILED/ERROR→1) and the run "outcome" are defined in CDS and again in TS | [test-service.cds:93-133](../srv/test-service.cds#L93-L133), [agent-service.ts:226](../srv/agent-service.ts#L226), [admin-service.ts:73](../srv/admin-service.ts#L73) (`connectionCriticality = check.ok ? 3 : 1`) | Read the computed values back after the update, or keep one TS helper and document that the CDS copy must match |
| B15 | Default values are duplicated between the schema and the code: `connectTimeoutMs 10000`, `ackTimeoutMs 5000`, `clientNamePrefix 'aem-suite'`, the enum lists `PERSISTENT/DIRECT` and `STRING/INT/BOOL`, and the column lengths in `validateLengths` | [db/schema.cds](../db/schema.cds), [resolve.ts:50-51](../srv/lib/credentials/resolve.ts#L50-L51), [session.ts:75](../srv/lib/solace/session.ts#L75), [session.ts:93](../srv/lib/solace/session.ts#L93), [test-case-spec.ts:126](../srv/lib/test-case-spec.ts#L126), [node-validation.ts:36-65](../srv/lib/node-validation.ts#L36-L65) | Read enums and lengths from `cds.model.definitions['aem.suite.TestCases'].elements` (`.enum`, `.length`), and keep the runtime defaults in one `defaults.ts` |
| B16 | URL handling is split between `normalizeBrokerUrl` (`defaults.ts`) and `toSmfUrl` (`resolve.ts`), which know the same schemes | [defaults.ts:25-37](../srv/lib/defaults.ts#L25-L37), [resolve.ts:112-118](../srv/lib/credentials/resolve.ts#L112-L118) | Move both into one `broker-url.ts` |

### 2.3 Type safety and the data model

- **B17 – cds-typer is set up but not used (Medium).** `package.json` runs `cds-typer` and maps `#cds-models/*`, but no file imports from it. Instead, entity names are string literals (`'aem.suite.TestCases'` 13×, `'aem.suite.Brokers'` 5×, …), rows are hand-written interfaces (`TestCaseRecord`, `BrokerRecord`, `Row` ×3, `NodeDoc`, `PropertyInput`, …), and there are 15 `as unknown as` casts (7 in `agent-service.ts` alone). If a column in `schema.cds` is renamed, the compiler reports nothing. **Recommendation:** import the generated types (`import { TestCases } from '#cds-models/aem/suite'`) and use the entity objects in queries, starting with the `lib/` modules.
- **B18 – Wide types like `'FOLDER' | 'TEST' | string` (Low).** [tree.ts:8](../srv/lib/tree.ts#L8), [resolve.ts:8](../srv/lib/credentials/resolve.ts#L8), [session.ts:31](../srv/lib/solace/session.ts#L31), [test-case-spec.ts:15](../srv/lib/test-case-spec.ts#L15): the union with `string` reduces to plain `string`, so the literal members give no checking. Use the literal union, or the generated enum type.
- **B19 – Status strings without a type (Low).** `lastConnectionStatus` (`'OK'|'ERROR'`), `ReceivedMessages.sourceType` (`// TOPIC | QUEUE`, while the service uses `QUEUE_BROWSE`/`QUEUE_CONSUME`) and `deliveryMode` (`String(20)` holding `NON_PERSISTENT`) are free text in [db/schema.cds:74](../db/schema.cds#L74), [db/schema.cds:188](../db/schema.cds#L188), [db/schema.cds:195](../db/schema.cds#L195). Give each one an enum type like the other status fields.

### 2.4 Function size and structure

- **B20 – `executeRun` is ~100 lines with four nested closures (Medium)** ([test-runner.ts:130-232](../srv/lib/test-runner.ts#L130-L232)): it loads data, reports progress, publishes per broker, collects stats and finalizes the run. Extract `runBroker(brokerId, pending, ctx)` and a small `RunProgress` class (counts + emit + `finish`). That also gives a natural place for the B1 fix.
- **B21 – `importNodes` is ~120 lines (Medium)** ([export-import.ts:176-294](../srv/lib/export-import.ts#L176-L294)): parsing, the recursive `collect` with nested `text`/`whole` helpers, validation, result building and writing are all in one function. Split it into `parseDocument` → `flatten` → `validate` → `write`. Small things in the same place: `rowFor(n, index)` never uses `index`, and `rowsByDepth` is rebuilt with a spread on every row (O(n²) for 5000 nodes).
- **B22 – The `TestService.init` handlers (Low).** Two `before(['CREATE','UPDATE'], TestCases)` handlers in a row ([test-service.ts:38-47](../srv/test-service.ts#L38-L47)) should be one. `moveBefore` (30 lines of SQL) belongs in `lib/tree.ts` next to `copy-nodes`, like the other tree operations.
- **B23 – Orphaned JSDoc (Low).** [test-runner.ts:39-46](../srv/lib/test-runner.ts#L39-L46): the doc for `createRun` sits right above the doc for `BrokerCredential`, so it is attached to neither, and it names `executeRun()` while the public function is `executeRunInBackground`. Move it to `createRun`.
- **B24 – Needless indirection (Low).** `PublisherFactory`/`setPublisherFactory` in [test-runner.ts:11-16](../srv/lib/test-runner.ts#L11-L16) only rename `Connector`/`setConnector`. Tests could call `setConnector` directly.
- **B25 – `slug` has two meanings (Low).** [help-content.ts:60](../srv/lib/help-content.ts#L60) (GitHub anchor, Unicode) and [export-import.ts:330](../srv/lib/export-import.ts#L330) (ASCII file name) have the same name and different rules. Rename the second one `fileNameOf`.
- **B26 – Inconsistent truncation (Low).** `truncate()` adds `...`, while other places silently `.slice(0, 500|1000|200)` ([broker-check.ts:40](../srv/lib/broker-check.ts#L40), [test-runner.ts:36](../srv/lib/test-runner.ts#L36), [subscribe-service.ts:83](../srv/subscribe-service.ts#L83)). The live-view payload limit compares bytes but cuts characters ([subscription-hub.ts:198](../srv/lib/solace/subscription-hub.ts#L198)). Use one `truncate(s, max)` everywhere.
- **B27 – Shutdown listener registered in `init` (Low).** `cds.on('shutdown', …)` in [subscribe-service.ts:16](../srv/subscribe-service.ts#L16) adds one more listener every time the service is created (happens in tests). Register it once at module level, or in `server.ts`.
- **B28 – Writes one row at a time (Low).** Sibling renumbering and `copySubtree` run one `UPDATE`/`INSERT` per row in a loop ([test-service.ts:78-80](../srv/test-service.ts#L78-L80), [copy-nodes.ts:58-74](../srv/lib/copy-nodes.ts#L58-L74)). That is fine for today's tree sizes. Batch it (one `INSERT … entries([...])` per depth, as `importNodes` already does) if folders grow.

---

## 3. UI apps (`app/`)

### 3.1 Correctness issues found while reviewing

#### U1 – Standalone fallback URLs point to paths that do not exist (High)
[app/brokers/webapp/ext/Help.js:13](../app/brokers/webapp/ext/Help.js#L13) (and the same line in messages / runs / variables), [app/testcases/webapp/ext/Help.js:14](../app/testcases/webapp/ext/Help.js#L14), [app/testcases/webapp/ext/TestCaseActions.js:20](../app/testcases/webapp/ext/TestCaseActions.js#L20), [app/subscriber/webapp/controller/Main.controller.ts:333](../app/subscriber/webapp/controller/Main.controller.ts#L333), [Main.controller.ts:539](../app/subscriber/webapp/controller/Main.controller.ts#L539)

```js
: window.location.origin + "/help/index.html#/" + SECTION;   // Help.js
window.open("/runs/index.html#/TestRuns(" + runId + ")", "_blank");  // TestCaseActions.js
```

The apps are served at `/comaemsuite<app>/`: locally via `mountPath` in `ui5.yaml`, in the HTML5 repo at the same path, and in Work Zone below an extra prefix. Nothing is served at `/help/` or `/runs/`, so every one of these links gives a 404 when an app is opened directly. The e2e tests only go through the launchpad, so they do not catch it.

**Recommendation:** build the URL relative to the app, as `LiveSocket` already does with `sap.ui.require.toUrl(...)`. Alternatively, always navigate through the ushell Navigation service and drop the standalone branch. Add one e2e test that opens an app standalone.

#### U2 – The run dialog's LiveSocket has no reconnect or close handling (High)
[app/testcases/webapp/ext/LiveSocket.js:15-41](../app/testcases/webapp/ext/LiveSocket.js#L15-L41)

The JS copy only listens to `open`, `error` and `message`. When the socket drops during a run (approuter idle timeout, network blip), the progress events stop and the dialog keeps showing "Running…" with nothing telling the user why. More problems in the same file:
- `_ready` rejects on `error` before anyone has attached a handler, which gives an unhandled rejection.
- `_closed` is written but never read.
- `TestCaseActions.js:52` opens a socket every time the dialog opens, even if nothing is ever run.

The TypeScript twin [app/subscriber/webapp/util/LiveSocket.ts](../app/subscriber/webapp/util/LiveSocket.ts) already has backoff, context re-entry and an `onState` callback.

**Recommendation:** keep a single implementation (the TS one), connect lazily in `enter()`, and show "connection lost" in the dialog through `onState`. As a fallback, poll the run status.

#### U3 – Subscriber "Save" uses the current form values, not the subscription the message came from (Medium)
[Main.controller.ts:458-466](../app/subscriber/webapp/controller/Main.controller.ts#L458-L466)

`broker_ID` and `sourceType` are read from the live form. After Stop, the user can switch the broker and then save a message that is still in the list. The message is then stored under the wrong broker, while `source` still names the old subscription.
**Recommendation:** when Start succeeds, take a snapshot `{brokerId, sourceType, sourceLabel}`, or store it on each message.

#### U4 – The message buffer grows without limit while paused (Medium)
[Main.controller.ts:373](../app/subscriber/webapp/controller/Main.controller.ts#L373), [Main.controller.ts:398-403](../app/subscriber/webapp/controller/Main.controller.ts#L398-L403)

While paused, `flush` returns early but `onLiveEvent` keeps pushing to `this.buffer`. On a busy topic that is unbounded memory, although only `MAX_MESSAGES` are ever shown.
**Recommendation:** trim the buffer to `MAX_MESSAGES` in `onLiveEvent`.

#### U5 – Action bindings holding passwords are only destroyed on success (Medium)
[TestCaseActions.js:211-216](../app/testcases/webapp/ext/TestCaseActions.js#L211-L216) (`runTests`), [Main.controller.ts:237-246](../app/subscriber/webapp/controller/Main.controller.ts#L237-L246) (`start`), and also `copyNodes` / `callAction` in `TestCaseActions.js`

`op.destroy()` (comment: "drop the request incl. passwords from the model") sits in the `.then` branch. When `invoke()` fails, the binding and its password parameter stay on the OData model.
**Recommendation:** add one shared `invokeAction(model, path, params, ctx?)` helper that destroys the binding in `.finally()`.

#### U6 – Help search jumps to the top on every key press (Low)
[app/help/webapp/controller/Main.controller.js:179-187](../app/help/webapp/controller/Main.controller.js#L179-L187)

`onSearch` calls `_buildNav()` and then `_show()`, which rebuilds the navigation again and resets the scroll position. **Recommendation:** in `onSearch`, only update the navigation and the highlight.

### 3.2 Duplication

| # | What | Where | Recommendation |
|---|------|-------|----------------|
| U7 | **The Help handler is copied 7 times** (byte-identical apart from `SECTION`), and the "inside the launchpad?" check is copied 3 more times. This is why U1 is in every app | `app/{brokers,messages,runs,variables,testcases}/webapp/ext/Help.js`, `Main.controller.ts:329-335`, `TestCaseActions.js:15-22`, `Main.controller.ts:535-540` | Keep one `app/_shared/` module that `scripts/build-ui.js` copies into each app (or a reuse library). Put the section id in the manifest (`sap.ui5/config/helpSection`) |
| U8 | `MyEntriesFilter.controller.js` exists twice; the copies differ only in the property name. Its `prefilled` flag is module-scoped, so in the FLP it means "once per browser session", and it uses a `setTimeout(…, 0)` workaround | [runs/…/MyEntriesFilter.controller.js](../app/runs/webapp/ext/MyEntriesFilter.controller.js), [testcases/…/MyEntriesFilter.controller.js](../app/testcases/webapp/ext/MyEntriesFilter.controller.js) | One shared extension configured with the property name; keep the flag on the component |
| U9 | `TestCaseActions.js` repeats code it already has a helper for: `activeIds()` exists, but `copySelected` and `runSelected` redo the filter and the toast inline. `errorText` exists in 3 variants, and error display differs (`showError` logs, `onPrimary` does not) | [TestCaseActions.js:351-359](../app/testcases/webapp/ext/TestCaseActions.js#L351-L359), [:421-427](../app/testcases/webapp/ext/TestCaseActions.js#L421-L427), [:454-460](../app/testcases/webapp/ext/TestCaseActions.js#L454-L460), `Main.controller.ts:554`, `help/…/Main.controller.js:77` | `selectActiveIds(contexts)` that includes the toast, plus one shared `errorText` / `showError` |
| U10 | `LiveSocket` is implemented twice (JS without reconnect, TS with it) | [testcases/…/LiveSocket.js](../app/testcases/webapp/ext/LiveSocket.js), [subscriber/…/LiveSocket.ts](../app/subscriber/webapp/util/LiveSocket.ts) | See U2 |
| U11 | Launchpad tile texts are hardcoded and already differ from the apps' i18n texts ("Maintain and run test cases" vs "Maintain and run AEM test cases") | [app/launchpad/webapp/index.html:13-67](../app/launchpad/webapp/index.html#L13-L67) | Read them from the manifests, or add a test that compares them |
| U12 | "Name follows topic" is implemented 3 times: in the server handler, as a `@Common.SideEffects` annotation, and client-side with `setProperty`. The client version triggers an extra PATCH that races with the side effect | [testcases/annotations.cds:147-150](../app/testcases/annotations.cds#L147-L150), [MessageSection.js:18-31](../app/testcases/webapp/ext/MessageSection.js#L18-L31), [test-service.ts:25-34](../srv/test-service.ts#L25-L34) | Keep the server handler plus the side effect, and drop the client code |
| U13 | `manifest.json`, `xs-app.json` and `ui5.yaml` are near-identical across the apps (largely required by Fiori elements and the HTML5 repo) | `app/*/` | Acceptable; generate them from a template, or at least document that they must be kept in sync |

### 3.3 Size, structure and typing

- **U14 – `openRunDialog` is a 225-line closure (Medium).** [TestCaseActions.js:38-262](../app/testcases/webapp/ext/TestCaseActions.js#L38-L262) mixes dialog state, the websocket, OData calls, credential checks, prefs, navigation and control-tree lookups. `importFile` (377-415) is a three-level promise pyramid. **Recommendation:** move the dialog to `ext/RunDialog.js` and the file helpers to `ext/FileIO.js`; the action module then only holds the handlers named in the manifest.
- **U15 – The subscriber controller has too many jobs (Medium).** At 556 lines, [Main.controller.ts](../app/subscriber/webapp/controller/Main.controller.ts) covers the topic editor, credentials, the subscription lifecycle, the heartbeat, buffering, filtering, the message detail, persistence and prefs. The heartbeat calls `activeSubscriptions()`, so the server heartbeat is hidden behind a read function's name (see [subscribe-service.ts:45](../srv/subscribe-service.ts#L45)), and `HEARTBEAT_MS` (60 s) is implicitly tied to the server's `idleTimeoutMs` (5 min). **Recommendation:** extract a `SubscriptionSession` class and a `TopicList` util, and give the heartbeat its own explicitly named action.
- **U16 – Mixed JS and TS, and the TS code bypasses its own types (Medium).** The most complex client code (`testcases/webapp/ext`) is ES5 (`var`, `that = this`). The one TS app casts `this.state.getData() as Record<string, string>` ([:224](../app/subscriber/webapp/controller/Main.controller.ts#L224), [:458](../app/subscriber/webapp/controller/Main.controller.ts#L458)), which types optional values as strings. **Recommendation:** add a `SubscriberState` interface with a typed accessor, and migrate `testcases/webapp/ext` to TS with the existing `ui5-tooling-transpile` setup. That also enables U10.
- **U17 – Fragile control lookup (Low).** [PayloadSection.js:62-73](../app/testcases/webapp/ext/PayloadSection.js#L62-L73) uses `getItems()[0]` / `[1]`; `brokerList()` walks the control tree although the list has an id; [ObjectPageExt.controller.js:24](../app/testcases/webapp/ext/ObjectPageExt.controller.js#L24) hardcodes FE-generated ids. **Recommendation:** use `Fragment.byId` / `api.byId`, and bind status to a small JSON model.
- **U18 – Magic numbers (Low).** `requestContexts(0, 200)` (3×), `(0, 50)` (truncates silently), `.slice(0, 200)` (the CDS length of `name`), the help scroll retry `250 ms × 8`, the `1000` ms revoke delay, and the `30000` ms max backoff. **Recommendation:** name them as constants, and tell the user when a list was truncated.

### 3.4 i18n

- **U19 – Nearly all UI text is hardcoded English (Medium).** Every `i18n.properties` contains only `appTitle` and `appDescription`. Hardcoded texts appear in:
  - all XML views and fragments
  - all MessageToast / MessageBox texts, including hand-made plurals in `describeCounts` ([TestCaseActions.js:296-305](../app/testcases/webapp/ext/TestCaseActions.js#L296-L305))
  - manifest action texts
  - all `@title` / `Label` / `TypeName` values in `app/*/annotations.cds` (there is no `_i18n` folder)

  Even for an English-only app, central texts keep the wording consistent, and it already drifts ("Changed At" / "Tested At" / "Executed At"). **Recommendation:** use `{i18n>…}` in XML, `{{…}}` in manifests, `ResourceBundle.getText` in code, and `'{i18n>…}'` with `_i18n/i18n.properties` for CDS.

### 3.5 Lifecycle and dead code

- **U20 – Missing cleanup (Low).**
  - The Help controller has no `onExit`. Its `_scrollTimer` and scroller listeners outlive the component, and every `_afterShow` attaches a new set of listeners without removing the old ones.
  - [PayloadSection.js:25-60](../app/testcases/webapp/ext/PayloadSection.js#L25-L60) keeps a module-level popover that is never destroyed or added as a dependent.
  - `ObjectPageExt.controller.js:20` calls `requestProperty("kind")` without a `.catch`.
- **U21 – Dead code (Low).** [app/help/webapp/Component.js:12-14](../app/help/webapp/Component.js#L12-L14) overrides `init` only to call super, and `LiveSocket.js._closed` is never read.

---

## 4. Tests and tooling

### 4.1 Quality gates

#### T1 – ESLint does not check any TypeScript and lints build output (High)
[eslint.config.mjs](../eslint.config.mjs) is only `[...cds.recommended]`: no TypeScript parser, no `ignores`, no browser globals. `npx eslint .` checks 72 files, and **none of them is a `.ts` file**. 22 of its 29 errors come from the git-ignored `app/*/dist/**` bundles. The rest are false positives (`WebSocket` / `navigator` "not defined" in webapp code). There is also no `lint` script.

**Recommendation:**
- Add `ignores: ['**/dist/**', 'gen/**', '@cds-models/**']`.
- Add `typescript-eslint` for `srv/`, `test/` and `e2e/`.
- Add browser and `sap` globals for `app/*/webapp/**`.
- Add an `npm run lint` script.

#### T2 – Type errors do not fail anything (Medium)
[jest.config.js:8](../jest.config.js#L8) sets `diagnostics: { warnOnly: true }`. The `typecheck` script exists, but nothing runs it, and the repo has no CI config, even though `playwright.config.ts` branches on `process.env.CI`.
**Recommendation:** add `"verify": "npm run typecheck && npm run lint && npm test"` and run it in CI.

### 4.2 Test structure

#### T3 – Tests depend on the order they run in (High)
- [test/agent.test.ts:46-51](../test/agent.test.ts#L46-L51) (`let folder, test, dest, direct`), [test/services.test.ts:27-29](../test/services.test.ts#L27-L29) (`goodBroker`, `badBroker`, `testCase`) and [test/tree.test.ts:35](../test/tree.test.ts#L35) assign shared state inside individual `it`s, and later tests rely on it.
- `tree.test.ts:176` ("refuses to run an empty folder") picks up the broker that the *previous* test inserted. The exact tree outlines at lines 82-148 depend on every earlier move.
- Running a single test with `.only`, or reordering tests, breaks them.

**Recommendation:** create fixtures in `beforeAll`, keep each `it` self-contained, and turn any scenario chain that must stay into one clearly named test.

#### T4 – Cleanup is not in `finally` (Medium)
[agent.test.ts:329-334](../test/agent.test.ts#L329-L334) and [:373-377](../test/agent.test.ts#L373-L377) insert a `RUNNING` run and delete it only after the assertion. If the assertion fails, the stray run makes every later `runTests` fail with "already have 1 runs in progress", which hides the real failure.

#### T5 – `cds.env` is mutated by hand in three different ways (Medium)
- `agent.test.ts:350,368` and `help.test.ts:119,136` replace `cds.env.aemSuite` entirely.
- `mcp-oauth.test.ts` spreads into it and deletes keys.

Any `aemSuite` config added to `package.json` later would be silently wiped. **Recommendation:** add one `withAemSuiteConfig(patch, fn)` helper that restores a snapshot. Together with B8, this also removes the `as any` casts.

#### T6 – Every test file resets the demo data with its own table list (Medium)
Because `test/data/*.csv` is deployed into every `cds.test` server, each file deletes tables first, but each uses a different list:

| File | Tables deleted |
|---|---|
| `agent.test.ts` | 8 |
| `services.test.ts` | 5 |
| `export-import.test.ts` | 4 |
| `tree.test.ts` | 5 |

**Recommendation:** add one `resetDatabase()` helper, or run Jest under a profile that does not deploy `test/data`.

#### T7 – Setup copy-pasted across the test files (Medium)
- Auth users are defined in 6 files.
- `axios.defaults.validateStatus = () => true` appears 7×.
- The fake publisher factory exists 3×.
- There are two draft create-and-activate helpers (`createActive`, `create`), and about 15 inline `draftActivate` URLs.
- The MCP JSON-RPC plumbing exists twice.

**Recommendation:** add a `test/helpers.ts` with `users`, `startServer()`, `fakeBroker()`, `draft(service, entity)` and `mcpRpc()`.

#### T8 – Readability (Low)
- `let test` ([agent.test.ts:51](../test/agent.test.ts#L51)) and `const describe = …` (`:100`) shadow Jest globals.
- `void admin` (`tree.test.ts:194`) only silences an unused variable.
- `template.test.ts:55-61` uses `try { …; throw 'should have thrown' } catch` instead of `expect(...).toThrow(...)`.
- Some `it`s assert 8-12 unrelated things (`agent.test.ts:173-196`, `services.test.ts:259-311`). Use `it.each` tables, as `defaults.test.ts` already does well.

#### T9 – `noRole` is actually the admin user (Medium)
[test/help.test.ts:10](../test/help.test.ts#L10): `const noRole = { auth: { username: 'admin', password: 'admin' } }`. So the test "serves the sections to every logged-in user" never tests a user without roles. **Recommendation:** add a role-less mocked user under a `[test]` profile.

#### T18 – One test waits on real time (Low)
[session.test.ts:76-80](../test/session.test.ts#L76-L80) waits a real 200 ms for the ACK timeout. **Recommendation:** use fake timers (`doNotFake: ['setImmediate']`).

### 4.3 Coverage gaps

#### T10 – `subscription-hub.ts` has no tests and cannot be tested as written (High)
The 269-line module calls `SolaceSession.connect` directly ([subscription-hub.ts:91](../srv/lib/solace/subscription-hub.ts#L91)), which bypasses the `Connector` seam. Only the input validation is tested. Ownership checks, idle expiry, throttling, browse vs. consume, `stopAll`, and the websocket push have no tests.
**Recommendation:** inject a session factory (same pattern as `setConnector`), move `FakeSession` from `session.test.ts` into `test/fakes/solace.ts`, and unit-test the hub.

#### T11 – Pure modules are only tested through slow HTTP tests (Medium)
`node-validation.ts`, `test-case-spec.ts` (`scopeFor`, `buildSpec`), `preview.ts`, `broker-check.ts`, `copy-nodes.ts`, and the parse/validate part of `export-import.ts` have no direct unit tests. The BTP Destination Service path in `destinations.ts` is not tested at all (it would have caught B3). **Recommendation:** start with `node-validation`, `test-case-spec` and `broker-check`; they are cheap and fast to test.

### 4.4 Configuration and local tooling

- **T12 – The VS Code debug config does not load the TS handlers (Medium).** [.vscode/launch.json:9-13](../.vscode/launch.json#L9-L13) and `tasks.json` run plain `cds serve`, which does not execute `srv/*.ts`, so the debug session runs without custom logic. **Recommendation:** use `cds-tsx watch` / `npm run watch`. `settings.json` and `extensions.json` are leftover generator stubs (Prettier is recommended, but there is no Prettier config).
- **T13 – Local OAuth redirect allowed in every environment (Medium).** [mta.yaml:243](../mta.yaml#L243) allows `http://localhost:8765/**` as an XSUAA redirect in every space, production included. It is a deliberate convenience for MCP clients, but it should live in a dev `.mtaext`, or at least be documented as an accepted risk.
- **T14 – The HTML5 module blocks are maintained by hand (Low).** [mta.yaml:156-227](../mta.yaml#L156-L227) repeats an 8-line block for 8 apps, and lines 81-112 list the zip names again. `build-ui.js` discovers apps dynamically, but the MTA does not, so a new app has to be added in 3 places. **Recommendation:** add a test that every `app/*/ui5.yaml` has a matching MTA module and artifact.
- **T15 – `package.json` hygiene (Low).** It still has the placeholder `"repository": "<Add your repository here>"`, and there are no `lint` / `verify` scripts.
- **T16 – Local Solace setup (Low).**
  - [local/docker-compose.yml](../local/docker-compose.yml) uses the obsolete `version:` key and the unpinned `:latest` image.
  - It labels port `9000` "WebSocket", but 9000 is REST; Web Transport is `8008`, which the URL normalizer itself uses. Fix the comment and map 8008.
  - The `admin` password is hardcoded in 3 places, and `tg.ps1` overrides the `SOLACE_SEMP_*` env defaults from `root.hcl`, so they never take effect.
  - `tg.ps1` always passes `-it` (fails when non-interactive) and does not propagate `$LASTEXITCODE`.
- **T17 – Build script error handling (Low).** [scripts/build-ui.js:26-28](../scripts/build-ui.js#L26-L28) ignores `r.error`, and mixes `process.exit` with `throw`.

---

## 5. What is done well

- **Clear module boundaries in `srv/lib`.** The tree, validation, template, credentials and Solace code are separate and mostly free of side effects. `node-validation.ts` is deliberately shared between the UI service and the AI agent service.
- **Testable seams.** `setConnector`/`waitForRun` let the Jest suite run runs deterministically, with no broker, network or sleeps.
- **Security asserted by tests.** Tests check that passwords are never persisted or echoed, that agents cannot handle credentials (`allowDirectCredentials`), that the audit logs carry no payloads, and that role checks hold, in both unit and e2e tests.
- **Comments explain why.** Examples: the ACK window 1 in `session.ts`, why the parent is derived from `NextSibling` in `moveBefore`, why runs execute on `succeeded`, and the UI5 transpiler constraints.
- **Robust import.** It is all-or-nothing, reports every problem in one go with readable paths ("Orders / EU / created"), and has a dry run.
- **Good documentation.** `docs/technical-documentation.md` documents every `cds.aemSuite.*` option with its default, and `help.test.ts` checks that every in-app Help link points to an existing guide section.
- **Portable backend URLs in the UI** (relative `odata/` and `ws/`), and a careful live-view design in the subscriber (batched flush, backoff, context re-entry).

---

## 6. Suggested order of work

1. **Bugs:** B1 (orphaned runs), U1 (standalone URLs), U2 (run-dialog socket), U5 (`finally` destroy), B2, B3, U3, U4.
2. **Quality gates:** T1 + T2. This turns on linting for all TS and makes type errors fail. Do it before refactoring, so the refactors are checked.
3. **Test hygiene:** a `test/helpers.ts` (T5–T7), self-contained tests (T3, T4), and the T9 fix.
4. **Shared helpers:** backend `lib/errors.ts`, `lib/config.ts`, `lib/request.ts` (B6–B8, B10–B13); UI `_shared/` for Help, LiveSocket, `invokeAction`, `errorText` (U7–U10).
5. **Types:** adopt the cds-typer models (B17–B19), then migrate `testcases/webapp/ext` to TS (U16).
6. **Split large functions:** `executeRun`, `importNodes`, `openRunDialog`, the subscriber controller (B20, B21, U14, U15), together with the new unit tests (T10, T11).
7. **i18n** (U19).
