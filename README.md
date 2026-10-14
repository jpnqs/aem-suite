# AEM Test Suite

CAP (Node.js, TypeScript) app on SAP BTP for testing **SAP Integration Suite, Advanced Event Mesh** (Solace) brokers:

- **Brokers**: connection data either from a **BTP destination** or entered in the UI. For direct brokers, **the password is never stored**: it's entered when a run, a connection test or a subscription is started, and kept in memory only for that operation.
- **Test cases**: topic, JSON payload, delivery mode, TTL, priority, correlation ID and user properties. Topic, payload, correlation ID and property values support `{{variables}}`.
- **Runs**: run one or many test cases against several brokers in parallel. A result **passes when the broker acknowledges** the message (PERSISTENT), or when the send succeeds (DIRECT). The run history is kept per broker.
- **Live subscriber**: subscribe to topics (wildcards allowed), browse or consume queues, watch messages live over a WebSocket, and save them or turn them into a test case.

## Architecture

```
Browser ── approuter (XSUAA, websockets) ──┬─ /odata/v4/{admin,test,subscribe}  OData V4
                                           └─ /ws/live                          WebSocket (run progress, live messages)
CAP srv (TypeScript)
  srv/lib/solace/session.ts            solclientjs session wrapper: connect, publish + ACK, subscribe, queue flows
  srv/lib/solace/subscription-hub.ts   live subscriptions (in memory, per user, heartbeat-based idle timeout)
  srv/lib/test-runner.ts               async multi-broker runs, results + websocket progress
  srv/lib/template/resolve.ts          {{variable}} resolver
  srv/lib/credentials/                 destination / direct connection data, destination value help
HANA Cloud · Destination service · XSUAA
```

| App (`app/…`) | Type | Role |
|---|---|---|
| `testcases` | Fiori elements LR/OP with JSON editor, Run dialog (live progress) and Preview | Tester |
| `runs` | Fiori elements LR/OP | Tester |
| `subscriber` | Freestyle UI5 in TypeScript | Tester |
| `messages` | Fiori elements, saved messages | Tester |
| `brokers`, `variables` | Fiori elements | Admin |

`app/launchpad.html` is a sandbox launchpad that shows all apps as tiles. The approuter uses it as its welcome page.

## Defaults and automatic settings

- **Broker URL**: the host is enough. `mr-xyz.messaging.solace.cloud` becomes `wss://…:443`. With port `55443` you get `tcps://`, with `55555` `tcp://`, and with `8008` `ws://`. `https://` is mapped to `wss://`.
- **Username** defaults to `solace-cloud-client` (the AEM standard).
- **Password (direct brokers)**: not part of the broker configuration. The Run dialog shows one password field per selected direct broker; Test Connection and the subscriber ask for it too. It's sent with that request only, held in server memory while the run or subscription lasts, and never written to the database, logs or browser storage.
- **Connection test on save** (destination brokers only, since direct brokers have no stored password): every save of an active destination broker tests the connection (max. 5 s) and shows the result. Turn it off with `cds.aemSuite.autoTestConnection: false`.
- **Destination**: in destination mode, a dropdown lists the BTP destinations (or env `destinations` locally) with URL and message VPN.
- **New test case**: only **Topic** is required. **Name** is optional and follows the topic until you enter your own. Everything else (description, delivery mode (default persistent), correlation ID (default `{{uuid}}`), content type (default `application/json`), ACK timeout, TTL, priority, DMQ) sits under "Advanced". The payload starts from a sample with `{{uuid}}` and `{{now}}`.
- **Content type / property type**: left empty, they're detected on save (`{`/`[` gives JSON, otherwise text; `42` gives INT, `true` gives BOOL, otherwise STRING).
- **Remembered per browser**: the Run dialog preselects the last brokers (or the only one), Preview preselects a broker, and the subscriber restores broker, mode, topics and queue.

## Templates

`{{name}}` is looked up in this order: **test case variables, then broker variables, then global variables, then built-ins**. Variables can reference other variables.

