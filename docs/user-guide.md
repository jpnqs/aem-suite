# AEM Test Suite – User Guide

The AEM Test Suite lets you test **SAP Advanced Event Mesh** brokers without writing code:
save messages as **test cases**, send them to one or several brokers with one click, see immediately whether each broker accepted them, and **watch topics and queues live**.

---

## Contents

1. [Getting started](#1-getting-started)
2. [Set up brokers (Admin)](#2-set-up-brokers-admin)
3. [Global variables (Admin)](#3-global-variables-admin)
4. [Organize test cases in folders](#4-organize-test-cases-in-folders)
5. [Create and edit a test case](#5-create-and-edit-a-test-case)
6. [Run tests](#6-run-tests)
7. [Check results](#7-check-results)
8. [Watch messages live (Live Subscriber)](#8-watch-messages-live-live-subscriber)
9. [Saved messages](#9-saved-messages)
10. [Variables and templates](#10-variables-and-templates)
11. [Tips and troubleshooting](#11-tips-and-troubleshooting)

---

## 1. Getting started

Open the launchpad. Depending on your role you see these tiles:

| Tile | What for | Role |
|---|---|---|
| **Test Cases** | create, organize and run test cases | Tester |
| **Test Runs** | results of all runs | Tester |
| **Live Subscriber** | watch topics and queues live | Tester |
| **Saved Messages** | messages you kept from the live subscriber | Tester |
| **Brokers** | connections to the brokers | Admin |
| **Global Variables** | variables for all test cases | Admin |

Your administrator assigns the roles (**AEM_Suite_Tester** or **AEM_Suite_Admin**). Admins can do everything testers can.

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
| **Destination** (destination mode) | choose from the list (shows URL and VPN) |
| **Active** | inactive brokers are hidden in run and subscribe dialogs |
| Advanced | client name prefix, connect timeout |

> **Passwords are never saved.** For direct brokers you enter the password when you run tests, test the connection or start a subscription. It is used only for that action.

**Test Connection**: on the broker page, click **Test Connection** (enter the password for direct brokers, and the username if none is maintained on the broker). The result is shown in the header ("Last Connection Test") and in the broker list. Destination brokers are tested automatically when you save them.

**Broker variables**: on the broker page, section *Broker Variables* – values that apply only when sending to this broker (e.g. `region = eu` for the EU broker). See [section 10](#10-variables-and-templates).

Where do I find the connection data? In the AEM console: *Cluster Manager → your service → Connect → Solace Web Messaging / Solace Messaging* (host, port, message VPN, username).

---

## 3. Global variables (Admin)

**Global Variables** contains values that every test case can use, e.g. `app = shop`. Use them in topics and payloads as `{{app}}`. Names may contain letters, digits, `_ . -` and must be unique.

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
| Expand / collapse | arrow in front of a folder |
| Delete a folder | **Delete** – this deletes the folder **with all its content** |

Rules: test cases cannot contain anything, and a folder cannot be moved into itself.

**Folder page**: a folder has a name, a description and **variables**. Folder variables apply to all test cases inside the folder and its subfolders – handy for values that a whole group shares (e.g. `domain = orders`).

**Columns** in the list: Type (Folder / Test Case), Topic, **Last Result** and **Last Run** (outcome of the latest run of this test case), Delivery Mode, Changed At.

**Filter "Created By"**: the list opens with your own entries. Remove the value (✕) or enter another user and press **Go/Start** to see the test cases of others.

---

## 5. Create and edit a test case

**Create → Test Case** opens the test case page in edit mode.

### Message

| Field | Notes |
|---|---|
| **Topic** (required) | The topic to publish to, e.g. `{{app}}/orders/{{region}}/created/v1/{{uuid}}`. Variables are allowed, wildcards (`*`, `>`) are not. |
| **Name** | Optional. It follows the topic while you type; once you enter your own name, it stays. |

### Payload

A JSON editor with:

- **Valid JSON / Invalid JSON** indicator – placeholders like `{{qty}}` are allowed, also outside strings (`"qty": {{qty}}`).
- **Format** – pretty-prints the JSON (placeholders are kept).
- **(?)** – list of all template expressions; click one to copy it.

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

1. **Select brokers** – the brokers of your last run are preselected. Each selected test case is sent once to each selected broker.
2. **Credentials** – for every selected *direct* broker a password field appears ("used for this run only, not stored"). If the broker has no username maintained, a **username** field appears next to it. Destination brokers need nothing.
3. **Run** – progress is shown live (e.g. `3 / 6`, passed / failed).
4. When finished: green **Finished** if all passed, red otherwise, with a **Problems** list (test case @ broker + reason).
5. **Open Results** jumps to the run in *Test Runs*.

You can close the dialog at any time – the run continues on the server.

### What do the results mean?

| Result | Meaning |
|---|---|
| **PASSED** | Persistent: the broker acknowledged the message. Direct: the message was sent. |
| **FAILED** | The broker rejected the message, or no acknowledgement arrived in time. |
| **ERROR** | The message could not be sent at all – e.g. unknown variable, invalid JSON, wrong password, broker not reachable. |

PASSED means the broker accepted the message. It does not check whether a consumer received or processed it – use the Live Subscriber or saved messages for that.

---

## 7. Check results

**Test Runs** lists one row per test case × broker, newest run first:

- **Test Case** and **Broker** are separate columns and separate filters. Click a name to open that test case or broker configuration (the *Brokers* app needs the Admin role).
- **Status**: PASSED / FAILED / ERROR, with **ACK latency**, delivery mode, the resolved topic and the error message
- **Run Started** (click to open the whole run with its totals) and **Started By**

The list opens with **your** runs ("Started By" filter); remove the filter to see all runs.

Open a row to see the **resolved payload** that was actually sent. Open the run (click *Run Started*) to see all results of that run together with its totals.

The **Last Result** of each test case is also shown in the test case list and in the header of the test case page.

---

## 8. Watch messages live (Live Subscriber)

1. **Broker** – choose a broker. For direct brokers enter the password (it is not stored), and the username if the broker has none maintained.
2. **Source**:
   - **Topics** – one or more topic subscriptions, comma-separated, wildcards allowed: `*` = one level, `>` = all remaining levels. Example: `shop/orders/>, shop/*/updated/v1`.
   - **Browse Queue** – shows the messages in a queue **without removing them**.
   - **Consume Queue** – reads and **removes** the messages from the queue.
3. **Start**.

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

- Broker, mode, topics and queue are remembered in your browser for next time.
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

---

## 11. Tips and troubleshooting

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
