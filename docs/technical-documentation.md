# AEM Test Suite – Technical Documentation

Audience: developers who run, maintain, extend or deploy the application.
For end users see [user-guide.md](user-guide.md).

---

## 1. Purpose and scope

The AEM Test Suite is a SAP BTP application for functional testing of **SAP Integration Suite, Advanced Event Mesh** (Solace PubSub+) brokers:

- maintain **brokers** (message VPNs) and **test cases** (topic, JSON payload, message header, user properties) in a folder tree,
- **run** test cases against one or many brokers in parallel and keep the results,
- **subscribe live** to topics or queues and capture messages.

A test result passes when the broker **acknowledges** the message (guaranteed messaging), or when a direct message was sent without error. Payload assertions, round-trip checks and load tests are out of scope.

## 2. Technology stack

| Layer | Technology |
|---|---|
| Backend | SAP CAP **@sap/cds 10** (Node.js ≥ 22, **TypeScript**), `cds-tsx` for development, `tsc` via `cds build` for production |
| Persistence | SAP HANA Cloud (HDI) in production; SQLite in memory for development and tests |
| Broker access | `solclientjs` 10.x (Solace JS API, SMF over `ws(s)://` or `tcp(s)://`) |
| Live push | `@cap-js-community/websocket` (plain WebSocket, CAP service `LiveService`) |
| Destinations | `@sap-cloud-sdk/connectivity` 4.x |
| UI | SAPUI5 **1.148 (LTS)** from CDN: Fiori elements V4 (List Report / Object Page, tree table) and one freestyle UI5 app in TypeScript |
| UI tooling | `cds-plugin-ui5` (serves the apps inside `cds watch`), `@ui5/cli` 4, `ui5-tooling-transpile` |
| Security | XSUAA, standalone approuter (`@sap/approuter` 23) |
| Tests | Jest 30 + ts-jest, `@cap-js/cds-test`; Playwright (UI, e2e) |

## 3. Architecture

```
Browser ─ Fiori launchpad (sandbox) ─ approuter (XSUAA, websockets enabled)
                                          │
              ┌───────────────────────────┼────────────────────────────┐
              │ /odata/v4/admin           │ /odata/v4/test             │ /odata/v4/subscribe     /ws/live
              ▼                           ▼                            ▼                        ▼
        AdminService               TestService                   SubscribeService          LiveService (WS)
              │                           │                            │                        ▲
              │        srv/lib: test-runner ─ test-case-spec ─ template resolver                 │ runProgress
              │                 │                                      │ subscription-hub ───────┤ message
              │                 ▼                                      ▼                         │ subscriptionStatus
              │        solace/connector ──► solace/session (solclientjs) ──► AEM broker(s)
              │        credentials/resolve ──► BTP Destination service (DESTINATION brokers)
              ▼
        HANA Cloud (HDI container)
```

**Request flow of a run**

1. UI calls `runTest` / `runTests` with test case or folder IDs, broker IDs and per-broker credentials (password, plus username for brokers without one).
2. `createRun` validates the input, expands folders to test cases (tree order), and inserts `TestRuns` plus one `PENDING` `RunResults` row per message – test case × broker × repetition (advanced settings, section 7.6) – in the request transaction.
3. After commit (`req.on('succeeded')`) `executeRunInBackground` starts. Brokers are processed **in parallel**, the test cases of one broker **sequentially** over one session.
4. Each result row is updated in its own transaction (PASSED, FAILED, ERROR, or SKIPPED when the run was stopped) and a `runProgress` event goes to WebSocket context = run ID.
5. At the end the run gets status `DONE`, counters, and `TestCaseStats` (last result per test case) is upserted. If storing a result fails, or the run crashes, it ends `FAILED` instead and its open results get `ERROR` (`failRuns`); runs left `RUNNING` by a server restart are ended the same way on the next start.

## 4. Repository layout

```
app/
  launchpad/                  sandbox Fiori launchpad (all tiles; webapp/appconfig removes the SAP sample tiles)
  services.cds                imports all UI annotation files
  brokers/ variables/ numberranges/ runs/ messages/   Fiori elements apps (annotations.cds + webapp/)
  testcases/                  Fiori elements app with extensions (webapp/ext/*)
  subscriber/                 freestyle UI5 app in TypeScript
  help/ home/                 freestyle UI5 apps: the user guide, the start page
  _shared/                    UI modules all apps share (Apps, Actions, Help, LiveSocket, Navigation, MyEntriesFilter) -
                              the UI5 build and dev server add them to each app (scripts/ui5, nothing copied or committed)
  router/                     standalone approuter (xs-app.json: MCP, OAuth discovery, everything else from the HTML5 repo)
  <app>/xs-app.json           routes of each app in the HTML5 repo (odata/, ws/ -> destination srv-api)
db/
  schema.cds                  domain model (namespace aem.suite)
  data/                       code lists (deployed)
srv/
  admin-service.*, test-service.*, subscribe-service.*, live-service.cds   the UI services
  help-service.*, home-service.*   Help app and Home app (every logged-in user)
  agent-service.*             MCP service for AI assistants
  server.ts                   MCP OAuth discovery; dev only: app-relative odata/ws rewrite, no-cache header for UI files
  lib/                        business logic (see section 7)
  types/solclientjs.d.ts      typings for solclientjs (the package ships none)
test/
  *.test.ts                   Jest: unit, service and consistency tests (section 11)
  helpers.ts, fakes/          test server, fake broker connections, database reset
  data/                       demo data – loaded by cds watch / tests only, never deployed
e2e/                          Playwright tests of the UI apps (section 11)
docs/                         user guide (also shown by the Help app), this document, reviews (archive/ = old ones)
local/                        docker-compose for a local Solace broker, terragrunt for its VPN, users and queues
scripts/build-ui.js           ui5 build of all apps (each writes its HTML5 repo zip into dist/)
scripts/build-docs.js         copies docs/user-guide.md next to the built server (gen/srv/docs) for the Help app
scripts/ui5/                  UI5 build task + dev server middleware that give every app its app/_shared modules
scripts/set-version.js        one version in mta.yaml, every package.json and manifest
scripts/screenshots/          Playwright spec that takes the images in docs/images (npm run docs:screenshots)
mta.yaml, xs-security.json    deployment
.github/workflows/ci.yml      CI: npm run verify and the e2e tests on every push to main and every pull request
```

## 5. Domain model (`db/schema.cds`)

