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
| Tests | Jest 30 + ts-jest, `@cap-js/cds-test` |

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
2. `createRun` validates the input, expands folders to test cases (tree order), and inserts `TestRuns` plus one `PENDING` `RunResults` row per test case × broker in the request transaction.
3. After commit (`req.on('succeeded')`) `executeRunInBackground` starts. Brokers are processed **in parallel**, the test cases of one broker **sequentially** over one session.
4. Each result row is updated in its own transaction and a `runProgress` event goes to WebSocket context = run ID.
5. At the end the run gets status `DONE`, counters, and `TestCaseStats` (last result per test case) is upserted.

## 4. Repository layout

```
app/
  launchpad.html              sandbox Fiori launchpad (all tiles)
  appconfig/                  sandbox config (removes the SAP sample tiles)
  services.cds                imports all UI annotation files
  brokers/ variables/ runs/ messages/   Fiori elements apps (annotations.cds + webapp/)
  testcases/                  Fiori elements app with extensions (webapp/ext/*)
  subscriber/                 freestyle UI5 app in TypeScript
  router/                     standalone approuter (xs-app.json; resources/ is generated)
db/
  schema.cds                  domain model (namespace aem.suite)
  data/                       code lists (deployed)
srv/
  admin-service.*, test-service.*, subscribe-service.*, live-service.cds
  server.ts                   dev-only no-cache header for UI files
  lib/                        business logic (see section 7)
  types/solclientjs.d.ts      typings for solclientjs (the package ships none)
test/
  *.test.ts                   unit and service tests
  data/                       demo data – loaded by cds watch / tests only, never deployed
local/                        docker-compose for a local Solace broker
scripts/build-ui.js           ui5 build of all apps + assembly into app/router/resources
mta.yaml, xs-security.json    deployment
```

## 5. Domain model (`db/schema.cds`)

| Entity | Purpose | Notes |
|---|---|---|
| `Brokers` | Broker / message VPN | `credentialMode` DIRECT or DESTINATION; DIRECT keeps `url`, `msgVpn`, an optional `username` (if empty it is entered at run time) – **no password field**; `lastConnection*` holds the last connection test. Composition `variables` (broker variables). |
| `Variables` | Template variables | `broker` empty = global variable, set = broker variable. |
| `TestCases` | **Tree node**: folder or test case | `kind` FOLDER/TEST, `parent` (association) + `children` (recursive composition), `sortOrder` for manual ordering. Test case fields: `topic`, `payload`, `contentType`, `deliveryMode`, `timeToLiveMs`, `dmqEligible`, `priority`, `correlationId`, `ackTimeoutMs`. Compositions `userProperties`, `variables`. Association `lastResult` → `TestCaseStats`. |
| `TestCaseProperties` | SMF user properties | `type` STRING / INT / BOOL (empty = inferred on save). |
| `TestCaseVariables` | Variables of a test case **or a folder** | Folder variables apply to all descendants. |
| `TestCaseStats` | Outcome of the latest run per test case | Written by the runner; kept separate so runs do not change `modifiedAt` of test cases. |
| `TestRuns` | One execution | `summary` ("A, B → broker1"), `status` RUNNING/DONE, counters. Composition `results`. |
| `RunResults` | One test case × broker | `status` PENDING/PASSED/FAILED/ERROR, resolved topic/payload, correlation ID, ACK latency, error message. Name snapshots (`testCaseName`, `brokerName`) keep history readable. |
| `ReceivedMessages` | Messages saved from the live subscriber | Payload, user properties (JSON), source, delivery mode. |
| `CredentialModes`, `DeliveryModes`, `PropertyTypes` | Code lists for dropdowns | CSV in `db/data`. |

Result semantics:

| Status | Meaning |
|---|---|
| PASSED | PERSISTENT: broker ACK received within `ackTimeoutMs`. DIRECT: `send()` succeeded. |
| FAILED | Broker rejected the message, ACK timeout, send error, session dropped. |
| ERROR | The message could not be built or sent at all: unknown variable, invalid JSON, missing password, connection/login failure, destination problems. |

`TestCaseStats.status` is PASSED only if every broker of the latest run passed, otherwise FAILED (any FAILED) or ERROR.

## 6. Services and API

All OData V4. Paths are prefixed with the approuter URL in BTP.