| Built-in | Value |
|---|---|
| `{{uuid}}` | one UUID per message, the same in topic, payload and correlation ID |
| `{{newUuid}}` | a fresh UUID per occurrence |
| `{{now}}`, `{{timestamp}}`, `{{date}}` | ISO timestamp, epoch ms, `YYYY-MM-DD` |
| `{{randomInt(min,max)}}` | random integer (inclusive) |
| `{{broker.name}}`, `{{broker.id}}`, `{{broker.msgVpn}}` | the broker the message is sent to |

Placeholders work outside JSON strings too, for example `"qty": {{qty}}`. The JSON editor validates and formats such payloads. Unknown variables or invalid JSON after resolution produce an **ERROR** result, and nothing is sent.

## Local development

Requires **Node.js 22+** (CAP 10).

```sh
npm install
npm run watch          # cds watch with TypeScript, SQLite in memory
```

Open http://localhost:4004/launchpad.html and log in as `admin`/`admin` (Admin + Tester) or `tester`/`tester`.

**Local demo setup** (`test/data/`, loaded by `cds watch` only, never deployed):

- Broker `local-docker`: `tcp://localhost:55555`, VPN `default`, user `default`. Enter any password when running (the default VPN of the Docker broker doesn't check it). Start a local broker with:
  ```sh
  docker run -d --name solace-broker --shm-size=1g -p 8080:8080 -p 55555:55555 -p 8008:8008 \
    -e username_admin_globalaccesslevel=admin -e username_admin_password=admin solace/solace-pubsub-standard
  ```
- Broker `aem-dev (destination)`: an inactive example for DESTINATION mode.
- Global variables `app`, `region` and `source`, plus a broker override `region=local`.
- Test cases "Order created" (persistent, user properties, local variable), "Ping" (direct) and "Inventory updated" (persistent, TTL, random values).

The data lives in memory and is reset on every restart. `cds watch` does not restart when `test/data` changes, so restart it manually.

**Destinations locally**: `DESTINATION` brokers are resolved through the SAP Cloud SDK. Locally, you can provide them through the environment variable `destinations`:

```sh
destinations='[{"name":"aem-dev","url":"wss://mr-xyz.messaging.solace.cloud:443","username":"solace-cloud-client","password":"…","msgVpn":"dev-vpn"}]'
```

You can also bind a real destination service with `cds bind`.

```sh
npm test               # jest: unit + service integration tests (broker connection stubbed)
npm run typecheck      # backend + subscriber app
```

## BTP destination layout

Use one destination per broker:

| Field | Value |
|---|---|
| Type | HTTP, NoAuthentication or BasicAuthentication |
| URL | `wss://<host>:443` (`https://` is mapped to `wss://`) |
| User / Password | client username / password |
| Additional property `msgVpn` | message VPN name (**required**) |
| Additional property `smfUrl` | optional URL override, e.g. `tcps://<host>:55443` |

## Deployment (Cloud Foundry)

```sh
npm i -g mbt
mbt build
cf deploy mta_archives/aem-suite_1.0.0.mtar
```

Then assign the role collections **AEM_Suite_Admin** and/or **AEM_Suite_Tester** in the BTP cockpit.

The MTA build runs `cds build --production` (which compiles the TypeScript) and `node scripts/build-ui.js`. That script runs `ui5 build` for every app and copies the results into `app/router/resources`, where the standalone approuter serves them.

### Operational notes

- **Single instance**: live subscriptions are held in the memory of the srv instance, so the MTA pins `instances: 1`. To scale out, sticky sessions or a shared session registry would be needed.
- A subscription is closed when the UI has not sent a heartbeat for 5 minutes (tab closed), or on Stop. Limits: 5 subscriptions per user and 100 msg/s forwarded per subscription. Payloads over 512 KB are truncated in the live view. Change these with `cds.aemSuite.subscriptions` in `package.json` (`maxPerUser`, `idleTimeoutMs`, `maxMessagesPerSecond`, `maxPayloadBytes`).
- **Consume Queue** acknowledges and removes the messages from the queue. **Browse Queue** leaves them on the queue.