| Entity | Purpose | Notes |
|---|---|---|
| `Brokers` | Broker / message VPN | `credentialMode` DIRECT or DESTINATION; DIRECT keeps `url`, `msgVpn`, an optional `username` (if empty it is entered at run time) – **no password field**; `lastConnection*` holds the last connection test. Composition `variables` (broker variables). |
| `Variables` | Template variables | `broker` empty = global variable, set = broker variable. |
| `TestCases` | **Tree node**: folder or test case | `kind` FOLDER/TEST, `parent` (association) + `children` (recursive composition), `sortOrder` for manual ordering. Test case fields: `topic`, `payload`, `contentType`, `deliveryMode`, `timeToLiveMs`, `dmqEligible`, `priority`, `correlationId`, `ackTimeoutMs`. Compositions `userProperties`, `variables`. Association `lastResult` → `TestCaseStats`. |
| `TestCaseProperties` | SMF user properties | `type` STRING / INT / BOOL (empty = inferred on save). |
| `TestCaseVariables` | Variables of a test case **or a folder** | Folder variables apply to all descendants. |
| `TestCaseStats` | Outcome of the latest run per test case | Written by the runner; kept separate so runs do not change `modifiedAt` of test cases (an association, so drafts do not copy it). `TestService` deletes the stats of deleted test cases. |
| `TestRuns` | One execution | `summary` ("A, B → broker1"), `status` RUNNING/DONE/FAILED (FAILED = aborted), counters `totalCount`, `passedCount`, `failedCount`, `skippedCount`, the advanced settings `repetitions`, `repetitionOrder` (ROUND / EACH), `delayMs`, `stopOnFailure`. Composition `results`. |
| `RunResults` | One message: test case × broker × repetition | `status` PENDING/PASSED/FAILED/ERROR/SKIPPED, `iteration` (repetition), `sequence` (order within the broker), resolved topic/payload, correlation ID, ACK latency, error message. Name snapshots (`testCaseName`, `brokerName`) keep history readable. |
| `ReceivedMessages` | Messages saved from the live subscriber | Payload, user properties (JSON), source, delivery mode. |
| `NumberRanges` | Number ranges for `{{numberRange.<name>}}` | Name (`@assert.unique`; the service also refuses the same name in another case), prefix, suffix, digits, start, step, maximum, `current` (last number issued), `lastUsedAt`. |
| `SubscriberPresets` | Saved setups of the live subscriber, per user | Name (unique per user), broker, source type, topics (JSON array), queue, username. No password. |
| `CredentialModes`, `DeliveryModes`, `PropertyTypes` | Code lists for dropdowns | CSV in `db/data`. |

All enum types carry `@assert.range`, and so do the numeric limits `ackTimeoutMs` (100–120 000), `priority` (0–255) and `connectTimeoutMs` (1 000–120 000): CAP rejects other values on every OData write. Writes that bypass OData (AI agent, import, copy, test case from a message) are checked by `srv/lib/node-validation.ts`, which reads the same limits from the model (`srv/lib/model.ts`).

Result semantics:

| Status | Meaning |
|---|---|
| PASSED | PERSISTENT: broker ACK received within `ackTimeoutMs`. DIRECT: `send()` succeeded. |
| FAILED | Broker rejected the message, ACK timeout, send error, session dropped. |
| ERROR | The message could not be built or sent at all: unknown variable, invalid JSON, missing password, connection/login failure, destination problems. |
| SKIPPED | Not sent: the run was stopped, or an earlier message to the same broker failed with *stop on first failure*. Counted as done, not as failed. |

`TestCaseStats.status` is PASSED only if every broker of the latest run passed, otherwise FAILED (any FAILED) or ERROR.

## 6. Services and API

All OData V4. Paths are prefixed with the approuter URL in BTP.

### AdminService – `/odata/v4/admin` (role `Admin`)

| Element | Description |
|---|---|
| `Brokers` (draft) | Broker maintenance. Handlers: URL completion while editing and on save, validation, **automatic connection test on save for DESTINATION brokers** (max. 5 s). |
| `Brokers.testConnection(username, password)` | Opens/closes a session, stores the outcome. `password` is required for DIRECT brokers and never stored; `username` only if none is maintained on the broker. |
| `BrokerVariables` | Broker variables (composition of `Brokers`); the same name rules as test case variables (a name a template can reference, each once). |
| `GlobalVariables` (draft) | Projection on `Variables` without broker; names unique regardless of case (like number ranges and subscriber setups, `srv/lib/unique-name.ts`). |
| `NumberRanges` (draft) | Virtual `lastNumber` / `nextNumber` (formatted). Bound action `reset(nextNumber)`. `current` and `lastUsedAt` are never taken from a draft (activation ignores them), so a draft that was open meanwhile cannot set the counter back. |
| `Destinations` | Read-only value help (`@cds.persistence.skip`) – destinations from the bound destination service and from env `destinations`, filtered to broker URLs. |
| `CredentialModes` | Code list. |

### TestService – `/odata/v4/test` (role `Tester`)

| Element | Description |
|---|---|
| `TestCases` (draft, **hierarchy**) | Folder/test case tree. Computed columns `LimitedDescendantCount`, `DistanceFromRoot`, `DrillState`, `LimitedRank` and `@Aggregation.RecursiveHierarchy #TestTree` / `@Hierarchy.RecursiveHierarchy #TestTree` enable CAP hierarchy queries for the Fiori tree table. `kindText` is a display text for `kind`. |
| `TestCases.runTest(brokerIds, credentials, options)` | Runs one node (a folder runs its subtree). `options`: the advanced settings (section 7.6). |
| `TestCases.preview(brokerId)` | Resolves topic, payload, correlation ID and properties without sending. Works on drafts. |
| `TestCases.duplicate()` | Copies a test case or a folder with everything below it (`srv/lib/copy-nodes.ts`); the copy is named "… (Copy)" and placed right after the original. |
| `exportNodes(ids)` | Returns `{ filename, content, folders, testCases }`: the JSON file for the given nodes (folders with everything below them; without ids the whole tree). The browser saves `content` as a file. |
| `importNodes(content, parentId, dryRun)` | Creates the nodes of an export file below `parentId` (empty = top level) as **new** nodes; with `dryRun` it only checks and counts. All or nothing, see "Export and import file" below. The service accepts request bodies up to 5 MB (`@cds.server.body_parser.limit`). |
| `copyNodes(ids)` | Same for several nodes; a node below another selected node is copied with that node only. Returns `{ ID, name }` per copy. Used by the *Copy* buttons. |
| `TestCases.moveBefore(NextSibling)` | `ChangeNextSiblingAction` of the tree table (drag & drop ordering). |
| `runTests(testCaseIds, brokerIds, credentials, options)` | Runs several nodes against several brokers in one run. |
| `cancelRun(runId)` | Stops a running run: messages not sent yet are SKIPPED. For the user who started it and administrators; only on the instance that executes the run. |
| `currentUser()` | Logged-in user ID – used to prefill the "Created by" / "Started by" filters. |
| `Brokers` | Active brokers (read-only projection incl. `credentialMode`, `username`). |
| `TestRuns`, `RunResults` | Read-only, with `outcome` (PASSED/FAILED/RUNNING) and criticality fields. |
| `TestCaseStats` | Read-only, with criticality. |
| `DeliveryModes`, `PropertyTypes` | Code lists. |

`credentials` is `many { brokerId, username, password }`. `createRun` rejects the call with 400 if a DIRECT broker has no password, or no username (neither maintained on the broker nor passed in `credentials`).

### SubscribeService – `/odata/v4/subscribe` (role `Tester`)

| Element | Description |
|---|---|
| `start(brokerId, sourceType, topics, queue, password, username)` | Opens a dedicated session. `sourceType`: `TOPIC` (direct subscriptions, wildcards), `QUEUE_BROWSE` (messages stay), `QUEUE_CONSUME` (client ack, messages removed). Returns `subscriptionId`. |
| `stop(subscriptionId)` | Closes the subscription (owner only). |
| `heartbeat(subscriptionId)` | **Heartbeat** of the page that started the subscription: keeps this one subscription alive; `active = false` if it ended on the server. |
| `activeSubscriptions()` | Own subscriptions (read only). |
| `SubscriberPresets` | The user's saved subscriber setups. `@restrict` to `createdBy = $user` (a user sees and changes only their own); a `before` handler checks the name (required, unique per user), source type and the topic list. |
| `ReceivedMessages` | Saved messages (no update). Testers read all and delete only their own, administrators delete any. Action `createTestCase()` creates a test case from a message (pretty-printed JSON payload, property types inferred). |
| `Brokers` | Active brokers (incl. `credentialMode`, `username`). |