### AdminService – `/odata/v4/admin` (role `Admin`)

| Element | Description |
|---|---|
| `Brokers` (draft) | Broker maintenance. Handlers: URL completion while editing and on save, validation, **automatic connection test on save for DESTINATION brokers** (max. 5 s). |
| `Brokers.testConnection(username, password)` | Opens/closes a session, stores the outcome. `password` is required for DIRECT brokers and never stored; `username` only if none is maintained on the broker. |
| `BrokerVariables` | Broker variables (composition of `Brokers`). |
| `GlobalVariables` (draft) | Projection on `Variables` without broker; unique names. |
| `Destinations` | Read-only value help (`@cds.persistence.skip`) – destinations from the bound destination service and from env `destinations`, filtered to broker URLs. |
| `CredentialModes` | Code list. |

### TestService – `/odata/v4/test` (role `Tester`)

| Element | Description |
|---|---|
| `TestCases` (draft, **hierarchy**) | Folder/test case tree. Computed columns `LimitedDescendantCount`, `DistanceFromRoot`, `DrillState`, `LimitedRank` and `@Aggregation.RecursiveHierarchy #TestTree` / `@Hierarchy.RecursiveHierarchy #TestTree` enable CAP hierarchy queries for the Fiori tree table. `kindText` is a display text for `kind`. |
| `TestCases.runTest(brokerIds, credentials)` | Runs one node (a folder runs its subtree). |
| `TestCases.preview(brokerId)` | Resolves topic, payload, correlation ID and properties without sending. Works on drafts. |
| `TestCases.duplicate()` | Copies a test case or a folder with everything below it (`srv/lib/copy-nodes.ts`); the copy is named "… (Copy)" and placed right after the original. |
| `copyNodes(ids)` | Same for several nodes; a node below another selected node is copied with that node only. Returns `{ ID, name }` per copy. Used by the *Copy* buttons. |
| `TestCases.moveBefore(NextSibling)` | `ChangeNextSiblingAction` of the tree table (drag & drop ordering). |
| `runTests(testCaseIds, brokerIds, credentials)` | Runs several nodes against several brokers in one run. |
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
| `activeSubscriptions()` | Own subscriptions; also acts as **heartbeat** (keeps them alive). |
| `ReceivedMessages` | Saved messages (no update). Action `createTestCase()` creates a test case from a message (pretty-printed JSON payload, property types inferred). |
| `Brokers` | Active brokers (incl. `credentialMode`, `username`). |

### LiveService – WebSocket `/ws/live` (role `Tester`)

Clients enter a **context** to receive only their events:

```json
{"event":"wsContext","data":{"context":"<runId or subscriptionId>"}}
```

| Event | Context | Payload |
|---|---|---|
| `runProgress` | run ID | `status` RUNNING/DONE, `total`, `done`, `passed`, `failed`, `resultId` |
| `message` | subscription ID | topic, payload, contentType, userProperties (JSON), correlationId, deliveryMode, receivedAt, seq |
| `subscriptionStatus` | subscription ID | `STOPPED`, `DOWN`, `THROTTLED`, `RESUMED` + message |

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

### 7.5 `test-case-spec.ts`

Loads test cases with properties and variables, builds the variable scopes (`loadVariableScopes`: global, per broker, per folder + the tree), computes the folder chain of a node (`scopeFor`) and turns a test case into a `PublishSpec` (`buildSpec`): rejects empty topics and wildcards, applies content-type detection and property-type inference as fallbacks.

### 7.6 `test-runner.ts`

`createRun` → validation (brokers exist and are active, passwords for DIRECT brokers, at least one test case after folder expansion), `summary`, pending rows. `executeRunInBackground` → see section 3. `waitForRun(runId)` exists for tests.

### 7.7 `tree.ts`

In-memory tree over `TestCases` (`ID`, `parent_ID`, `kind`, `name`, `sortOrder`): `ancestors`, `isWithin` (cycle check), `expandToTests` (folders → test cases in tree order), `compareSiblings` (folders first, then `sortOrder`, then name).

### 7.8 `solace/subscription-hub.ts`

