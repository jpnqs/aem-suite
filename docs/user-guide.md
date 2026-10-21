# AEM Test Suite – User Guide

The AEM Test Suite lets you test **SAP Advanced Event Mesh** brokers without writing code:
save messages as **test cases**, send them to one or several brokers with one click, see immediately whether each broker accepted them, and **watch topics and queues live**.

---

## Contents

- [1. Getting started](#1-getting-started)
- [2. Set up brokers (Admin)](#2-set-up-brokers-admin)
  - [Brokers from a BTP destination](#brokers-from-a-btp-destination)
  - [Export and import the configuration](#export-and-import-the-configuration)
- [3. Global variables (Admin)](#3-global-variables-admin)
- [4. Organize test cases in folders](#4-organize-test-cases-in-folders)
  - [Export and import](#export-and-import)
- [5. Create and edit a test case](#5-create-and-edit-a-test-case)
  - [Message](#message)
  - [Payload](#payload)
  - [Advanced (click *Show more*)](#advanced-click-show-more)
  - [User Properties](#user-properties)
  - [Variables](#variables)
  - [Preview](#preview)
- [6. Run tests](#6-run-tests)
  - [Advanced settings](#advanced-settings)
  - [What do the results mean?](#what-do-the-results-mean)
- [7. Check results](#7-check-results)
- [8. Watch messages live (Live Subscriber)](#8-watch-messages-live-live-subscriber)
- [9. Saved messages](#9-saved-messages)
- [10. Variables and templates](#10-variables-and-templates)
  - [Where values come from (first match wins)](#where-values-come-from-first-match-wins)
  - [Built-ins](#built-ins)
  - [Example](#example)
  - [Number ranges (Admin)](#number-ranges-admin)
  - [Test data with faker](#test-data-with-faker)
- [11. Use an AI assistant (MCP)](#11-use-an-ai-assistant-mcp)
- [12. Clean up old data (Admin)](#12-clean-up-old-data-admin)
- [13. Tips and troubleshooting](#13-tips-and-troubleshooting)
- [14. Click guides](#14-click-guides)
  - [Get access and open the suite](#get-access-and-open-the-suite)
  - [Add a broker with direct input (Admin)](#add-a-broker-with-direct-input-admin)
  - [Add a broker from a BTP destination (Admin)](#add-a-broker-from-a-btp-destination-admin)
  - [Create a global variable (Admin)](#create-a-global-variable-admin)
  - [Create a number range (Admin)](#create-a-number-range-admin)
  - [Create a folder and a test case](#create-a-folder-and-a-test-case)
  - [Run test cases and read the result](#run-test-cases-and-read-the-result)
  - [Repeat a message and pace it](#repeat-a-message-and-pace-it)
  - [Watch a topic live and keep the setup](#watch-a-topic-live-and-keep-the-setup)
  - [Turn a received message into a test case](#turn-a-received-message-into-a-test-case)
  - [Move tests to another system](#move-tests-to-another-system)
  - [Clean up old data (Admin)](#clean-up-old-data-admin)
  - [Connect an AI assistant](#connect-an-ai-assistant)
- [15. The screens at a glance](#15-the-screens-at-a-glance)

---

## 1. Getting started

Open the launchpad – the suite's own start page, or your SAP Build Work Zone site if your administrator added the apps there. Depending on your role you see these tiles:

| Tile | What for | Role |
|---|---|---|
| **Home** | start page: the state of the suite at a glance, your apps and the latest runs | everyone |
| **Test Cases** | create, organize and run test cases | Tester |
| **Test Runs** | results of all runs | Tester |
| **Live Subscriber** | watch topics and queues live | Tester |
| **Saved Messages** | messages you kept from the live subscriber | Tester |
| **Brokers** | connections to the brokers | Admin |
| **Global Variables** | variables for all test cases | Admin |
| **Number Ranges** | document numbers (like SAP) for your messages | Admin |
| **Data Cleanup** | delete old runs, messages and setups | Admin |
| **Help** | this guide, inside the app | everyone |

The **Home** page groups the apps by role: **Testing** (Test Cases, Test Runs, Live Subscriber, Saved Messages) and, if you are an administrator, **Administration** (Brokers, Global Variables, Number Ranges, Data Cleanup). The user guide is the **Help** button of the page. It also lists what **needs attention** (failed results, a broker whose connection test failed, ...). Click **OK** on a notice to hide it - it stays hidden in this browser until the situation changes (for example more results fail, or another broker fails). **Show again** brings hidden notices back.

**Help is always at hand:** every page has a **Help** button (top right) that opens the matching part of this guide in a new tab, so you do not lose what you are doing. The **Help** tile shows the whole guide with a contents list on the left and a **search** that highlights what it finds.

Your administrator assigns the roles (**AEM_Suite_Tester** or **AEM_Suite_Admin**). Admins can do everything testers can.

**Prefer to be led by the hand?** Chapter [14. Click guides](#14-click-guides) shows every setup step by step, with a picture for the important screens (the element to click is framed in orange). Chapter [15. The screens at a glance](#15-the-screens-at-a-glance) explains what is on each page.

**Typical workflow**

1. An admin adds the brokers once.
2. You create test cases (optionally in folders).
3. You select test cases or a folder → **Run…** → choose brokers → enter passwords (and a username for brokers that have none) → done.
4. Failures are shown directly in the run dialog; the details are in **Test Runs**.
5. To see what really arrives on a topic, use the **Live Subscriber**.

---

## 2. Set up brokers (Admin)

Open **Brokers** → **Create**.

| Field | What to enter |
|---|---|
| **Name** | e.g. `dev`, `qa-eu` – shown everywhere in the app |
| **Credentials** | **Direct Input**: URL, message VPN and username are entered here; the password is asked for whenever a connection is opened. **BTP Destination**: everything comes from a BTP destination maintained by your BTP admin. |
| **URL** (direct) | The host is enough, e.g. `mr-xyz.messaging.solace.cloud`. It is completed automatically: no port → `wss://…:443`, port `55443` → `tcps://`, port `55555` → `tcp://`. |
| **Message VPN** (direct) | e.g. `dev-vpn` |
| **Username** (direct) | optional (the AEM standard is `solace-cloud-client`). If it is empty, the username is asked for together with the password whenever you run tests, test the connection or subscribe. |
| **Destination** (destination mode) | choose from the list (shows URL and VPN); how to create one: [Brokers from a BTP destination](#brokers-from-a-btp-destination) |
| **Active** | inactive brokers are hidden in run and subscribe dialogs |
| **Available for AI Agents** (destination mode) | on by default: an AI assistant may preview and run tests on this broker. Switch it off for brokers the assistant must not use, e.g. production. Direct brokers are never available to it |
| Advanced | client name prefix, connect timeout |

> **Passwords are never saved.** For direct brokers you enter the password when you run tests, test the connection or start a subscription. It is used only for that action.

**Test Connection**: on the broker page, or with one or more brokers selected in the list, click **Test Connection**. Destination brokers are tested right away. For direct brokers a dialog asks for the password (and the username if none is maintained on the broker); the password is only used for this test. The result is shown in the header ("Last Connection Test") and in the broker list. Destination brokers are also tested automatically when you save them.

**Broker variables**: on the broker page, section *Broker Variables* – values that apply only when sending to this broker (e.g. `region = eu` for the EU broker). See [section 10](#10-variables-and-templates).

Where do I find the connection data? In the AEM console: *Cluster Manager → your service → Connect → Solace Web Messaging / Solace Messaging* (host, port, message VPN, username).

### Brokers from a BTP destination

With a destination, the broker's technical user and its password are kept in BTP. Nobody enters a password: runs, connection tests, live subscriptions and the AI assistant all log in as that user. Create one destination per broker (message VPN) in the BTP cockpit: *your subaccount → Connectivity → Destinations → Create Destination*.

| Field | Value | Example |
|---|---|---|
| **Name** | any name – you pick it in the broker later | `aem-dev` |
| **Type** | `HTTP` | |
| **URL** | the web messaging endpoint of the broker. The cockpit only accepts `https://`, the app connects with `wss://` | `https://mr-xyz.messaging.solace.cloud:443` |
| **Proxy Type** | `Internet` | |
| **Authentication** | `BasicAuthentication` | |
| **User**, **Password** | the technical user of the broker (client username) | `solace-cloud-client` |
| Additional property **`msgVpn`** | the message VPN – required | `dev-vpn` |
| Additional property **`smfUrl`** | optional: connect with this URL instead, e.g. SMF over TLS | `tcps://mr-xyz.messaging.solace.cloud:55443` |

Additional properties are added with **New Property** in the destination. Instead of typing everything, you can save the following as a file and import it with **Import Destination** (then enter the password):

```properties
Name=aem-dev
Description=AEM dev broker for the AEM Test Suite
Type=HTTP
URL=https\://mr-xyz.messaging.solace.cloud\:443
ProxyType=Internet
Authentication=BasicAuthentication
User=solace-cloud-client
Password=<password of the technical user>
msgVpn=dev-vpn
```

A broker reached through SMF over TLS instead of websockets gets the same destination plus the `smfUrl` property:

```properties
Name=aem-qa-tcps
Type=HTTP
URL=https\://mr-abc.messaging.solace.cloud\:443
ProxyType=Internet
Authentication=BasicAuthentication
User=aem-suite-tester
Password=<password of the technical user>
msgVpn=qa-vpn
smfUrl=tcps\://mr-abc.messaging.solace.cloud\:55443
```

Then, in the app: **Brokers → Create**, *Credentials* **BTP Destination**, and pick the destination from the value help. It lists the destinations of the subaccount with URL and message VPN (only those whose URL can be a broker). Saving tests the connection right away.

> **The technical user decides what the tests may do.** Every run through this destination publishes as that user, so give it an ACL profile that allows the topics you test – and nothing more on production brokers. Who may *use* the destination is decided by the app's roles (Tester runs, Admin maintains brokers).

### Export and import the configuration

Brokers, global variables and number ranges can be saved as a JSON file and imported again – to set up a second system the same way, to keep the configuration in Git, or as a backup. Each of the three apps has **Export** and **Import** above its list.

- **Export**: select rows → **Export** (nothing selected = all). The file holds the settings only – no IDs, no authors, no connection status, and no passwords (they are never stored). Brokers come with their broker variables. Number ranges come without their counter: the counter belongs to the system it runs in.
- **Import**: **Import** → choose a file that was exported from the same app. It is checked first and you confirm what will be added.
- **Import only adds.** Every entry of the file becomes a new entry – existing brokers, variables and number ranges are never changed or deleted. If a name is taken already (ignoring upper / lower case), the new entry gets a number: `ORDERS` becomes `ORDERS_2`, `aem-dev` becomes `aem-dev (2)`. The confirmation lists these names, and you can rename the entries afterwards. Imported number ranges start at their first number.
- **All or nothing.** The file gets the same checks as the apps (URL and message VPN of direct brokers, variable names, number range limits, text lengths, ...). If anything is wrong, nothing is imported and the message lists every problem, for example `broker "aem-dev": msgVpn: Message VPN is required`.

```json
{
  "format": "aem-suite.number-ranges",
  "version": 1,
  "numberRanges": [ { "name": "ORDERS", "description": "Sales orders", "prefix": "SO-", "length": 10, "start": 4500000001, "step": 1 } ]
}
```

The other formats are `aem-suite.brokers` with a list `brokers` and `aem-suite.variables` with a list `variables` – export once to see all fields.

---

## 3. Global variables (Admin)

**Global Variables** contains values that every test case can use, e.g. `app = shop`. Use them in topics and payloads as `{{app}}`. Names may contain letters, digits, `_ . -` and must be unique. To copy them to another system, use **Export** and **Import** – see [Export and import the configuration](#export-and-import-the-configuration).

---

## 4. Organize test cases in folders

The **Test Cases** list is a tree: folders can contain test cases and other folders.

| Action | How |
|---|---|
| Create a folder | **Create → Folder**. Select a folder first to create it inside that folder. |
| Create a test case | **Create → Test Case** (inside the selected folder, or on top level if nothing is selected) |
| Move | **drag & drop** a row onto a folder, or **Cut** and **Paste** |
| Change order | drag & drop between rows, or **Move Up / Move Down**. Folders are always shown before test cases. |
| Copy | select one or more rows → **Copy** (or **Copy** on the test case / folder page). A folder is copied **with everything below it** (subfolders, test cases, variables, user properties). The copy is named "… (Copy)" and placed right after the original. If you select a folder and something inside it, that is copied once, with the folder. |
| Export | select rows → **Export** (nothing selected = everything), or **Export** on a test case / folder page. Saves a JSON file; folders come **with everything below them**. See *Export and import* below. |
| Import | **Import** → choose a JSON file. It is checked first and you confirm what will be added. It goes **into the selected folder** (select exactly one folder first) or to the top level. |
| Expand / collapse | arrow in front of a folder |
| Delete a folder | **Delete** – this deletes the folder **with all its content** |

Rules: test cases cannot contain anything, and a folder cannot be moved into itself.

**Folder page**: a folder has a name, a description and **variables**. Folder variables apply to all test cases inside the folder and its subfolders – handy for values that a whole group shares (e.g. `domain = orders`).

### Export and import

Use a file to **back up** test cases, **share** them with colleagues, move them between systems (dev → test → prod) or keep them in Git.

- The file is plain **JSON**. Folders contain their children, so it reads like the tree. It holds everything that defines a test: topic, payload, delivery mode, TTL, priority, correlation ID, ACK timeout, user properties and variables (also the variables of folders). It does **not** hold results, authors, internal IDs or anything about brokers.
- **Import never changes existing items.** Everything in the file is added as new test cases and folders, behind the existing ones. Importing the same file twice gives two copies.
- **All or nothing.** The file gets the same checks as the apps (valid JSON payload, property types, ACK timeout range, text length, ...). If anything is wrong, **nothing** is imported and the message lists every problem with its place in the file, for example `Orders / Order created: payload: Payload is not valid JSON`.
- Files can be written or generated by hand: `kind` may be left out (a node with `children` is a folder), a payload may be a JSON object instead of text, and property values may be numbers. Files up to 5 MB and 5 000 items are accepted.

Short example of a file:

```json
{
  "format": "aem-suite.test-cases",
  "version": 1,
  "nodes": [
    {
      "kind": "FOLDER",
      "name": "Orders",
      "variables": [{ "name": "domain", "value": "orders" }],
      "children": [
        {
          "kind": "TEST",
          "name": "Order created",
          "topic": "{{domain}}/created/{{uuid}}",
          "payload": "{\"orderId\":\"{{uuid}}\"}",
          "deliveryMode": "PERSISTENT",
          "userProperties": [{ "name": "source", "value": "demo" }]
        }
      ]
    }
  ]
}
```

**Columns** in the list: Type (Folder / Test Case), Topic, **Last Result** and **Last Run** (outcome of the latest run of this test case), Delivery Mode, Changed At.

**Filter "Created By"**: the list opens with your own entries. Remove the value (✕) or enter another user and press **Go/Start** to see the test cases of others.

---

## 5. Create and edit a test case

**Create → Test Case** opens the test case page in edit mode.

### Message

| Field | Notes |
|---|---|
| **Topic** (required) | The topic to publish to, e.g. `{{app}}/orders/{{region}}/created/v1/{{uuid}}`. Variables are allowed, wildcards (`*`, `>`) are not. Type `{{` for suggestions, as in the payload. The topic is one line: **Enter** adds no line break and **Tab** moves on to the next field. |
| **Name** | Optional. It follows the topic while you type; once you enter your own name, it stays. |

### Payload

A JSON editor with:

- **Valid JSON / Invalid JSON** indicator – placeholders like `{{qty}}` are allowed, also outside strings (`"qty": {{qty}}`).
- **Format** – pretty-prints the JSON (placeholders are kept).
- **(?)** – list of all template expressions; click one to copy it.
- **Suggestions** – type `{{` and a list opens with everything the payload can use: the variables of this test case, its folders, the brokers and the global variables (with where each value comes from – point at an entry to see the value and all places it is defined), temporary variables of this payload (`as name`), the built-ins, the number ranges (with their next number) and the faker.js expressions (with an example). Keep typing to narrow the list – `{{faker.person.` shows the person methods – and press **Enter** or click an entry to insert it with the closing `}}`.

New test cases start with a small sample payload.

### Advanced (click *Show more*)

| Field | Default | Meaning |
|---|---|---|
| Description | – | free text |
| Delivery Mode | Persistent | **Persistent (Guaranteed)**: passes when the broker acknowledges. **Direct**: passes when the message was sent. |
| Correlation ID | `{{uuid}}` | set on the message |
| Content Type | `application/json` | clear it to have it detected from the payload |
| ACK Timeout (ms) | 5000 | how long to wait for the broker acknowledgement |
| Time to Live (ms) | empty | empty or 0 = no expiry |
| Priority | empty | 0–255, empty = broker default |
| DMQ Eligible | empty | empty = broker default |

### User Properties

Name, type and value of SMF user properties. Values may contain variables. Leave the type empty to have it detected (`42` → Integer, `true` → Boolean, otherwise String).

### Variables

Variables that apply only to this test case; they win over all others.

### Preview

**Preview** shows the message exactly as it would be sent – topic, payload, correlation ID and user properties with all variables resolved for the selected broker. Nothing is sent. Works while editing, too.

**Save** the test case before running it.

---

## 6. Run tests

You can run:

- one test case – **Run…** on its page,
- several test cases or whole folders – select them in the list → **Run…**. A folder runs **all test cases inside it, including subfolders**, in the order of the tree.

The **Run dialog**:

1. **Select brokers** – the brokers of your last run are preselected. Each selected test case is sent once to each selected broker. With many brokers, type in the search field above the list (name, user or VPN): it narrows the list, and brokers you already selected stay in it. The small icon in front of each broker shows how it logs in: a **cloud** for a BTP destination (nothing to enter), a **key** for direct input (password for the run).
2. **Credentials** – for every selected *direct* broker a password field appears ("used for this run only, not stored"). If the broker has no username maintained, a **username** field appears next to it. Destination brokers need nothing.
3. **Advanced settings** (optional, click to open) – see below.
4. **Run** – progress is shown live (e.g. `3 / 6`, passed / failed).
5. When finished: green **Finished** if all passed, red otherwise, with a **Problems** list (test case @ broker + reason).
6. **Open Results** jumps to the run in *Test Runs*.

You can close the dialog at any time – the run continues on the server. **Stop run** (while it runs) ends it early.

### Advanced settings

For repeating a message, simulating traffic or watching a flow over time:

| Setting | Meaning |
|---|---|
| **Repetitions** | How often **every** test case is sent to **every** broker (1 – 1000, default 1). Variables, `{{uuid}}`, number ranges and faker values are resolved anew for every message, so each one is different. |
| **Pause between messages** | Wait (0 – 60 000 ms) between two messages to the same broker – not before the first one. Brokers run in parallel, so the pause does not add up across brokers. |
| **Order** (with more than one repetition) | **Whole selection**: a, b, c, a, b, c … (like mixed traffic). **Each test case**: a, a, a, b, b, b … |
| **Stop at the first failure** | After a message failed, the rest of **that broker** is not sent (status **SKIPPED**). Other brokers go on. |

The dialog shows what you are about to start, for example *"30 or more messages … the pauses alone take about 2 min"* (a folder sends everything below it). Your settings are remembered for the next run.

**Stop run** ends a run early (the user who started it, or an administrator): messages not sent yet get the status **SKIPPED**. A message that is already on its way is finished. The run itself then ends **STOPPED** (shown as a warning), not as passed.

A run is limited (`cds.aemSuite.runs`): at most 1000 repetitions and 5000 messages (test cases × brokers × repetitions) per run.

### What do the results mean?

| Result | Meaning |
|---|---|
| **PASSED** | Persistent: the broker acknowledged the message. Direct: the message was sent. |
| **FAILED** | The broker rejected the message, or no acknowledgement arrived in time. |
| **ERROR** | The message could not be sent at all – e.g. unknown variable, invalid JSON, wrong password, broker not reachable. |
| **SKIPPED** | Not sent: the run was stopped, or an earlier message to this broker failed and *Stop at the first failure* was on. Skipped messages are not counted as failed. |

The **result of a whole run** is PASSED (all sent messages passed), FAILED (at least one failed, or the run was aborted on the server), STOPPED (you or an administrator stopped it and nothing failed before) or RUNNING.

PASSED means the broker accepted the message. It does not check whether a consumer received or processed it – use the Live Subscriber or saved messages for that.

---

## 7. Check results

**Test Runs** lists one row per test case × broker, newest run first:

- With repetitions, each row has its **Repetition** number (1 = the first message of that test case); rows are in the order they were sent.
- **Test Case** and **Broker** are separate columns and separate filters. Click a name to open that test case or broker configuration (the *Brokers* app needs the Admin role).
- **Status**: PASSED / FAILED / ERROR, with **ACK latency**, delivery mode, the resolved topic and the error message
- **Run Started** (click to open the whole run with its totals) and **Started By**

The list opens with **your** runs ("Started By" filter); remove the filter to see all runs.

Open a row to see the **resolved payload** that was actually sent - formatted, in a read-only code editor like the payload of a test case (a message that was never sent says so). Saved messages show their payload and user properties the same way. Open the run (click *Run Started*) to see all results of that run together with its totals.

The **Last Result** of each test case is also shown in the test case list and in the header of the test case page.

---

## 8. Watch messages live (Live Subscriber)

1. **Broker** – choose a broker. For direct brokers enter the password (it is not stored), and the username if the broker has none maintained.
2. **Source**:
   - **Topics** – one or more topic subscriptions. Type a topic and press **Enter** (or click **Add**) to put it on the list below the field; several topics separated by commas are added one by one. Click the **×** on a row to remove a topic. Topics you used before are suggested while you type. Wildcards are allowed: `*` = one level, `>` = all remaining levels. Example: `shop/orders/>`, `shop/*/updated/v1`.
   - **Browse Queue** – shows the messages in a queue **without removing them**.
   - **Consume Queue** – reads and **removes** the messages from the queue.
3. **Start**.

**Saved setups**: so you do not have to enter the same topics again, save what is on the page. Click **Save as…** next to *Saved setup*, give it a name and save. A setup holds the broker, the source, the topics (or the queue) and – if you typed one – the username. It **never holds a password**. Pick a setup from the list to fill the page again; **Save as…** with the same name updates it, the bin button deletes the selected one. Setups are yours: they are kept on the server, so they are there in every browser, and nobody else sees them.

Messages appear at the top of the list. Select one to see payload (formatted), user properties, correlation ID and delivery mode.

| Button | Effect |
|---|---|
| **Pause** | stops updating the list (messages are still counted) |
| **Clear** | empties the list |
| Filter field | filters by topic or payload text |
| **Copy Payload** | copies the payload |
| **Save** | keeps the message in *Saved Messages* |
| **Save as Test Case** | saves it and creates a test case from it (topic, payload, user properties) |
| **Stop** | ends the subscription |
| **Active Subscriptions** | shows your running subscriptions; stop forgotten ones |

Good to know:

- Broker, mode, topics and queue are remembered in your browser for next time. While a subscription is running, the form collapses to a one-line summary; click the title (or the arrow) to open it again.
- The list keeps the latest 500 messages. If more than 100 messages per second arrive, not all are displayed (you get a notice). Very large payloads are shortened in the display.
- You can run up to 5 subscriptions at the same time. A subscription ends automatically about 5 minutes after you close the browser tab.
- Messages from a topic subscription arrive as *DIRECT* even if they were published persistent – that is how the broker delivers to topic subscribers.

**Tip – end-to-end check**: start a subscription on your test topics (e.g. `shop/>`), then run your test cases in another tab and watch the messages arrive.

---

## 9. Saved messages

**Saved Messages** lists the messages you saved in the Live Subscriber (topic, broker, subscription/queue, received at, payload, properties).

- **Create Test Case** turns a message into a new test case (top level of the tree – move it into a folder afterwards).
- **Delete** removes saved messages.

---

## 10. Variables and templates

Write `{{name}}` anywhere in **topic, payload, correlation ID and user property values**.

### Where values come from (first match wins)

| Priority | Source | Typical use |
|---|---|---|
| 1 | test case variables | values for this one test |
| 2 | broker variables | environment-specific values (`region`, `tenant`) |
| 3 | folder variables (inner folder before outer) | values shared by a group of tests |
| 4 | global variables | values for everything (`app`) |
| 5 | built-ins | see below |

### Built-ins

| Expression | Result |
|---|---|
| `{{uuid}}` | a UUID – the **same** value in topic, payload and correlation ID of one message |
| `{{newUuid}}` | a new UUID every time it appears |
| `{{now}}` | current time, e.g. `2026-10-14T20:15:00.000Z` |
| `{{timestamp}}` | current time in milliseconds |
| `{{date}}` | current date, e.g. `2026-10-14` |
| `{{randomInt(1,100)}}` | random number between 1 and 100 |
| `{{broker.name}}`, `{{broker.msgVpn}}`, `{{broker.id}}` | the broker the message is sent to |
| `{{numberRange.ORDERS}}` | the next number of the number range *ORDERS*, e.g. `SO-000042` – see [Number ranges](#number-ranges-admin) |

Variables may contain other variables, e.g. `topicBase = {{app}}/{{region}}`.

### Example

Global variable `app = shop`, broker variable on *dev* `region = eu`, test case variable `qty = 5`:

```
Topic:   {{app}}/orders/{{region}}/created/v1/{{uuid}}
Payload: { "orderId": "{{uuid}}", "qty": {{qty}}, "createdAt": "{{now}}" }
```

sent to *dev* becomes

```
Topic:   shop/orders/eu/created/v1/6f1c…
Payload: { "orderId": "6f1c…", "qty": 5, "createdAt": "2026-10-14T20:15:00.000Z" }
```

If a variable cannot be found, the result is **ERROR** with "Unknown variable(s): …" – use **Preview** to check before running.

### Number ranges (Admin)

Real SAP messages carry identifiers such as sales order `SO-000042` or a delivery number `0080001234`. A **number range** hands out numbers like these – one more with every message, and the counter is kept for you. Maintain them in the app **Number Ranges** (role Admin).

| Field | Meaning |
|---|---|
| **Name** | how you use it: `{{numberRange.<name>}}`. Letters, digits, `_` and `-`, e.g. `ORDERS` |
| **Prefix**, **Suffix** | plain text in front of / after the number, e.g. `SO-` |
| **Digits** | length of the number, filled with leading zeros (`6` gives `000042`; `0` = no leading zeros) |
| **First Number**, **Step** | where the range starts and by how much it grows (e.g. start `4500000000`, step `1`) |
| **Last Allowed Number** | optional end of the range. When it is reached (or the number no longer fits into the digits), runs stop with an error |

The page shows what the **next number** will look like, the **last number issued** and when a run used the range last. **Reset** sets the next number (empty = back to the first number) – for example to start a new test series from the beginning. **Count Up** issues the next number just like a run would, **Count Down** gives the last issued number back so the next run gets it again – handy to try out a new range without sending a message.

The counter is stored in the database: every message of a run that uses the range takes its own number, also when the broker later rejects the message, and a number is never handed out twice. A run that cannot connect to a broker sends nothing and takes no numbers. The Preview shows the next number without using it up.

Number ranges can be moved to another system with **Export** and **Import** (the counter is not part of the file): see [Export and import the configuration](#export-and-import-the-configuration).

Use the range in topic, payload, correlation ID or user properties:

```
Topic:   shop/orders/created/v1/{{numberRange.ORDERS}}
Payload: { "orderNumber": "{{numberRange.ORDERS}}", "customer": "{{numberRange.CUSTOMERS}}" }
```

- Every message gets **its own** number: running a test case twice, or on two brokers, uses numbers 42, 43, ….
- Within **one message** the same `{{numberRange.ORDERS}}` is always the same number, in topic, payload and properties alike.
- **Preview** shows the number the message would get, **without** using it up. Only a real run takes a number.
- If a run fails after the number was taken (for example the broker rejects the message), the number is not given out again.

Need the same generated number several times, or two different numbers from one range, in one message? Give it a **temporary variable** with `as`:

```
{
  "orderNumber": "{{numberRange.ORDERS as orderNo}}",
  "reference":   "{{orderNo}}",
  "items": [ { "order": "{{orderNo}}", "pos": 10 } ],
  "followUp":    "{{numberRange.ORDERS as followUpNo}}"
}
```

`orderNo` and `followUpNo` are two different numbers of the range `ORDERS`; `{{orderNo}}` can be used anywhere in the message, also before the line that defines it. Temporary variables live for one message only.

### Test data with faker

For realistic names, addresses or e-mail addresses there is **faker**: `{{faker.<module>.<method>}}`. Every message gets new values.

| Expression | Example result |
|---|---|
| `{{faker.person.fullName}}` | `Dagmar Keeling` |
| `{{faker.person.firstName}}`, `{{faker.person.lastName}}` | first / last name |
| `{{faker.internet.email}}` | `Letizia.Eggenmueller@example.org` |
| `{{faker.company.name}}` | a company name |
| `{{faker.location.city}}`, `{{faker.location.streetAddress}}`, `{{faker.location.zipCode}}`, `{{faker.location.country}}` | address parts |
| `{{faker.phone.number}}` | a phone number |
| `{{faker.commerce.productName}}`, `{{faker.commerce.price}}` | product data |
| `{{faker.finance.iban}}`, `{{faker.finance.currencyCode}}` | finance data |
| `{{faker.date.past}}`, `{{faker.date.future}}` | a date, written like `2026-03-14T09:21:47.000Z` |
| `{{faker.string.uuid}}`, `{{faker.string.numeric(8)}}`, `{{faker.string.alpha(5)}}` | random text |
| `{{faker.number.int(1,100)}}` | a whole number between 1 and 100 |
| `{{faker.lorem.sentence}}`, `{{faker.lorem.words(3)}}` | filler text |

- The full list is the [faker.js documentation](https://fakerjs.dev/api/) – the expressions are `faker.` + module + method. Available modules: airline, animal, color, commerce, company, database, date, finance, git, hacker, internet, location, lorem, music, number, person, phone, science, string, system, vehicle, word.
- Arguments are plain: numbers, `true` / `false` or text (`{{faker.person.firstName('female')}}`). `number.int(min,max)`, `number.float(min,max)` and `finance.amount(min,max)` take the two limits.
- Like numbers, the same expression gives **the same value everywhere in one message** (the e-mail in the topic and in the payload match). Use `as` for a value of its own or to reuse one: `{{faker.person.fullName as buyer}}` ... `{{buyer}}`; a second `{{faker.person.fullName as seller}}` is another person.
- The **language** of the data (names, cities, ...) is a server setting, `cds.aemSuite.faker.locale` – for example `de`, `fr`, `es`, `en_GB`. Default is English.
- **Preview** shows example values; a run generates new ones.
- A wrong expression (`{{faker.person.nope}}`) gives the result **ERROR** with the reason.

---

## 11. Use an AI assistant (MCP)

The suite can be connected to an AI assistant (for example Claude Code or another tool that supports the *Model Context Protocol*). The assistant can then **look at your test cases and brokers, plan new tests, preview messages, run tests and explain the results** – you describe what you want in plain language.

**What the assistant can do**

| | |
|---|---|
| Look | read test cases, folders, variables of folders, brokers (name and description only), runs and results |
| Plan | create and change folders and test cases, move and copy them – with the same checks as in the apps (e.g. the payload must be valid JSON) |
| Check | **preview** a message exactly as it would be sent to a broker |
| Run | run test cases or whole folders, wait for the result, list what failed and why |

**What it cannot do (on purpose)**

- **No deleting**, and no access to global variables, broker variables or saved messages.
- **No passwords, ever – so no runs on direct brokers.** For those you enter a password for every run, and a password typed into an AI chat would be stored in logs. The assistant sees all brokers, but can only preview and run tests on active brokers that use a **BTP destination** (*Credentials: BTP Destination*). For direct brokers it tells you to run the tests in the app; never give it a password.
- **No connection data.** The assistant sees brokers by name and description only. URLs, hosts, message VPNs, users and destination names are shown to it as `<hidden>`, also inside error messages.
- **Only brokers you allow.** Destination brokers with *Available for AI Agents* switched off (Brokers app) cannot be used by it.
- **No personal data.** It does not see who created a test case or started a run. When you want to see more, it gives you a **link**: it opens the test case or the run in the app, in your browser, where you are logged in.
- At most 100 results (test cases × brokers) per run, 2 runs at a time and 30 runs per hour per user.

**How it works**

The assistant talks to the suite over the *Model Context Protocol* (MCP), an open standard for giving AI tools access to an application. The suite offers one MCP address; your AI client connects to it and shows the assistant three tools:

| Tool | Used for |
|---|---|
| `TestAgentService-describe` | learn what exists (test cases, brokers, runs …) and which actions are possible |
| `TestAgentService-query` | read data: "which tests failed last time?" |
| `TestAgentService-call` | do something: create / change / move / copy, preview, run |

You do not use these tools yourself. You write what you want in the chat of your AI client; the assistant picks the tools, most clients ask you to confirm each call, and the assistant tells you the result. It acts **with your user and your role** (Tester) – it can do nothing you could not do in the apps.

**Connect**

The address is `<your app>/mcp/agent` (the same host as the launchpad); you need the **Tester** role. The assistant logs you in with your normal BTP login – you never copy a token by hand.

1. Get the **client ID** and **client secret** of the app from your administrator. They identify the app, not you, and are the same for everyone.
2. Add the server, for example in Claude Code:

   ```sh
   claude mcp add --transport http --client-id <client ID> --client-secret --callback-port 8765 aem-suite https://<your app>/mcp/agent
   ```

   The command asks for the client secret.
3. Start the assistant and log in: in Claude Code run `/mcp`, choose `aem-suite` and **Authenticate**. A browser window opens with the BTP login; after you sign in, the assistant is connected. The login is renewed automatically; when it has expired, authenticate again the same way.

This needs a space deployed for development and testing (with `dev.mtaext`); productive spaces do not accept the local callback. Ask your administrator if the login fails with a redirect error.

Other assistants work the same way if they support MCP with OAuth: enter the address, client ID, client secret and the callback address `http://localhost:8765/callback`.

The assistant acts as **you**: it sees and may do exactly what your roles allow, and everything it creates is stored under your user.

*Local development* (`npm run watch`) has no BTP login; use the demo login `tester:tester` instead:

```sh
claude mcp add --transport http aem-suite http://localhost:4004/mcp/agent --header "Authorization: Basic dGVzdGVyOnRlc3Rlcg=="
```

For **GitHub Copilot** in VS Code the repository contains `.vscode/mcp.json` with the same address and demo login. Start `npm run watch`, open the file and click **Start** above the server (or *MCP: List Servers*), then switch Copilot Chat to **Agent** mode – `aem-suite` appears under the tools.

**Things you can ask**

- *"Which test cases exist for orders, and which of them failed last time?"*
- *"Create a folder 'Inventory' with a test case for `acme/inventory/updated/v1/{{sku}}`, payload with sku and quantity, and show me how it looks for broker `aem-dev`."*
- *"Run all tests in the folder Orders on `aem-dev` and tell me what failed."*
- *"Copy the folder Orders to 'Orders EU' and change the variable `region` to `eu`."*

**Good to know**

- Everything the assistant creates shows up in the apps like your own test cases (created by *your* user).
- Messages, topics and error texts from the broker are only shown to the assistant as data; it is told never to follow instructions found in them. Still: connect only assistants you trust, and look at what it plans to run.
- Every change the assistant makes is logged on the server (who, what – never payloads or passwords).

---

## 12. Clean up old data (Admin)

Runs, results and saved messages pile up over time. The app **Data Cleanup** (role Admin) deletes what is no longer needed – always in two steps: **Preview** shows what would go, **Delete…** removes it after you confirm.

Switch on what you want to clean up and set how old it must be – **older than** a number of days, weeks, months or years, or **before** a date (at least one day ago). Months and years go by the calendar.

| What | Removes | More criteria |
|---|---|---|
| **Test runs** | whole runs with all their results. Runs that are still running are never touched; the *last result* of a test case stays | result (passed / failed / stopped), started by, brokers, text in the run name, **always keep the newest N runs** |
| **Run payloads** | only the sent payloads of the results – runs and results stay visible. Frees most space | as for test runs |
| **Saved messages** | messages kept from the Live Subscriber, of all users | brokers, saved by, source (topics / queue), text in the topic |
| **Subscriber setups** | saved setups not changed for a long time | users, brokers, only setups of inactive brokers |
| **Orphans** | rows left over from deleted brokers and test cases – of any age | which kinds |

**Preview** lists per kind how many rows match and from which date on; **Show** opens the newest of them. Change anything afterwards and the preview is outdated – preview again before deleting. **Delete…** lists the counts once more; above 1,000 rows you type the number to confirm. If more rows match by then than the preview showed (someone ran tests in the meantime), nothing is deleted and you are asked to preview again.

Deleting cannot be undone. Every cleanup is recorded on the tab **History**: when, by whom, what and how many rows – also cleanups that failed half way (*Partly done*: the kinds finished before the error stay deleted).

**Saved rules**: a selection you need again – say "payloads older than 30 days, runs older than a year" – can be kept with **Save as…** and loaded from **Saved rule** next time. Saving under an existing name updates that rule.

## 13. Tips and troubleshooting

| Message / situation | What to do |
|---|---|
| *Password required for broker …* | Enter the password for every direct broker in the dialog. |
| *Username required for broker …* | The broker has no username maintained – enter one in the dialog (or maintain it on the broker). |
| *Connect failed: …* | Wrong URL, VPN, username or password, or the broker is not reachable. Use **Test Connection** on the broker. |
| *No broker acknowledgement within … ms* | The broker did not confirm in time. Try again, increase *ACK Timeout*, or ask your admin to check the broker. |
| *Rejected by broker: …* | The broker refused the message (e.g. no subscriber with "reject on no subscription", queue full, missing permissions). |
| *Unknown variable(s): …* | Define the variable (test case, folder, broker or global) or fix the spelling. **Preview** shows it. |
| *Payload is not valid JSON* | Fix the JSON, or clear *Content Type* if the payload is plain text. |
| *Test cases can only be placed in folders* | Drop items onto folders or the top level, not onto test cases. |
| *The selected folders contain no test cases* | The folder is empty. |
| *Run…* is disabled | Save your draft first, or select at least one row. |
| I don't see test cases or runs of colleagues | Remove the "Created By" / "Started By" filter. |
| Live Subscriber shows "WebSocket offline" | Connection to the server lost – it reconnects automatically; reload the page if it persists. |
| Run is still RUNNING after a long time | Brokers that do not answer are timed out by the connect timeout of the broker; check *Test Runs* again later. |

---

## 14. Click guides

Step by step, in the order you will probably need them. **Admin** in a title means the steps need the Admin role; all others work with the Tester role. The pictures were made with the demo data of the suite; the element to click is framed in orange.

> **About the pictures of runs:** they were made without a broker that answers, so the messages end with an *error* (red). With a reachable broker you see the green **PASSED** instead - everything else looks the same.

### Get access and open the suite

1. Ask your BTP administrator for the role collection **AEM_Suite_Tester** (testing) or **AEM_Suite_Admin** (testing and setup). Administrators assign it in the BTP cockpit: *your subaccount → Security → Role Collections →* click the role collection *→ Edit → Users →* enter the user ID (and the identity provider) *→ Save*.
2. Open the launchpad of the suite (the link your administrator gives you) and sign in. If you have just received a role, **sign out and in again** - the roles are part of your login.
3. The **Home** page opens. Click a tile to open an app. No tiles, or "You have no role for the AEM Test Suite yet"? The role collection is not assigned to you yet, or you have not logged in again.
4. Every page has a **Help** button at the top right: it opens this guide at the matching place in a new tab.

### Add a broker with direct input (Admin)

Use this when the broker is entered in the app and the password is typed whenever it is needed (it is never saved).

1. Open **Brokers** (Home → *Administration* → **Brokers**) and click **Create**.

   ![The Brokers list with the Create button](images/guides/broker-1-list.png)

2. Fill in the form:
   - **Name** - how you will find the broker everywhere, e.g. `Dev broker`.
   - **Credentials** - leave **DIRECT** (the other choice, DESTINATION, is the next guide).
   - **URL** - the host is enough, e.g. `mr-abc123.messaging.solace.cloud`.
   - **Message VPN** - e.g. `dev-vpn`.
   - **Username** - the client username, e.g. `solace-cloud-client`. Leave it empty if every user should enter their own when running.
   - Leave **Active** ticked. Open the tab *Broker Variables* if values should differ per broker (see [Variables and templates](#10-variables-and-templates)).

   ![The filled form of a direct broker](images/guides/broker-2-form.png)

   Where do I find the connection data? In the AEM console: *Cluster Manager → your service → Connect → Solace Web Messaging* (host, message VPN, username).
3. Click **Create** at the bottom. The broker is saved and its page opens.

   ![The saved broker with the Test Connection button](images/guides/broker-3-saved.png)

4. Check that it works: click **Test Connection**, enter the **password** and click **Test**. The result shows in the header (*Last Connection Test*): **OK**, or the reason (wrong password, VPN, host not reachable ...).

   ![The password dialog of the connection test](images/guides/broker-4-test-connection.png)

### Add a broker from a BTP destination (Admin)

Use this when nobody should ever type a password: the technical user and its password are kept in BTP.

1. In the **BTP cockpit**: *your subaccount → Connectivity → Destinations → Create Destination* (or **Import Destination** with the file from [Brokers from a BTP destination](#brokers-from-a-btp-destination)).
2. Fill in: **Name** (e.g. `aem-dev`), **Type** `HTTP`, **URL** `https://<host of the broker>:443`, **Proxy Type** `Internet`, **Authentication** `BasicAuthentication`, **User** and **Password** of the technical user. Click **New Property** and add `msgVpn` = the message VPN. **Save**.
3. In the suite open **Brokers → Create**. Enter a **Name**, set **Credentials** to **DESTINATION** and choose your destination in **Destination** (the list shows the URL and VPN of each).
4. Click **Create** at the bottom. The connection is tested right away; the result shows in the header.
5. Decide whether an AI assistant may use this broker: **Available for AI Agents** is on by default - switch it off for production brokers.

### Create a global variable (Admin)

A global variable is a value every test case can use, written `{{name}}` in a topic or payload.

1. Open **Global Variables** and click **Create**.

   ![The Global Variables list](images/guides/variables-1-list.png)

2. Enter a **Name** (letters, digits, `_`, `.`, `-`) and a **Value**, e.g. `customer` = `ACME`. Click **Create** at the bottom.

   ![A new global variable](images/guides/variables-2-form.png)

3. Use it in a test case as `{{customer}}`. Values that should differ per broker go to the tab *Broker Variables* of that broker, values for a group of tests to the *Variables* of a folder.

### Create a number range (Admin)

A number range hands out numbers like SAP document numbers (`SH-00001000`, `SH-00001001`, ...), one more with every message.

1. Open **Number Ranges** and click **Create**.
2. Enter **Name** (this is how you use it: `{{numberRange.SHIPMENTS}}`), **Prefix** (`SH-`), **Digits** (`8` - the number is filled with zeros), **First Number** (`1000`). **Step** and **Last Allowed Number** are optional.

   ![The form of a number range](images/guides/numberrange-1-form.png)

3. Click **Create** at the bottom. The page shows what the **next number** looks like and the **last number issued**.

   ![A saved number range with its status](images/guides/numberrange-2-saved.png)

4. Use `{{numberRange.SHIPMENTS}}` in a topic or payload. The buttons **Count Up**, **Count Down** and **Reset** move the counter, for example to start a test series again.

### Create a folder and a test case

1. Open **Test Cases**. To put the test case into a folder, first create the folder: click **Create ▾ → Folder**, enter a **Folder name**, click **Create** at the bottom. (Select a folder in the list first to create a folder inside it.)
2. Select the folder (click its row) and click **Create ▾ → Test Case**.

   ![The Create menu of the test case list](images/guides/testcase-1-create-menu.png)

3. Enter the **Topic**, e.g. `shop/orders/{{region}}/created/v1/{{uuid}}`. The **Name** follows the topic until you type your own. Wildcards (`*`, `>`) are not allowed in a topic you publish to.

   ![The topic of a test case](images/guides/testcase-2-topic.png)

4. Scroll to **Payload** and change the JSON. Type `{{` and a list of everything you can use opens - variables, built-ins, number ranges, faker data. Keep typing to narrow it, press **Enter** to take an entry.

   ![Suggestions while typing {{ in the payload](images/guides/testcase-3-suggestions.png)

5. Click **Preview**, choose a broker and click **Resolve**: you see the topic, payload and properties exactly as they would be sent - nothing is sent yet.

   ![The preview of a test case](images/guides/testcase-4-preview.png)

6. Click **Create** at the bottom to save. (Under *Show more* / the tabs **Advanced**, **User Properties** and **Variables** you find delivery mode, time to live, user properties and variables of this test case.)

### Run test cases and read the result

1. In **Test Cases** tick the test cases or folders you want to run (a folder runs everything inside it) and click **Run…**. On a test case page, click **Run…** at the top.

   ![Rows selected, the Run button](images/guides/run-1-select.png)

2. In the dialog, tick the **brokers**. For every *direct* broker a **Password** field appears (and a *Username* field if the broker has none) - used for this run only. Destination brokers need nothing.
3. Click **Run**. The progress shows live (`3 / 6`, passed / failed).

   ![The run dialog with the advanced settings open](images/guides/run-2-dialog.png)

4. When it is **Finished**, the dialog lists the problems (test case @ broker + reason). Click **Open Results**.

   ![A finished run](images/guides/run-3-finished.png)

5. The run opens with one row per test case and broker. Click a row to see the **resolved payload** that was really sent, the topic, the ACK latency and - if it failed - the error text.

   ![The results of a run](images/guides/results-1-run.png)

6. Later you find all runs under **Test Runs** (newest first; your own by default). Filter by test case, broker or status; click a test case or broker name to open it.

   ![The Test Runs list](images/guides/results-2-list.png)

What do PASSED, FAILED and ERROR mean? See [What do the results mean?](#what-do-the-results-mean).

### Repeat a message and pace it

For load, for flows over time, or to see how stable a broker is:

1. Select the test cases and click **Run…**, tick the brokers.
2. Click **Advanced settings** and set:
   - **Repetitions** - how often every test case is sent to every broker (up to 1000);
   - **Pause between messages** - in milliseconds, between two messages to the same broker;
   - **Order** - *Whole selection* (a, b, c, a, b, c) or *Each test case* (a, a, a, b, b, b);
   - **Stop at the first failure** - the rest of that broker is skipped after a failed message.
3. The dialog tells you what you are about to start ("30 or more messages ... the pauses alone take about 2 min"). Click **Run**.
4. Need to end it early? Click **Stop run** - messages not sent yet are skipped.

Variables, `{{uuid}}`, number ranges and faker values are resolved anew for **every** message, so every repetition differs.

### Watch a topic live and keep the setup

1. Open **Live Subscriber**. Choose the **Broker** and enter the password (and username) if it is a direct broker.
2. Under **Source** choose **Topics**, type a topic, e.g. `shop/orders/>`, and click **Add**. Add more topics the same way (`*` is one level, `>` everything below).

   ![Topics entered in the Live Subscriber](images/guides/subscriber-1-topics.png)

3. Click **Start**. Messages appear on the left; click one to see payload, properties and delivery mode on the right.
4. So you do not have to enter all of this again: click **Save as…**, give the setup a name and click **Save**. Next time pick it in **Saved setup**. A setup keeps the broker, topics and username - never the password.

   ![Saving a setup](images/guides/subscriber-2-save-setup.png)

5. Click **Stop** when you are done. A forgotten subscription ends by itself about 5 minutes after you close the page.

**End-to-end check:** start the subscription on your test topics, run your test cases in another tab and watch the messages arrive.

### Turn a received message into a test case

1. In the **Live Subscriber** select a message and click **Save** (keeps it in *Saved Messages*) or **Save as Test Case** (does both).
2. Open **Saved Messages**; click a message.

   ![The list of saved messages](images/guides/messages-1-list.png)

3. Click **Create Test Case**. The test case (topic, payload, properties) appears at the top level of **Test Cases** - drag it into a folder.

   ![A saved message with the Create Test Case button](images/guides/messages-2-page.png)

### Move tests to another system

To copy test cases from dev to test, share them with a colleague or keep them in Git:

1. In **Test Cases** tick the folders or test cases (nothing ticked exports everything) and click **Export**. A JSON file is downloaded.

   ![Export and Import in the toolbar of the test case list](images/guides/export-1-toolbar.png)

2. In the other system open **Test Cases**, select the folder the tests should go into (or none for the top level), click **Import** and choose the file. The file is checked first; you confirm what will be added. Nothing is imported if anything is wrong.
3. Brokers, global variables and number ranges have **Export** and **Import** in their own apps (no passwords are in the file).

### Clean up old data (Admin)

1. Open **Data Cleanup**.
2. Switch on what to clean (test runs, run payloads, saved messages, subscriber setups, orphans) and set **older than** (days, weeks, months, years) or **before** a date.
3. Click **Preview**: you see how many rows would be deleted, per kind.

   ![The Data Cleanup page](images/guides/cleanup-1-form.png)

4. Click **Delete…** and confirm. The cleanup is recorded on the tab **History**. A selection you use often can be kept with **Save as…** (*Saved rule*).

### Connect an AI assistant

1. Ask your administrator for the address of the suite and the client ID and secret for the assistant (see [Use an AI assistant (MCP)](#11-use-an-ai-assistant-mcp)).
2. **GitHub Copilot (VS Code):** create `.vscode/mcp.json` in your workspace with the server address (`type: http`, `url: https://<your app>/mcp/agent`), click **Start** above the entry, open the Copilot chat in **Agent** mode and check that the `aem-suite` tools appear.
3. **Claude Code:** run `claude mcp add --transport http aem-suite https://<your app>/mcp/agent` and authenticate with `/mcp`.
4. Log in with your normal BTP login when the browser asks. Then ask in plain language, e.g. *"Run all tests in the folder Orders on aem-dev and tell me what failed."*

---

## 15. The screens at a glance

### Home

The start page. At the top the **greeting** and shortcuts (*Open Test Cases*, *Watch live*, *User guide*). **Needs attention** lists what is wrong (failed results, a broker that failed its last test) - **OK** hides a notice until the situation changes. The tiles open the apps, grouped into **Testing** and **Administration**; **Latest Runs** shows the last runs (click one to open it).

### Test Cases

| Area | What it does |
|---|---|
| Filter bar | search, *Created By* (starts with your own entries), name, topic, delivery mode |
| Toolbar | **Run…**, **Copy**, **Export**, **Import**, **Create ▾** (Folder / Test Case), **Delete**, **Cut**, **Paste**, **Move Up / Move Down** |
| Tree table | folders and test cases; the icon shows the type; **Last Result** and **Last Run At** show the latest outcome |
| Test case page | header with *Last Result* and the buttons **Edit**, **Delete**, **Run…**, **Copy**, **Export**, **Help**, **Preview**; tabs **Message**, **Payload**, **Advanced**, **User Properties**, **Variables** |
| Folder page | **Folder name** and the **Variables** that apply to everything inside |

### Test Runs

A list with one row per test case and broker (columns: run, test case, broker, repetition, status, ACK latency, delivery mode, topic, error, started by). Click a name to open the test case or broker, click the run to see all its results, click a row for the **resolved payload** in a read-only code editor.

### Live Subscriber

| Area | What it does |
|---|---|
| **Saved setup** | pick, **Save as…** or delete a setup (broker, source, topics, username) |
| **Broker**, password / username | where to listen; direct brokers ask for the password here |
| **Source** | **Topics**, **Browse Queue** (does not remove messages) or **Consume Queue** (removes them) |
| Topic list | enter a topic, **Add**; ✕ removes one |
| **Start** / **Stop** | begins and ends the subscription; **Active Subscriptions** lists your running ones |
| Message list and detail | **Pause**, **Clear**, a filter field; the detail shows payload, properties and **Save** / **Save as Test Case** |

### Saved Messages

The messages you kept: broker, topic, source, received at. Open one for payload and properties (code editors), **Create Test Case** turns it into a test case, **Delete** removes it.

### Brokers (Admin)

| Area | What it does |
|---|---|
| List | name, status of the last connection test, URL, VPN, credentials; **Create**, **Test Connection**, **Delete**, **Export**, **Import** |
| Page, tab **Connection** | **General** (Name, Description, Credentials, Active, Available for AI Agents), **Direct Connection** (URL, Message VPN, Username) or **BTP Destination**, **Advanced** (Client Name Prefix, Connect Timeout) |
| Tab **Broker Variables** | values that apply only to this broker |
| Header | **Last Connection Test**: status, time, message |

### Global Variables (Admin)

A list of **Name** and **Value**; **Create**, **Delete**, **Export**, **Import**.

### Number Ranges (Admin)

| Field | Meaning |
|---|---|
| **Name** | used as `{{numberRange.NAME}}` |
| **Prefix** / **Suffix** | text before / after the number |
| **Digits** | length, filled with leading zeros |
| **First Number**, **Step**, **Last Allowed Number** | where it starts, how it grows, where it ends |
| **Status** | next number, last number issued, last use; buttons **Count Up**, **Count Down**, **Reset** |

### Data Cleanup (Admin)

The tab **Clean Up** (what to delete and how old, **Preview**, **Delete…**, saved rules) and the tab **History** (every cleanup: when, by whom, what, how many).

### Help

This guide with the contents on the left and a search that highlights what it finds. Pictures can be clicked to read them larger in a new tab.