### LiveService – WebSocket `/ws/live` (role `Tester`)

Clients enter a **context** to receive only their events:

```json
{"event":"wsContext","data":{"context":"<runId or subscriptionId>"}}
```

| Event | Context | Payload |
|---|---|---|
| `runProgress` | run ID | `status` RUNNING/DONE, `total`, `done`, `passed`, `failed`, `skipped`, `resultId` |
| `message` | subscription ID | topic, payload, contentType, userProperties (JSON), correlationId, deliveryMode, receivedAt, seq |
| `subscriptionStatus` | subscription ID | `STOPPED`, `DOWN`, `THROTTLED`, `RESUMED` + message |

### HelpService – `/odata/v4/help` (every logged-in user)

Serves the user guide for the **Help app**. `docs/user-guide.md` stays the only source: `srv/lib/help-content.ts` reads it on the server, renders it with `markdown-it` and cuts it into sections, so the browser gets finished HTML and needs no Markdown library.

| Element | Description |
|---|---|
| `Sections` (read only, no database) | one row per `## ` heading: `id` (anchor), `number`, `title`, `html`, `text` (plain text for the search), `headings` (JSON list of the `###` / `####` headings with their anchors) |

Rules of the rendering (so write the guide accordingly):

- Section 1 "Overview" is everything before the first `## ` (title and introduction). A section called "Contents" is skipped, the Help app has its own navigation.
- **Anchors are the same as on GitHub** (`## 8. Watch messages live (Live Subscriber)` → `8-watch-messages-live-live-subscriber`, repeated headings get `-1`, `-2`), so the `[…](#anchor)` links of the guide's table of contents work in the Help app. `###` headings become the sub items of the navigation.
- **Raw HTML in the Markdown is not passed through** (it is shown as text); links to other sites open in a new tab; wide tables scroll inside the page.
- The file is re-rendered when its modification time changes, so edits show up while developing. `cds.aemSuite.help.file` overrides the location (relative to the project root). Deployed, `scripts/build-docs.js` copies the guide to `gen/srv/docs/` (MTA build step, after `cds build`) - a system without the file answers 404 "The user guide is not available".
- `@requires: 'authenticated-user'`: help is not tied to a role.

**Help app** (`app/help`, `com.aem.suite.help`, tile "AEM Suite – Help"): freestyle UI5 app with a `sap.tnt.SideNavigation` (sections with their `###` headings, search field that filters sections and **highlights** hits), the section as `sap.ui.core.HTML`, and previous / next buttons. The address after the app's own part is a heading anchor: `#AEMSuiteHelp-display&/6-run-tests` opens that section, `…&/export-and-import` the section containing that sub heading and scrolls to it. Links inside the text that point to a heading stay in the app.

**Help buttons.** Every Fiori elements page has a *Help* action in its header (`content.header.actions.help` in the manifests, handler `shared/Help.js`), the Live Subscriber has a *Help* button, and the Run dialog a help link. They open the matching section **in a new browser tab** (`window.open`, so a draft being edited is not lost): inside the launchpad `<launchpad address>#AEMSuiteHelp-display&/<anchor>`, standalone the sibling app `…/comaemsuitehelp/index.html#/<anchor>` (`shared/Navigation.js`). The sections per app are listed once in `SECTIONS` of `app/_shared/Help.js`; `test/help.test.ts` checks that every one of them is an existing heading of the guide, so renaming a heading cannot silently break a Help button.

### HomeService – `/odata/v4/home` (every logged-in user)

One function for the **Home app**: `overview()` returns who is logged in, whether they are tester / admin, and the figures of the start page – number of test cases and folders, runs and results of the last 7 days (pass rate), the 5 latest runs (with the same `outcome` as the Test Runs app), the active brokers by their last connection test (with the names of the failing ones), saved messages and the user's live subscriptions. The figures are only filled for users with role `Tester`; for everyone else the function returns just the user and the role flags, so the page shows only the Help card and a note to ask for a role.

**Home app** (`app/home`, `com.aem.suite.home`, tile "AEM Suite – Home"): freestyle UI5 start page, kept calm on purpose – every fact appears once:
- header with greeting and shortcuts;
- **Needs attention**, only when something is wrong (failed results of the last 7 days, brokers whose last connection test failed, no broker / no test case yet, no role); otherwise one green "All good" line;
- one compact tile per app the user may open (admin apps only for admins): icon, title and one short line from `overview()`;
- the 3 latest runs, one line each.

All texts are in `i18n/i18n.properties`; the layout uses CSS grid and SAP theming parameters only, so it works in light and dark themes and on phones. While a run is in progress the page reloads every 10 s. It navigates with `shared/Navigation.js`, like the other apps.

### Export and import file (`srv/lib/export-import.ts`)

```json
{ "format": "aem-suite.test-cases", "version": 1, "exportedAt": "2026-10-15T09:39:25.031Z",
  "nodes": [ { "kind": "FOLDER", "name": "...", "description": "...", "variables": [{ "name": "...", "value": "..." }],
               "children": [ { "kind": "TEST", "name": "...", "topic": "...", "payload": "...", "contentType": "...",
                               "deliveryMode": "...", "timeToLiveMs": 0, "dmqEligible": false, "priority": 0,
                               "correlationId": "...", "ackTimeoutMs": 0,
                               "userProperties": [{ "name": "...", "type": "...", "value": "..." }], "variables": [] } ] } ] }
```

- **Export** is a nested tree without IDs, authors, sort order or run data (the order of the arrays is the order in the tree: folders first, then manual order; variables and properties are sorted by name, empty fields are left out). A folder comes with everything below it; nodes below another selected node are exported once.
- **Import** reads the same format but is lenient: `kind` may be left out (`children` = folder), `payload` may be a JSON value (it is stored as pretty-printed text), property / variable values may be numbers or booleans. `format` must match and `version` must not be newer than the system's. Limits: 5 000 nodes, 20 levels.
- **All or nothing, one pass.** First every node is type-checked (wrong types, children on a test case, ...), then the same rules as the UI are applied via `srv/lib/node-validation.ts` (`validateEnums`, `validateNode`, `validateParent`, including text lengths because the import writes to the database directly). All problems are collected with their position (`Orders / EU / Order created: payload: ...`) and the request is rejected with the first 20 of them. Only a file without problems is written.
- **Write.** New IDs are generated; nodes are inserted level by level (parents first) in one transaction behind the existing nodes of the target folder. Existing nodes are never changed, so importing a file twice creates two copies.

### TestAgentService – MCP `/mcp/agent` (role `Tester`)