In-memory registry of live subscriptions (one session each). Limits (configurable, section 10): 5 per user, 100 forwarded messages/s per subscription (excess is counted but not forwarded; THROTTLED/RESUMED events), payloads > 512 KB truncated in the live view. A sweeper closes subscriptions without heartbeat for 5 minutes (the UI calls `activeSubscriptions()` every 60 s) – messages do not count as activity, so subscriptions of closed browser tabs end. All subscriptions are closed on server shutdown.

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
| `testcases` | Fiori elements LR/OP | **Tree table** (`hierarchyQualifier: TestTree`, create menu Folder/Test Case, drag & drop, Cut/Paste, Move Up/Down); custom sections `MessageSection` (full-width topic + name) and `PayloadSection` (`sap.ui.codeeditor` JSON editor, validation, format, template help); custom actions *Run…*, *Copy* and *Preview*. |
| `runs` | Fiori elements LR/OP | List on `RunResults` (one row per test case × broker, filters for test case, broker, status, started by/at); link columns to the test case, broker and run (`testCaseLink`, `brokerLink`, `runLink` in `TestService.RunResults` are launchpad intents). Run page (`TestRuns`) with totals and its results. |
| `subscriber` | Freestyle UI5, **TypeScript** | Live subscriptions over WebSocket, message list (batched, max. 500), detail panel, save / save as test case. |
| `messages` | Fiori elements | Saved messages, *Create Test Case*. |
| `brokers`, `variables` | Fiori elements | Admin apps. |

### 8.2 Test case app extensions (`app/testcases/webapp/ext`)

| File | Role |
|---|---|
| `TestCaseActions.js` | *Run…* (list and object page), Run dialog with broker selection, password fields for DIRECT brokers, live progress via WebSocket, problem list, *Preview* dialog. |
| `RunDialog.fragment.xml`, `PreviewDialog.fragment.xml` | Dialogs. |
| `TypeColumn.fragment.xml` | Custom "Type" column of the tree table: a small folder / test case icon (name as tooltip) instead of the type text. Defined under `columns` in the manifest, so `kind` is not part of the `@UI.LineItem`. |
| `MessageSection.*`, `PayloadSection.*`, `JsonTemplate.js` | Custom sections; JSON handling that tolerates `{{…}}` outside strings. |
| `ObjectPageExt.controller.js` | Hides test-case-only parts for folders (manifest `visible` expressions are evaluated before data is loaded). |
| `MyEntriesFilter.controller.js` | Prefills the "Created by" filter once per app start with `currentUser()`. Same file in the runs app ("Started by"). |
| `TreeRules.js` | Tree hooks: create and drop only in folders/root. Preloaded in `Component.js` because FE resolves hooks synchronously. |
| `LiveSocket.js`, `Prefs.js` | WebSocket client; browser-local preferences (last brokers). |

### 8.3 Conventions and pitfalls

- **Never put `{` `}` into annotation texts** (labels, QuickInfo): Fiori elements interprets them as bindings and sends broken requests. In XML escape as `\{`, in JS controls set texts via setters, not constructor settings.
- UI5 TypeScript classes: **no getters** in controllers (`ui5-tooling-transpile` converts the class to `Controller.extend({...})` and evaluates getters at definition time).
- Models in `onInit` of a root view: use `getOwnerComponent().getModel()`.
- All apps pin `https://ui5.sap.com/1.148.12`.

### 8.4 Launchpad

`app/launchpad.html` uses the ushell **sandbox** (`sap-ushell-config.applications` creates the tiles/intents). `app/appconfig/fioriSandboxConfig.json` empties the sandbox's sample groups. In BTP this page is the approuter welcome page. For a central launchpad use SAP Build Work Zone and the HTML5 application repository instead.

## 9. Security

- **Scopes / role templates** (`xs-security.json`): `Admin` (contains `Tester`), `Tester`. Role collections `AEM_Suite_Admin`, `AEM_Suite_Tester`.
- `AdminService` requires `Admin`; `TestService`, `SubscribeService`, `LiveService` require `Tester`.
- Approuter (`app/router/xs-app.json`): `/odata/*` with CSRF, `/ws/*` with websockets enabled, everything else served from `resources/` (no-cache), all routes `xsuaa`.
- Data visibility: all testers share test cases, runs and saved messages (team workspace); the "my entries" filter is a UI default, not an authorization. Subscriptions can only be stopped by their owner.
- Broker passwords: see 7.3. Destination credentials stay in the BTP destination service.
- Local development uses mocked users (`package.json` → `cds.requires.[development].auth`): `admin/admin` (Admin+Tester), `tester/tester` (Tester). The WebSocket is anonymous locally (plugin behaviour with mocked auth); events are isolated by context IDs.