Lets an AI assistant **plan, check and run tests** over the **Model Context Protocol**. Served by the CAP plugin [`@cap-js/mcp`](https://cap.cloud.sap/docs/guides/ai/cap-mcp) (`@protocol: 'mcp'`: MCP only, no OData for this service; stateless streamable HTTP, JSON-RPC over `POST /mcp/agent`). It is a **use-case service** (`srv/agent-service.cds`, handlers in `srv/agent-service.ts`) and not an annotation on the existing services: read-only views without draft / hierarchy columns, no admin data, no secrets.

The plugin turns the service into three generic tools (names are prefixed, `cds.mcp.prefix: true`):

| Tool | What it does here |
|---|---|
| `TestAgentService-describe` | lists entities and actions with their elements / parameters |
| `TestAgentService-query` | read-only CQL `SELECT` on the entities below (paging limits of CAP apply) |
| `TestAgentService-call` | calls one of the unbound actions / functions below |

| Entity (read only) | Content |
|---|---|
| `TestNodes` | test cases and folders (`kind`, `parent`, topic, payload, headers, `lastResult`, ...), with `userProperties` and `variables` |
| `TestNodeProperties`, `TestNodeVariables`, `TestNodeLastResults` | the same as separate entities |
| `Brokers` | broker data without credentials; `needsCredentials` = true for direct brokers |
| `TestRuns`, `RunResults` | runs (with `skippedCount` and the advanced settings) and one result per message (`iteration`, `sequence`, resolved topic / payload, ACK latency, error) |

| Action / function | Purpose |
|---|---|
| `createFolder`, `createTestCase` | create nodes (new nodes go to the end; same defaults as the UI: starter payload, correlation ID `{{uuid}}`) |
| `updateTestCase`, `updateFolder` | change given fields only; `userProperties` / `variables`, if given, replace the existing ones |
| `moveNode`, `copyNodes` | reorganize; `copyNodes` copies folders with everything below them |
| `exportNodes(ids)`, `importNodes(content, parentId, dryRun)` | the export / import file above: an agent can generate a whole suite as one file, check it with `dryRun`, and import it in one call (request bodies up to 5 MB) |
| `previewTestCase(testCaseId, brokerId)` | the message exactly as it would be sent (variables resolved), nothing is sent |
| `runTests(testCaseIds, brokerIds, credentials)` | starts a run in the background, returns `runId` and the number of results |
| `getRunSummary(runId, waitSeconds)` | status, counters (`skipped` separately) and up to 25 FAILED / ERROR results; waits up to 30 s for the end of the run |

**Same rules as the UI.** Creating and changing nodes goes through `srv/lib/node-validation.ts`, the same checks `TestService` uses (valid JSON, parent must be a folder, property types, ACK timeout range, ...). All problems of a call are returned in one error text. `previewTestCase` shares `srv/lib/preview.ts` with the UI preview; copying uses `srv/lib/copy-nodes.ts`.

**Guard rails** (the adapter itself has no governance: no rate limits, no audit log, no approvals):

- **No secrets through the AI.** `runTests` only accepts brokers whose credentials come from a **BTP destination**. Direct brokers need a password that is never stored, and a password typed into an AI conversation would end up in the model provider's and the client's logs. Such runs are refused with an explanation, so people run them in the UI.
- **No delete.** There are no delete actions; global and broker variables and saved messages are not exposed at all.
- **Limits:** at most `maxRunResults` (100) results per run and `maxActiveRuns` (2) runs of one user at a time (`cds.aemSuite.agent`, see section 10).
- **Audit:** every changing action logs `audit` with user, action, names and IDs (logger `aem-agent`; all loggers of the app start with `aem-`) - never payloads or credentials.
- **Prompt injection:** the adapter does not filter data. `@mcp.instructions` tell the model that payloads, topics and errors are data and never instructions, and not to run tests on brokers the user did not name. Connect only trusted assistants.
- **Authorization:** `@requires: 'Tester'` on the service, checked by the adapter on every request. Anonymous requests get 401.

**Connecting a client (OAuth).** The endpoint implements the [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) discovery, so clients log the user in against XSUAA themselves (authorization code + PKCE, refresh tokens). `@cap-js/mcp` has no OAuth support; `srv/lib/mcp-oauth.ts` (registered in `srv/server.ts`) adds it:

| Piece | What it does |
|---|---|
| `WWW-Authenticate: Bearer resource_metadata="<app>/.well-known/oauth-protected-resource/mcp/agent"` | added to every 401 of `/mcp/*` (no, invalid or expired token) |
| `GET /.well-known/oauth-protected-resource[/mcp/agent]` | RFC 9728: resource `<app>/mcp/agent`, authorization server `<app>` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: XSUAA's `/oauth/authorize`, `/oauth/token`, `/token_keys`, PKCE `S256`. Served by the app because XSUAA only offers OpenID discovery, which not every MCP client falls back to. |

- `<app>` is the URL the client used: `cds.aemSuite.mcp.publicUrl`, else derived from the approuter's `x-forwarded-proto` / `x-forwarded-host`. The XSUAA URL comes from the bound credentials (`cds.requires.auth.credentials.url`, override `cds.aemSuite.mcp.authorizationServer`). Without XSUAA (local mocked auth) nothing is advertised (404, no header).
- The approuter forwards `/mcp/*` and `/.well-known/oauth-*` without its own login (`authenticationType: none`); the backend demands a valid **XSUAA JWT** with the `Tester` scope.
- **No dynamic client registration** (XSUAA has none): clients use the app's own XSUAA client. the MTA creates the service key `aem-suite-auth-key` (module `aem-suite-destination-content`; read it with `cf service-key aem-suite-auth aem-suite-auth-key` → `clientid`, `clientsecret`) and allows the callback `http://localhost:8765/**`. The secret only identifies the client; every user still logs in personally and gets their own roles. If one shared secret is not acceptable, put SAP Cloud Identity Services (public client with PKCE) in front instead.
- Locally: URL `http://localhost:4004/mcp/agent` with HTTP Basic (`tester:tester`).

`cds.mcp.autowire` is **off**: the plugin would otherwise write mock logins into `~/.claude.json` and the OpenCode config whenever `cds watch` starts.

**Requirements and tests.** The plugin loads an ES-module-only package, so Node.js must be **22.12 or newer** (`require` of ES modules). Jest cannot do that; `jest.config.js` maps `@toon-format/toon` to a tiny JSON stand-in (`test/shims/toon.js`) that only formats tool results. `test/agent.test.ts` talks real MCP JSON-RPC to the running test server.

## 7. Backend modules (`srv/lib`)

### 7.1 `solace/session.ts` – broker session

- `SolaceSession.connect(config)` wraps `solclientjs` in promises (UP_NOTICE / CONNECT_FAILED_ERROR, guard timeout). `connectRetries` and `reconnectRetries` are 0 – failures surface immediately.
- `publish(spec)` builds the message (`buildMessage`): binary attachment (UTF-8), HTTP content type, delivery mode, TTL, DMQ eligibility, priority, correlation ID, user properties as `SDTMapContainer` (STRING / INT64 / BOOL).
  - PERSISTENT: resolves on `ACKNOWLEDGED_MESSAGE` with matching correlation key, rejects on `REJECTED_MESSAGE_ERROR` or after `ackTimeoutMs`.
  - DIRECT: resolves after `send()`.
  - **Publisher `windowSize: 1`**: otherwise the broker batches ACKs and the measured latency includes its ~1 s ACK timer.
- `subscribe(topic)`, `createQueueConsumer(queue)` (client ack), `createQueueBrowser(queue)`, `readMessage(msg)`.
- `onUnexpectedClose` notifies the subscription hub when the broker drops a session.

### 7.2 `solace/connector.ts`

Single place that opens publishing connections (`connect(conn)`). Tests replace it with `setPublisherFactory()` / `setConnector()` – runs and connection tests then work without a broker.

### 7.3 `credentials/resolve.ts` and `credentials/destinations.ts`

- `resolveConnection(broker, jwt, password, username)` → `{ url, vpnName, userName, password, clientName, connectTimeoutMs }`.
  - **DIRECT**: URL/VPN from the broker, **password from the current request** (`MissingPasswordError` if absent). The username is the maintained one; only if the broker has none, the one from the request is used (`MissingUsernameError` if neither). `needsUsername(broker)` tells the UIs whether to ask.
  - **DESTINATION**: `getDestination({ destinationName, jwt })`. Expected destination: type HTTP, URL `wss://host:443` (`https://` is mapped to `wss://`), user/password, additional property **`msgVpn`** (required), optional `smfUrl` (e.g. `tcps://host:55443`).
- `toSmfUrl()` maps `http(s)` → `ws(s)` and rejects other schemes.
- `listDestinations()` merges the bound destination service (`getAllDestinationsFromDestinationService`) and env `destinations` (local).

**Password handling:** passwords are never persisted, logged or returned. They travel in the action request (HTTPS via approuter), live in a `Map` for the duration of a run (cleared in `finally`) or only until a subscription session is established. The UI clears its fields after use and destroys the OData operation bindings.

### 7.4 `template/resolve.ts` – template engine

Syntax `{{name}}` or `{{fn(args)}}`. Lookup order (first match wins):

1. test case variables
2. broker variables
3. folder variables (inner folder before outer)
4. global variables
5. built-ins

| Built-in | Value |
|---|---|
| `uuid` | one UUID per message (identical in topic, payload, correlation ID) |
| `newUuid` | new UUID per occurrence |
| `now`, `timestamp`, `date` | ISO timestamp, epoch ms, `YYYY-MM-DD` (stable per message) |
| `randomInt(min,max)` | inclusive random integer |
| `broker.id`, `broker.name`, `broker.msgVpn` | target broker |

Variables may reference other variables (depth 5, cycle detection). Unknown names raise `TemplateError` listing all of them → result `ERROR`. After resolution the payload is validated as JSON when the content type is JSON.

**Number ranges.** `{{numberRange.NAME}}` and `{{numberRange.NAME as alias}}` (temporary variable `{{alias}}`, also usable before its definition) are not computed by the resolver: it is synchronous and only inserts `scope.generated`. The numbers are handed out beforehand, once per message:

1. `generatedSlots(templates, scope)` lists what the message needs: one slot per plain range name (the same number everywhere in the message) and one per alias, also in variables the templates use. Unused variables are not followed, so they never use up numbers.
2. `withGenerated(tc, scope, mode)` in `test-case-spec.ts` calls `allocateNumbers(slots, mode)` from `number-ranges.ts` and puts the result into the scope.
3. `consume` (runs) takes the numbers with a compare-and-set `UPDATE` of `NumberRanges.current` in a transaction of its own that commits at once, retried a few times, so parallel runs never get the same number and a number is not reissued if the message fails later. `peek` (Preview, MCP preview) only computes the next numbers.
4. An exhausted range (`maximum` or digits exceeded) or an unknown range is a `TemplateError`, so the result is `ERROR` and `current` does not move.

**Faker.** `{{faker.<module>.<method>[(args)]}}` (`fake-data.ts`, [`@faker-js/faker`](https://fakerjs.dev), v9 because it ships CommonJS, which Jest needs) uses the same mechanism as number ranges: `generatedSlots` lists the expressions (one slot per distinct expression, one per `as` alias), `withGenerated` calls `generateFake` for them (also in `peek` mode) and the resolver inserts the values. Safety: only the data modules in `MODULES` are reachable (not `helpers`, `seed`, `constructor`, ...), the method must be a function of that module, and the arguments are parsed as numbers, booleans or text - a template cannot run code. `number.int/float`, `finance.amount` take (min,max), `date.between` (from,to). Dates are written as ISO text. The language is `cds.aemSuite.faker.locale`; an unknown locale falls back to English. `test/fake-data.test.ts` pins the refusals.

### 7.5 `test-case-spec.ts`

Loads test cases with properties and variables, builds the variable scopes (`loadVariableScopes`: global, per broker, per folder + the tree), computes the folder chain of a node (`scopeFor`) and turns a test case into a `PublishSpec` (`buildSpec`): rejects empty topics and wildcards, applies content-type detection and property-type inference as fallbacks.

### 7.6 `test-runner.ts`

`createRun` → validation (brokers exist and are active, passwords for DIRECT brokers, at least one test case after folder expansion), `summary`, pending rows. `executeRunInBackground` → see section 3. `waitForRun(runId)` exists for tests.


**Advanced settings** (`RunOptions` of `runTests` / `runTest`, saved on the `TestRuns` row): `repetitions` (1 - `runs.maxRepetitions`), `delayMs` (0 - `runs.maxDelayMs`), `order` (`ROUND`: the selection N times; `EACH`: every test case N times in a row) and `stopOnFailure`. `createRun` checks them (`normalizeOptions`) and the total (test cases x brokers x repetitions <= `runs.maxResults`), and creates one PENDING `RunResults` row per message with `iteration` and `sequence` (the order within a broker). `runBroker` sends a broker's rows in `sequence` order, waits `delayMs` between two messages (`pause`, interrupted when the run is stopped) and - after a failed message with `stopOnFailure`, or when the run was stopped - marks the rest `SKIPPED` (`RunProgress.skip`: counted as done, in `TestRuns.skippedCount`, not as failed; skipped results do not touch `TestCaseStats`). `cancelRun` (service action `cancelRun(runId)`) puts the run into an in-memory set that the loops check, so it only works on the instance that executes the run; allowed for the user who started the run and for administrators.

### 7.7 `tree.ts`

In-memory tree over `TestCases` (`ID`, `parent_ID`, `kind`, `name`, `sortOrder`): `ancestors`, `isWithin` (cycle check), `expandToTests` (folders → test cases in tree order), `compareSiblings` (folders first, then `sortOrder`, then name).

### 7.8 `solace/subscription-hub.ts`

In-memory registry of live subscriptions (one session each). Limits (configurable, section 10): 5 per user, 100 forwarded messages/s per subscription (excess is counted but not forwarded; THROTTLED/RESUMED events), payloads > 512 KB truncated in the live view. A sweeper closes subscriptions without heartbeat for 5 minutes (the page that started a subscription calls `heartbeat` for it every 60 s; another open tab does not keep it alive) – messages do not count as activity, so subscriptions of closed browser tabs end. All subscriptions are closed on server shutdown.

> **Single instance:** the hub state lives in one Node.js process. `mta.yaml` pins the backend to `instances: 1`. Scaling out needs sticky sessions plus a shared registry (e.g. Redis), and the websocket plugin's Redis adapter.

### 7.9 `defaults.ts`

- `normalizeBrokerUrl`: host only → `wss://host:443`; ports 55443 → `tcps`, 55555/55003 → `tcp`, 8008/80 → `ws`, 443/8443 → `wss`; strips paths.
- `detectContentType`: `{`/`[` → `application/json`, else `text/plain`.
- `inferPropertyType`: integer → INT, true/false → BOOL, else STRING.
- `STARTER_PAYLOAD`, `STARTER_CORRELATION_ID` for new test cases.

### 7.10 Service handlers – notable rules

- **TestService**
  - `NEW` (draft): starter payload and correlation ID `{{uuid}}` for test cases (not folders).
  - Draft `UPDATE`: the name follows the topic until the user sets an own name.
  - `CREATE`/`UPDATE`: parent must be a folder and not inside the node (cycle), new nodes get `sortOrder = max + 10`; folders need a name, test cases a topic; JSON validation of payloads (placeholders replaced by `0`), property/variable validation.
  - `moveBefore`: Fiori sends the parent change (PATCH) and this action in the **same change set, processed concurrently**. The target parent is therefore taken from `NextSibling`; "move to end" (`NextSibling = null`) assigns a global maximum `sortOrder`. Reordering keeps `modifiedAt/By`.
- **AdminService**: URL completion, field validation, destination connection test on save, `Destinations` value help.

## 8. Frontend

### 8.1 Apps

| App (`app/…`) | Type | Highlights |
|---|---|---|
| `testcases` | Fiori elements LR/OP | **Tree table** (`hierarchyQualifier: TestTree`, create menu Folder/Test Case, drag & drop, Cut/Paste, Move Up/Down); custom sections `MessageSection` (full-width topic + name) and `PayloadSection` (`sap.ui.codeeditor` JSON editor, validation, format, template help); custom actions *Run…*, *Copy*, *Export*, *Import* and *Preview*. |
| `runs` | Fiori elements LR/OP | List on `RunResults` (one row per test case × broker, filters for test case, broker, status, started by/at); link columns to the test case, broker and run (`testCaseLink`, `brokerLink`, `runLink` in `TestService.RunResults` are launchpad intents). Run page (`TestRuns`) with totals and its results. |
| `subscriber` | Freestyle UI5, **TypeScript** | Live subscriptions over WebSocket, message list (batched, max. 500), detail panel, save / save as test case. Besides the controller: `util/SubscriptionSession.ts` (start, stop, heartbeat), `util/MessageBuffer.ts` (buffer, flush, search filter), `util/TopicList.ts` (the topic list of the form, unit-tested in `test/topic-list.test.ts`). |
| `messages` | Fiori elements | Saved messages, *Create Test Case*. |
| `brokers`, `variables`, `numberranges` | Fiori elements | Admin apps. |
| `help` | Freestyle UI5 | The user guide from `docs/user-guide.md`, see HelpService in section 6. |
| `home` | Freestyle UI5 | Start page: figures, the apps of the user's roles, latest runs – see HomeService in section 6. |

### 8.2 Test case app extensions (`app/testcases/webapp/ext`)

| File | Role |
|---|---|
| `TestCaseActions.js` | The handlers of the custom actions in the manifest: *Run…*, *Copy*, *Export*, *Import* (list and object page) and the *Preview* dialog. |
| `RunDialog.js` | The Run dialog: broker selection, password fields for DIRECT brokers, advanced settings, live progress via WebSocket (plus a poll), problem list, *Stop run*. |
| `FileIO.js` | Export / import as a JSON file: save and pick the file in the browser, dry run, confirmation, import. |
| `RunDialog.fragment.xml`, `PreviewDialog.fragment.xml` | Dialogs. |
| `TypeColumn.fragment.xml` | Custom "Type" column of the tree table: a small folder / test case icon (name as tooltip) instead of the type text. Defined under `columns` in the manifest, so `kind` is not part of the `@UI.LineItem`. |
| `MessageSection.*`, `PayloadSection.*`, `JsonTemplate.js` | Custom sections; JSON handling that tolerates `{{…}}` outside strings. |
| `ObjectPageExt.controller.js` | Hides test-case-only parts for folders (manifest `visible` expressions are evaluated before data is loaded). |
| `TreeRules.js` | Tree hooks: create and drop only in folders/root. Preloaded in `Component.js` because FE resolves hooks synchronously. |
| `Prefs.js` | Browser-local preferences (last brokers, run settings). |

### 8.2a Shared UI modules (`app/_shared`)

`Apps.js` (the app catalog: key, launchpad intent, icon and required role of every app – `test/launchpad.test.ts` compares it with the launchpad tiles and the manifests), `Actions.js` (error text, `invokeAction` that destroys the operation binding afterwards), `Help.js` (Help buttons, section per app), `LiveSocket.js` (WebSocket client with reconnect, used by the Run dialog and the Live Subscriber), `Navigation.js` (to another app by its key, inside or outside the launchpad) and `MyEntriesFilter.controller.js` (prefills the "Created by" / "Started by" filter once per app start with `currentUser()`; test cases and runs). TypeScript apps get `.d.ts` files too.

Each HTML5 app is deployed on its own, so every app needs the modules it uses under its own namespace (`com/aem/suite/<app>/shared/...`). Nothing is copied into the apps: every `ui5.yaml` has the build task `aem-shared-ui-task` (adds the modules to the build result before the Component-preload is bundled, so they are in the preload and the HTML5 repo zip) and the middleware `aem-shared-ui-middleware` (serves `.../shared/<module>.js` from `app/_shared`, also in `cds watch` through cds-plugin-ui5), both in `scripts/ui5/`. The modules an app gets are the ones its files name (`.../shared/Help`, `com.aem.suite.<app>.shared.Help` in a manifest) plus what those load (`./Navigation`). The TypeScript app imports them as `com/aem/suite/subscriber/shared/...`, which its `tsconfig.json` maps to `app/_shared` (the `.d.ts` files there). `app/*/webapp/shared/` is git-ignored; `test/shared-ui.test.ts` checks the wiring.

### 8.3 Conventions and pitfalls

- **Where annotations go:** field titles and tooltips (`@title`, `@Common.QuickInfo`) on the entities in `db/schema.cds` (end of the file) - CAP passes them on to every projection, so all apps and the agent see the same words; timestamps are worded "<what> At". Titles of elements a service adds (e.g. `outcome`, `runStartedAt`, `nextNumber`) next to them in `srv/*.cds`. Service semantics (`@readonly`, `@Core.Immutable`, `@Capabilities…`, `@assert…`, `@restrict`) in `srv/*.cds` or `db/schema.cds`. UI only (layout, `@UI…`, value lists, side effects, action parameter labels) in `app/<app>/annotations.cds`; layout several apps share (the variables lists) in `app/common.cds`.
- **Never put `{` `}` into annotation texts** (labels, QuickInfo): Fiori elements interprets them as bindings and sends broken requests. In XML escape as `\{`, in JS controls set texts via setters, not constructor settings.
- UI5 TypeScript classes: **no getters** in controllers (`ui5-tooling-transpile` converts the class to `Controller.extend({...})` and evaluates getters at definition time).
- Models in `onInit` of a root view: use `getOwnerComponent().getModel()`.
- All apps pin `https://ui5.sap.com/1.148.12`. The version is repeated in every `index.html`, every manifest (`minUI5Version`) and the `@sapui5/types` packages; `test/ui5-version.test.ts` fails unless they agree with `@sapui5/types` in the root `package.json`.

### 8.4 Launchpad

`app/launchpad/webapp/index.html` uses the ushell **sandbox** (`sap-ushell-config.applications` creates the tiles/intents). `webapp/appconfig/fioriSandboxConfig.json` empties the sandbox's sample groups. The sandbox always reads it from the host root (`/appconfig/...`), so the standalone approuter routes `/appconfig/*` into the launchpad app in the HTML5 repo, and the dev server rewrites it the same way. It is an HTML5 app itself (`comaemsuitelaunchpad`, the standalone approuter's welcome page), because an approuter bound to the HTML5 repo cannot also serve local files. For a central launchpad use SAP Build Work Zone (section 12); the sandbox launchpad has no `crossNavigation` inbounds, so it does not show up there.

**URLs.** In the HTML5 repo an app lives at `/<app name>/` (`sap.app.id` without dots, e.g. `/comaemsuitebrokers/`); Work Zone adds a prefix (`/<sap.cloud.service>.<app name>-<version>/`). The apps therefore call the backend **relative to themselves**: `odata/v4/...` in the manifests, `ws/live` via `sap.ui.require.toUrl(...)` in the shared `LiveSocket` client. Each app's `xs-app.json` routes `odata/` (and `ws/`, websockets enabled) to the destination `srv-api`. Locally `cds-plugin-ui5` mounts the apps at the same names (`mountPath` in `ui5.yaml`), and `srv/server.ts` strips the `/comaemsuite<app>/` prefix from `odata/` and `ws/` requests (development only).

## 9. Security

- **Scopes / role templates** (`xs-security.json`): `Admin` (contains `Tester`), `Tester`. Role collections `AEM_Suite_Admin`, `AEM_Suite_Tester`.
- `AdminService` (brokers, global variables, number ranges) requires `Admin`; `TestService`, `SubscribeService`, `LiveService` and the MCP service `TestAgentService` require `Tester`; `HelpService` and `HomeService` only a login (`authenticated-user`), so everyone sees the guide and the start page.
- Saved messages: every tester reads them all and can make a test case of any, but deletes only their own (administrators any); nobody changes one. Subscriber setups are private to their user.
- Standalone approuter (`app/router/xs-app.json`): `/mcp/*` and `/.well-known/oauth-*` passed through (the backend checks the bearer token and serves the OAuth discovery), everything else from the HTML5 repo (`html5-apps-repo-rt`, `xsuaa`). The apps' own `xs-app.json` (also used by the Work Zone managed approuter): `odata/*` with CSRF, `ws/*` with websockets enabled, static files no-cache, all routes `xsuaa`.
- Data visibility: all testers share test cases, runs and saved messages (team workspace); the "my entries" filter is a UI default, not an authorization. Subscriptions can only be stopped by their owner.
- Broker passwords: see 7.3. Destination credentials stay in the BTP destination service.
- **XSUAA redirect URIs** (`mta.yaml`, `oauth2-configuration.redirect-uris`): `https://*.${default-domain}/**` and `http://localhost:8765/**` in every environment. The localhost entry is the callback of local MCP clients (section 6, "Connecting a client"). Both are deliberate today and listed as an open decision in [maintenance-review.md](maintenance-review.md) (D1).
- **Role collection names** are fixed (`AEM_Suite_Admin`, `AEM_Suite_Tester` in `xs-security.json`). Role collection names are unique per subaccount, so a second deployment (another space) in the same subaccount collides with the first one (open decision D2).
- AI access (MCP): role `Tester`, secrets stay out of the AI channel, see "TestAgentService" in section 6.
- Local development uses mocked users (`package.json` → `cds.requires.[development].auth`): `admin/admin` (Admin+Tester), `tester/tester` (Tester). The WebSocket is anonymous locally (plugin behaviour with mocked auth); events are isolated by context IDs.

## 10. Configuration

| Key / variable | Default | Purpose |
|---|---|---|
| `cds.aemSuite.subscriptions.maxPerUser` | 5 | parallel live subscriptions per user |
| `cds.aemSuite.subscriptions.idleTimeoutMs` | 300000 | close subscriptions without heartbeat |
| `cds.aemSuite.subscriptions.maxMessagesPerSecond` | 100 | forwarding limit per subscription |
| `cds.aemSuite.subscriptions.maxPayloadBytes` | 524288 | truncation of payloads in the live view |
| `cds.aemSuite.autoTestConnection` | true | connection test on save of destination brokers |
| `cds.aemSuite.help.file` | `docs/user-guide.md` | location of the user guide the Help app shows (relative to the project root) |
| `cds.aemSuite.agent.maxRunResults` | 100 | test cases x brokers of one run started by an AI agent |
| `cds.aemSuite.agent.maxActiveRuns` | 2 | runs of one user that an agent may have in progress |
| `cds.aemSuite.agent.allowDirectCredentials` | false | development only: let `runTests` accept passwords of direct brokers (they would pass through the AI conversation) |
| `cds.aemSuite.mcp.publicUrl` | – | public app URL for the MCP OAuth discovery; default: from the approuter's forwarded headers |
| `cds.aemSuite.mcp.authorizationServer` | XSUAA `credentials.url` | authorization server advertised to MCP clients |
| `cds.aemSuite.runs.maxRepetitions` / `maxDelayMs` / `maxResults` | 1000 / 60000 / 5000 | limits of the advanced run settings: repetitions, pause between messages (ms), messages per run |
| `cds.aemSuite.faker.locale` | `en` | Language of `{{faker...}}` test data (`de`, `fr`, `es`, `en_GB`, ...). |
| `cds.mcp.prefix` / `cds.mcp.autowire` | true / false | MCP plugin: prefix tool names with the service name; do not register the endpoint in local AI clients automatically |
| env `destinations` | – | local destinations (JSON array, SAP Cloud SDK format + `msgVpn`/`smfUrl`) |
| env `NODE_ENV=production` | – | disables the dev no-cache middleware (`srv/server.ts`) |

Broker-level settings: `clientNamePrefix` (client name = prefix + random suffix), `connectTimeoutMs` (1 000–120 000). Test-case-level: `ackTimeoutMs` (100–120 000, default 5 000).

## 11. Local development

Prerequisites: **Node.js 22.12+** (the MCP plugin needs `require` of ES modules), npm, optionally Docker (local broker).

```sh
npm install
npm run watch                 # cds watch (TypeScript, SQLite in memory, demo data from test/data)
```

- Launchpad: <http://localhost:4004/launchpad.html> – users `admin/admin`, `tester/tester`.
- **Local broker**: `local/docker-compose.yml` (see [local/README.md](../local/README.md)) → demo broker `local-docker` uses `tcp://localhost:55555`, VPN `aem-local`, user `aem-suite`/`aemsuite`. The VPN, users and queues are provisioned by `local/terragrunt` (`tg.ps1 apply`).
- `cds watch` does **not** restart on changes in `test/data`; restart manually. Data is in memory and reset on every restart.
- UI files are served with `Cache-Control: no-store` in development (`srv/server.ts`), so a normal reload shows UI changes.
- Local destinations: set env `destinations`, e.g.
  `destinations='[{"name":"aem-dev","url":"https://mr-xyz.messaging.solace.cloud:443","username":"solace-cloud-client","password":"…","msgVpn":"dev-vpn"}]'`

### Development workflow

```sh
npm run verify      # before every commit: typecheck + lint + Jest (what CI runs first)
npm run e2e         # Playwright: UI apps in a browser (e2e:ui, e2e:headed, e2e:trace)
npm run typer       # regenerate the cds-typer models (@cds-models) - typecheck, test, watch and the e2e server do it first
npm run build:ui    # ui5 build of all apps, as the MTA build does it
```

| Script | Does |
|---|---|
| `typecheck` | `tsc` for the backend + tests, the subscriber app and the e2e tests |
| `lint` | ESLint (TypeScript, the UI code, the scripts); a committed `.only` is an error |
| `test` | Jest |
| `verify` | the three above, in this order |

- Shared UI code: edit `app/_shared` - no copies (section 8.2a).
- The server code uses the **cds-typer** models (`import { TestRuns } from '#cds-models/aem/suite'`): entities for queries and types for rows and enums instead of hand-written shapes. `@cds-models` is generated and not committed; `npm run typecheck`, `npm test`, `cds watch` and the e2e server generate it first, `cds build` puts it into `gen/srv`. `@singular` in the CDS fixes the class names cds-typer would derive badly (`TestCas`, a code list named like its enum type).
- The UI5 tooling (`@ui5/cli`, `ui5-task-zipper`, `ui5-tooling-transpile`, `@sapui5/types`) is installed once at the root (`npm install` / `npm ci`); the apps' own `package.json` files only name the custom tasks their `ui5.yaml` uses, which the UI5 CLI needs to find them.
- Versions: `npm run set-version -- <version>` (`scripts/set-version.js`) sets one version in `mta.yaml`, the root and app `package.json` files and the manifests; `test/version.test.ts` fails when they differ. Changes are listed in `CHANGELOG.md`.
- Line endings are LF (`.gitattributes`, `.editorconfig`).
- Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`).
- CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run verify` and `npm run e2e` on Node 22 for every pull request and every push to `main`; the Playwright report is attached when it fails.

**Jest (`test/*.test.ts`)**, by kind – the file names say which module they cover:

| Kind | What | How |
|---|---|---|
| Unit | template resolver, number ranges, faker, property types, defaults, URLs, node validation, test case spec, the Solace session | no server; the solclientjs session is faked (`test/fakes/solace.ts`) |
| Service | the OData services, the run engine (`test-runner`, `run-options`), tree, export / import, subscriptions (hub and HTTP), Home, Help, the MCP agent and its OAuth discovery, the dev server | `startServer()` (`cds.test`, SQLite in memory) with `resetDatabase()`; broker connections replaced by `fakeBroker()` / `setSessionFactory()` (`test/helpers.ts`) |
| Consistency | `mta.test.ts` (apps vs. MTA modules), `launchpad.test.ts` (tiles vs. manifests), `shared-ui.test.ts` (shared modules wired into every app), `ui5-version.test.ts`, `version.test.ts`, `help.test.ts` (help anchors and links of the guide) | read the files of the repository |

**End-to-end (`e2e/*.spec.ts`, Playwright).** `playwright.config.ts` starts `cds-tsx serve` with mocked users and the demo data on port 4005 (`E2E_PORT`; an already running server on that port is reused outside CI) and drives the sandbox launchpad in Chromium, locale en-US. Browser: on Windows the installed Edge, elsewhere Playwright's Chromium (`npx playwright install chromium` once); `PW_CHANNEL` overrides it. No broker is needed.

The specs cover the launchpad and its tiles, every app opening through its intent with the demo data, the role checks (user `tester`), and the main flows: Run dialog, payload editor, topic → name, number ranges, "my entries" filters, Home, the Live Subscriber (form, app-relative live socket, saved setups), the standalone apps and the demo data previews. Specs that create data use unique names and delete it after each test (`e2e/cleanup.ts`), so they also pass against a reused dev server.

`e2e/launchpad.ts` holds the intents and helpers (`openApp`, `expectAppOpen` waits for the window title the shell sets). Failures keep a trace in `test-results/` (`npx playwright show-trace ...`).

## 12. Build and deployment (Cloud Foundry)

```sh
npm run build      # mbt build (mbt is a devDependency): npm ci → cds build --production → node scripts/build-docs.js,
                   # then ui5 build per html5 module → mta_archives/aem-suite.mtar
npm run deploy     # cf deploy mta_archives/aem-suite.mtar
```

| MTA module / resource | Description |
|---|---|
| `aem-suite-srv` | CAP backend (`gen/srv`, compiled JS), **1 instance**, 512 MB, HTTP health check on `/health` |
| `aem-suite-db-deployer` | HDI deployer |
| `aem-suite` | standalone approuter: sandbox launchpad (welcome page), MCP; UI files from the HTML5 repo (bound to `app-runtime`) |
| `aem-suite-launchpad`, `aem-suite-testcases`, `-runs`, `-subscriber`, `-messages`, `-brokers`, `-variables`, `-numberranges`, `-help`, `-home` | `html5` modules (10): `npm run build` in the app → `dist/comaemsuite<app>.zip` (incl. `xs-app.json`) |
| `aem-suite-app-deployer` | uploads the zips to the HTML5 Application Repository (`app-host`) |
| `aem-suite-destination-content` | instance-level destinations for the managed approuter, `sap.cloud.service: aemsuite`: HTML5 repo, XSUAA (`OAuth2UserTokenExchange`), `srv-api` (forwards the token). Creates the service keys `aem-suite-auth-key` and `aem-suite-html5-repo-host-key`. |
| `aem-suite-auth` | XSUAA (`xs-security.json`) |
| `aem-suite-db` | HDI container (HANA Cloud required in the space) |
| `aem-suite-destination` | destination service (lite), `HTML5Runtime_enabled: true` |
| `aem-suite-html5-repo-host`, `aem-suite-html5-runtime` | HTML5 Application Repository, plans `app-host` (content) and `app-runtime` (standalone approuter) |

After deployment: assign role collections, create destinations for DESTINATION brokers (layout in 7.3). `test/data` is not part of the build; `db/data` (code lists) is.

**HTML5 apps.** All apps (incl. the sandbox launchpad) are listed in the BTP cockpit under *HTML5 Applications*. From there they open through the managed approuter; the standalone approuter URL keeps working as before.

**SAP Build Work Zone (standard edition).** Requires a Work Zone subscription in the same subaccount.

1. Work Zone → *Channel Manager* → refresh the **HTML5 Apps** content provider. The nine apps appear with title, description and the `crossNavigation` intents from their manifests (e.g. `AEMSuiteTestCases-manage`).
2. *Content Manager* → *Content Explorer* → *HTML5 Apps* → add the apps to *My Content*.
3. Create a group (e.g. "AEM Test Suite") and a role, assign the apps, add the role to a site, and assign the Work Zone role to users.
4. Authorization still comes from the app's own roles: the managed approuter exchanges the login token for one of `aem-suite-auth` (destination `aem-suite-auth`), so users also need **AEM_Suite_Admin** / **AEM_Suite_Tester**.

The live views (Test Cases run progress, Live Subscriber) use WebSockets through the app's `xs-app.json` (`websockets.enabled`), which the approuter supports for HTML5 repo apps. MCP is not part of Work Zone: AI clients keep using the standalone approuter URL (`/mcp/agent`).

## 13. Extending the application

| Goal | Where |
|---|---|
| Change or add help text | edit `docs/user-guide.md` - nothing else. Keep headings stable (apps link to them, see the Help buttons above); a new `## ` heading becomes a new section automatically |
| New agent capability (MCP) | an unbound action / function in `srv/agent-service.cds` + handler in `srv/agent-service.ts`; reuse the checks in `srv/lib/node-validation.ts`; list it in `test/agent.test.ts` (the test pins the exact set of entities and actions) |
| New built-in template function | `TemplateResolver.callFunction` / `fixed` in `srv/lib/template/resolve.ts` (+ the help list in `PayloadSection.js`) |
| Payload assertions / round-trip checks | `test-runner.ts`: subscribe before publishing (use `SolaceSession.subscribe`/`onMessage`), new result fields in `RunResults` |
| Other protocols (MQTT, AMQP, REST) | implement the `Publisher` interface and route in `solace/connector.ts` per broker setting |
| Scaling beyond one instance | replace `subscription-hub` state with a shared store, enable the websocket Redis adapter |
| Translations | i18n bundles in the apps; annotation texts are English literals today |

## 14. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Password required for broker …` | DIRECT broker without password in the request – enter it in the dialog. |
| `Username required for broker …` | DIRECT broker without a maintained username and none in the request – enter it in the dialog or maintain it on the broker. |
| `Connect failed: … ECONNREFUSED` | Wrong host/port or broker down; for Docker check `docker ps` and the port mapping. |
| `No broker acknowledgement within … ms` | No ACK in time (overloaded broker, spool limits); raise *ACK timeout* or check the broker. |
| `Rejected by broker: …` | E.g. `reject-msg-to-sender-on-no-subscription-match`, spool quota, ACL – check the VPN configuration. |
| `Unknown variable(s): …` | Variable not defined in any scope; check the *Preview*. |
| UI shows old behaviour after a change | In BTP: cache of the approuter/browser – hard reload. Locally the dev server sends `no-store`. |
| Requests with paths like `…/{variables` | `{…}` inside an annotation text (see 8.3). |
| `EADDRINUSE 4004` | An old dev server is still running – stop the old `node` process. |