## 10. Configuration

| Key / variable | Default | Purpose |
|---|---|---|
| `cds.aemSuite.subscriptions.maxPerUser` | 5 | parallel live subscriptions per user |
| `cds.aemSuite.subscriptions.idleTimeoutMs` | 300000 | close subscriptions without heartbeat |
| `cds.aemSuite.subscriptions.maxMessagesPerSecond` | 100 | forwarding limit per subscription |
| `cds.aemSuite.subscriptions.maxPayloadBytes` | 524288 | truncation of payloads in the live view |
| `cds.aemSuite.autoTestConnection` | true | connection test on save of destination brokers |
| env `destinations` | – | local destinations (JSON array, SAP Cloud SDK format + `msgVpn`/`smfUrl`) |
| env `NODE_ENV=production` | – | disables the dev no-cache middleware (`srv/server.ts`) |

Broker-level settings: `clientNamePrefix` (client name = prefix + random suffix), `connectTimeoutMs` (1 000–120 000). Test-case-level: `ackTimeoutMs` (100–120 000, default 5 000).

## 11. Local development

Prerequisites: **Node.js 22+**, npm, optionally Docker (local broker).

```sh
npm install
npm run watch                 # cds watch (TypeScript, SQLite in memory, demo data from test/data)
```

- Launchpad: <http://localhost:4004/launchpad.html> – users `admin/admin`, `tester/tester`.
- **Local broker**: `local/docker-compose.yml` (see [local/README.md](../local/README.md)) → demo broker `local-docker` uses `tcp://localhost:55555`, VPN `default`, user `default`; any password works on the default VPN.
- `cds watch` does **not** restart on changes in `test/data`; restart manually. Data is in memory and reset on every restart.
- UI files are served with `Cache-Control: no-store` in development (`srv/server.ts`), so a normal reload shows UI changes.
- Local destinations: set env `destinations`, e.g.
  `destinations='[{"name":"aem-dev","url":"https://mr-xyz.messaging.solace.cloud:443","username":"solace-cloud-client","password":"…","msgVpn":"dev-vpn"}]'`

Quality checks:

```sh
npm test            # Jest: unit + service tests (broker connection stubbed)
npm run typecheck   # backend + tests + subscriber app
```

| Test file | Covers |
|---|---|
| `template.test.ts` | template resolver, precedence, built-ins, cycles |
| `session.test.ts` | ACK / reject / timeout / disconnect with a faked solclientjs session; message mapping |
| `resolve.test.ts`, `defaults.test.ts` | URL handling, runtime passwords, detection helpers |
| `services.test.ts` | OData services end-to-end with stubbed broker: brokers, variables, test cases, runs, preview, saved messages, filters |
| `tree.test.ts` | hierarchy queries, folder validation, moves (incl. concurrent change set), folder runs and variables, folder deletion |

## 12. Build and deployment (Cloud Foundry)

```sh
npm i -g mbt
mbt build                                   # npm ci → cds build --production → node scripts/build-ui.js
cf deploy mta_archives/aem-suite_1.0.0.mtar
```

| MTA module / resource | Description |
|---|---|
| `aem-suite-srv` | CAP backend (`gen/srv`, compiled JS), **1 instance**, 512 MB |
| `aem-suite-db-deployer` | HDI deployer |
| `aem-suite` | standalone approuter with the built UI apps in `resources/` |
| `aem-suite-auth` | XSUAA (`xs-security.json`) |
| `aem-suite-db` | HDI container (HANA Cloud required in the space) |
| `aem-suite-destination` | destination service (lite) |

After deployment: assign role collections, create destinations for DESTINATION brokers (layout in 7.3). `test/data` is not part of the build; `db/data` (code lists) is.

## 13. Extending the application

| Goal | Where |
|---|---|
| New built-in template function | `TemplateResolver.callFunction` / `fixed` in `srv/lib/template/resolve.ts` (+ `isBuiltin`, help list in `PayloadSection.js`) |
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
