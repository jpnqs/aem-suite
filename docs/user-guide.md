# AEM Test Suite – User Guide

The AEM Test Suite tests **SAP Advanced Event Mesh** brokers without code: save messages as **test cases**, send them to one or several brokers with one click, see at once whether each broker accepted them, and **watch topics and queues live**.

Every chapter starts with the clicks, step by step (the element to click is framed in orange in the pictures), followed by what is good to know.

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
  - [The fields](#the-fields)
- [6. Run tests](#6-run-tests)
  - [Advanced settings](#advanced-settings)
  - [What do the results mean?](#what-do-the-results-mean)
- [7. Check results](#7-check-results)
- [8. Watch messages live (Live Subscriber)](#8-watch-messages-live-live-subscriber)
- [9. Saved messages](#9-saved-messages)
- [10. Variables and templates](#10-variables-and-templates)
  - [Number ranges (Admin)](#number-ranges-admin)
  - [Test data with faker](#test-data-with-faker)
- [11. Use an AI assistant (MCP)](#11-use-an-ai-assistant-mcp)
- [12. Clean up old data (Admin)](#12-clean-up-old-data-admin)
- [13. Tips and troubleshooting](#13-tips-and-troubleshooting)

---

## 1. Getting started

**Get access**

1. Ask your BTP administrator for the role collection **AEM_Suite_Tester** (create and run tests) or **AEM_Suite_Admin** (also set up brokers, variables, number ranges and clean up). Administrators assign it in the BTP cockpit: *subaccount → Security → Role Collections →* the role collection *→ Edit → Users →* add the user *→ Save*.
2. Open the launchpad link of the suite and sign in. Just received a role? **Sign out and in again** – roles are part of the login.
3. The **Home** page opens. Click a tile to open an app.

**The apps**

| App | What for | Role |
|---|---|---|
| **Home** | the state of the suite at a glance, your apps, the latest runs | everyone |
| **Test Cases** | create, organize and run test cases | Tester |
| **Test Runs** | results of all runs | Tester |
| **Live Subscriber** | watch topics and queues live | Tester |
| **Saved Messages** | messages kept from the Live Subscriber | Tester |
| **Brokers** | connections to the brokers | Admin |
| **Global Variables** | values for all test cases | Admin |
| **Number Ranges** | document numbers (like SAP) for your messages | Admin |
| **Data Cleanup** | delete old runs, messages and setups | Admin |
| **Help** | this guide, with a search | everyone |

On **Home** the tiles are grouped into **Testing** and **Administration**. **Needs attention** lists what is wrong (failed results, a broker whose connection test failed); **OK** hides a notice until the situation changes, **Show again** brings it back.

Every page has a **Help** button at the top right: it opens the matching part of this guide in a new tab, so you keep your work.

**The usual way**

1. An admin adds the brokers once ([chapter 2](#2-set-up-brokers-admin)).
2. You create test cases, optionally in folders ([chapters 4–5](#4-organize-test-cases-in-folders)).
3. You select test cases or a folder → **Run…** → choose brokers → **Run** ([chapter 6](#6-run-tests)).
4. Problems show in the run dialog, all details in **Test Runs** ([chapter 7](#7-check-results)).
5. To see what really arrives on a topic, use the **Live Subscriber** ([chapter 8](#8-watch-messages-live-live-subscriber)).

**Terms**

| Term | Meaning |
|---|---|
| **Broker** | an AEM event broker service (more exactly: one message VPN on it) |
| **Message VPN** | a separate area on a broker, with its own users, topics and queues |
| **Topic** | the address a message is published to, e.g. `shop/orders/eu/created/v1`. Subscriptions may use wildcards: `*` one level, `>` everything below |
| **Queue** | keeps messages until a consumer takes them; fed by topic subscriptions |
| **Persistent / Direct** | delivery mode: *persistent* (guaranteed) messages are acknowledged by the broker, *direct* ones are fire and forget |
| **ACK** | the broker's confirmation that it took a persistent message; *ACK latency* is how long that took |
| **TTL**, **DMQ** | time to live of a message; the dead message queue that expired messages go to |
| **Variable** | a value written `{{name}}` in topics and payloads, filled in when the message is sent |

---

## 2. Set up brokers (Admin)

A broker is either entered here (**direct**: the password is typed whenever it is needed, never saved) or taken from a **BTP destination** (nobody types a password; see [below](#brokers-from-a-btp-destination)).

**Step by step (direct)**

1. Open **Brokers** and click **Create**.

   ![The Brokers list with the Create button](images/guides/broker-1-list.png)

2. Enter **Name**, **URL**, **Message VPN** and – if all users share one – **Username**. Leave **Credentials** on **DIRECT** and **Active** ticked.

   ![The filled form of a direct broker](images/guides/broker-2-form.png)

3. Click **Create** at the bottom. The broker page opens.

   ![The saved broker with the Test Connection button](images/guides/broker-3-saved.png)

4. Click **Test Connection**, enter the password, click **Test**. The header shows the result (*Last Connection Test*).

   ![The password dialog of the connection test](images/guides/broker-4-test-connection.png)

**The fields**

| Field | What to enter |
|---|---|
| **Name** | how the broker is shown everywhere, e.g. `dev`, `qa-eu` |
| **Credentials** | **DIRECT** (Direct Input) or **DESTINATION** (BTP Destination) |
| **URL** | the host is enough, e.g. `mr-xyz.messaging.solace.cloud` – it becomes `wss://…:443`; with port `55443` `tcps://`, with `55555` `tcp://` |
| **Message VPN** | e.g. `dev-vpn` |
| **Username** | optional (often `solace-cloud-client`). Empty: every user enters a username together with the password |
| **Active** | inactive brokers are not offered for runs and subscriptions |
| **Available for AI Agents** | destination brokers only: may an AI assistant use it? Switch it off for production |
| **Client Name Prefix**, **Connect Timeout (ms)** | under *Advanced*; rarely needed |

Where is the connection data? In the AEM console: *Cluster Manager → your service → Connect → Solace Web Messaging*.

**Good to know**

- **Passwords are never saved.** They are used for the one run, connection test or subscription they were entered for.
- **Test Connection** also works for several brokers at once: select them in the list. Destination brokers are tested right away, and also automatically when they are saved.
- **Broker variables** (tab *Broker Variables*) are values that apply only to this broker, e.g. `region = eu` – see [chapter 10](#10-variables-and-templates).

### Brokers from a BTP destination

The technical user of the broker and its password are kept in BTP; runs, tests, subscriptions and the AI assistant log in as that user.

1. In the **BTP cockpit**: *subaccount → Connectivity → Destinations → Create Destination*.
2. Fill in:

   | Field | Value | Example |
   |---|---|---|
   | **Name** | any name | `aem-dev` |
   | **Type** / **Proxy Type** | `HTTP` / `Internet` | |
   | **URL** | the web messaging endpoint (the cockpit wants `https://`, the suite connects with `wss://`) | `https://mr-xyz.messaging.solace.cloud:443` |
   | **Authentication** | `BasicAuthentication` | |
   | **User**, **Password** | the technical user of the broker | `solace-cloud-client` |
   | **New Property** `msgVpn` | the message VPN – required | `dev-vpn` |
   | **New Property** `smfUrl` | optional: connect with this URL instead, e.g. SMF over TLS | `tcps://mr-xyz.messaging.solace.cloud:55443` |

   Or save this as a file and use **Import Destination** (then enter the password):

   ```properties
   Name=aem-dev
   Type=HTTP
   URL=https\://mr-xyz.messaging.solace.cloud\:443
   ProxyType=Internet
   Authentication=BasicAuthentication
   User=solace-cloud-client
   Password=<password of the technical user>
   msgVpn=dev-vpn
   ```

3. In the suite: **Brokers → Create**, **Credentials** = **DESTINATION**, pick the destination (the list shows URL and VPN), **Create**. The connection is tested at once.

> **The technical user decides what the tests may do.** Give it an ACL profile that allows the topics you test – and nothing more on production brokers.

### Export and import the configuration

Brokers, global variables and number ranges can be saved as a JSON file – to set up a second system the same way, as a backup or to keep them in Git. Each of the three apps has **Export** and **Import** above its list.

- **Export**: select rows → **Export** (nothing selected = all). No passwords, no IDs, no connection status; number ranges without their counter.
- **Import**: **Import** → choose a file exported from the same app. It is checked and you confirm what will be added.
- **Import only adds.** Existing entries are never changed. A name that is taken gets a number (`ORDERS_2`, `aem-dev (2)`); the confirmation lists these.
- **All or nothing.** If anything in the file is wrong, nothing is imported and the message lists every problem.

---

## 3. Global variables (Admin)

A global variable is a value every test case can use, written `{{name}}`, e.g. `{{app}}`.

1. Open **Global Variables** and click **Create**.

   ![The Global Variables list](images/guides/variables-1-list.png)

2. Enter **Name** and **Value**, click **Create** at the bottom.

   ![A new global variable](images/guides/variables-2-form.png)

Names may contain letters, digits, `_ . -` and must be unique. Values that differ per broker belong to the broker (*Broker Variables*), values for a group of tests to a folder. **Export** / **Import** copy them to another system ([see above](#export-and-import-the-configuration)).

---

## 4. Organize test cases in folders

The **Test Cases** list is a tree: folders contain test cases and other folders. The list opens with **your** entries (filter *Created By*); remove the filter (✕) to see those of your colleagues.

| To … | do this |
|---|---|
| create a folder | **Create ▾ → Folder**, enter *Folder name*, **Create** at the bottom. Select a folder first to create it inside. |
| create a test case | **Create ▾ → Test Case** (inside the selected folder) – see [chapter 5](#5-create-and-edit-a-test-case) |
| move | **drag & drop** onto a folder, or **Cut** and **Paste** |
| change the order | drag & drop between rows, or **Move Up / Move Down** (folders always come first) |
| copy | select rows → **Copy**. A folder is copied **with everything in it** as "… (Copy)". |
| delete | select rows → **Delete**. A folder is deleted **with everything in it**. |

![The Create menu of the test case list](images/guides/testcase-1-create-menu.png)

**Folder variables** (on the folder page) apply to all test cases inside the folder and its subfolders – handy for values a group shares, e.g. `domain = orders`.

The columns **Last Result** and **Last Run At** show the outcome of the latest run of each test case.

### Export and import

To copy test cases to another system, share them or keep them in Git:

1. Select folders or test cases (nothing selected = everything) and click **Export**. A JSON file is downloaded.

   ![Export and Import in the toolbar of the test case list](images/guides/export-1-toolbar.png)

2. In the other system select the target folder (or nothing for the top level), click **Import** and choose the file. It is checked and you confirm.

- The file holds everything that defines a test – topic, payload, settings, user properties, variables (also of folders) – but no results, authors or broker data.
- **Import only adds**: importing a file twice gives two copies. **All or nothing**: if anything is wrong, nothing is imported and every problem is listed with its place, e.g. `Orders / Order created: payload: Payload is not valid JSON`.

---

## 5. Create and edit a test case

### Create a test case

1. In **Test Cases** select the folder and click **Create ▾ → Test Case**.
2. Enter the **Topic**, e.g. `shop/orders/{{region}}/created/v1/{{uuid}}`. The **Name** follows the topic until you type your own.

   ![The topic of a test case](images/guides/testcase-2-topic.png)

3. Change the **Payload**. Type `{{` and a list opens with everything you can use – variables (with where each value comes from), built-ins, number ranges, faker data. Keep typing to narrow it, **Enter** takes an entry.

   ![Suggestions while typing {{ in the payload](images/guides/testcase-3-suggestions.png)

4. Click **Preview**, choose a broker, **Resolve**: you see the message exactly as it would be sent. Nothing is sent.

   ![The preview of a test case](images/guides/testcase-4-preview.png)

5. Click **Create** at the bottom to save.

### Change a test case

Open it, click **Edit**, change, click **Save** at the bottom. **Discard Draft** throws your changes away. An unsaved draft is kept while you are away; others see that you are editing.

### The fields

| Field | Default | Meaning |
|---|---|---|
| **Topic** | – (required) | where to publish. Variables yes, wildcards (`*`, `>`) no. One line: **Enter** adds nothing, **Tab** moves on. |
| **Name** | the topic | your own name stays once you typed it |
| **Payload** | a small sample | JSON editor: **Valid / Invalid JSON** status, **Format**, **(?)** lists all expressions. Placeholders may also stand outside strings: `"qty": {{qty}}` |
| **Description** | – | free text (under *Show more* / tab **Advanced**) |
| **Delivery Mode** | Persistent | **Persistent (Guaranteed)**: passes when the broker acknowledges. **Direct**: passes when sent. |
| **Correlation ID** | `{{uuid}}` | set on the message |
| **Content Type** | `application/json` | empty = detected from the payload |
| **ACK Timeout (ms)** | 5000 | how long to wait for the acknowledgement |
| **Time to Live (ms)**, **Priority**, **DMQ Eligible** | empty | empty = no expiry / broker default |
| **User Properties** | – | name, type and value of SMF user properties; values may use variables; an empty type is detected (`42` Integer, `true` Boolean, else String) |
| **Variables** | – | values for this test case only – they win over all others |

Save before running – a draft cannot be run.

---

## 6. Run tests

**Step by step**

1. In **Test Cases** tick test cases or folders (a folder runs everything inside it, in tree order) and click **Run…** – or **Run…** on a test case page.

   ![Rows selected, the Run button](images/guides/run-1-select.png)

2. Tick the **brokers** (those of your last run are preselected; type in the search field to find one). The icon shows how a broker logs in: **cloud** = BTP destination, nothing to enter; **key** = direct, enter the **password** (and username if asked) – for this run only.
3. Optional: open **Advanced settings** (see below). Click **Run**.

   ![The run dialog with the advanced settings open](images/guides/run-2-dialog.png)

4. Progress shows live. When it is **Finished** (green if all passed), the problems are listed. **Open Results** shows the run in *Test Runs*.

   ![A finished run (here without a reachable broker, so every message ended with an error)](images/guides/run-3-finished.png)

You can close the dialog at any time – the run goes on. **Stop run** ends it early.

### Advanced settings

| Setting | Meaning |
|---|---|
| **Repetitions** | how often **every** test case is sent to **every** broker (1 – 1000). Variables, `{{uuid}}`, number ranges and faker values are new for every message. |
| **Pause between messages** | 0 – 60 000 ms between two messages to the same broker. Brokers run in parallel. |
| **Order** | **Whole selection**: a, b, c, a, b, c … **Each test case**: a, a, a, b, b, b … |
| **Stop at the first failure** | after a failed message the rest of **that broker** is not sent (*SKIPPED*) |

The dialog tells you what you are about to start ("30 or more messages … the pauses alone take about 2 min") and remembers your settings. A run has at most 5000 messages.

### What do the results mean?

| Result | Meaning |
|---|---|
| **PASSED** | persistent: the broker acknowledged the message. Direct: it was sent. |
| **FAILED** | the broker rejected the message, or no acknowledgement came in time |
| **ERROR** | not sent at all – unknown variable, invalid JSON, wrong password, broker not reachable … |
| **SKIPPED** | not sent: the run was stopped, or *Stop at the first failure* |

A whole run ends **PASSED**, **FAILED**, **STOPPED** (stopped by you, nothing failed before) or is still **RUNNING**.

PASSED means the broker **accepted** the message – not that a consumer processed it. To see that, use the Live Subscriber.

---

## 7. Check results

**Test Runs** has one row per message: test case, broker, repetition, status, ACK latency, topic and error. Newest first; **your** runs by default (filter *Started By*).

![The Test Runs list](images/guides/results-2-list.png)

- Click a **test case** or **broker** name to open it, the **run** to see all its results with the totals.
- Click a row for the details: the **resolved payload** that was really sent (formatted, read-only), topic, correlation ID and the error text.

   ![The results of a run](images/guides/results-1-run.png)

- The **Last Result** of each test case is also shown in the test case list and on its page.

---

## 8. Watch messages live (Live Subscriber)

**Step by step**

1. Open **Live Subscriber** and choose the **Broker** (enter the password for a direct broker).
2. **Source**: **Topics** – type a topic, **Add**; add as many as you need. Or **Browse Queue** (shows messages, leaves them in the queue) or **Consume Queue** (takes them out of the queue).

   ![Topics entered in the Live Subscriber](images/guides/subscriber-1-topics.png)

3. Click **Start**. New messages appear on the left; click one for payload, properties and delivery mode on the right.
4. Keep the setup for next time: **Save as…**, a name, **Save**. Next time pick it under **Saved setup**. A setup holds broker, source, topics and username – **never a password**.

   ![Saving a setup](images/guides/subscriber-2-save-setup.png)

5. **Stop** when you are done.

| Button | Effect |
|---|---|
| **Pause** / **Clear** | stop updating the list / empty it |
| Filter field | filter by topic or payload text |
| **Copy Payload** | copy the payload of the selected message |
| **Save** / **Save as Test Case** | keep the message in *Saved Messages* / and create a test case from it |
| **Active Subscriptions** | your running subscriptions; stop forgotten ones |

**Good to know**

- Wildcards: `*` = one level, `>` = everything below, e.g. `shop/orders/>`.
- Up to 5 subscriptions at a time. One ends by itself about 5 minutes after you close the page.
- The list keeps the latest 500 messages; above 100 messages per second not all are shown.
- Messages from a topic subscription arrive as *Direct*, even if they were published persistent.
- **End-to-end check**: subscribe to your test topics, run your test cases in another tab and watch them arrive.

---

## 9. Saved messages

Messages you kept in the Live Subscriber (**Save** or **Save as Test Case**).

1. Open **Saved Messages** and click a message.

   ![The list of saved messages](images/guides/messages-1-list.png)

2. **Create Test Case** turns it into a test case (topic, payload, user properties) at the top level of **Test Cases** – drag it into a folder.

   ![A saved message with the Create Test Case button](images/guides/messages-2-page.png)

**Delete** removes saved messages you no longer need.

---

## 10. Variables and templates

Write `{{name}}` in **topic, payload, correlation ID and user property values**; it is replaced when the message is sent. Check with **Preview** before running.

### Where values come from (first match wins)

| Priority | Source | Typical use |
|---|---|---|
| 1 | test case variables | values for this one test |
| 2 | broker variables | per environment (`region`, `tenant`) |
| 3 | folder variables (inner folder first) | values a group of tests shares |
| 4 | global variables | values for everything (`app`) |
| 5 | built-ins | below |

Variables may contain other variables, e.g. `topicBase = {{app}}/{{region}}`.

### Built-ins

| Expression | Result |
|---|---|
| `{{uuid}}` | a UUID – the **same** in topic, payload and correlation ID of one message |
| `{{newUuid}}` | a new UUID every time it appears |
| `{{now}}`, `{{timestamp}}`, `{{date}}` | the time as `2026-10-14T20:15:00.000Z`, in milliseconds, the date `2026-10-14` |
| `{{randomInt(1,100)}}` | a random whole number from 1 to 100 |
| `{{broker.name}}`, `{{broker.msgVpn}}`, `{{broker.id}}` | the broker the message goes to |
| `{{numberRange.ORDERS}}` | the next number of the range *ORDERS* – [below](#number-ranges-admin) |
| `{{faker.person.fullName}}` … | realistic test data – [below](#test-data-with-faker) |

### Example

Global `app = shop`, broker variable on *dev* `region = eu`, test case variable `qty = 5`:

```
Topic:   {{app}}/orders/{{region}}/created/v1/{{uuid}}
Payload: { "orderId": "{{uuid}}", "qty": {{qty}}, "createdAt": "{{now}}" }
```

becomes on *dev*:

```
Topic:   shop/orders/eu/created/v1/6f1c…
Payload: { "orderId": "6f1c…", "qty": 5, "createdAt": "2026-10-14T20:15:00.000Z" }
```

An unknown variable gives the result **ERROR** with "Unknown variable(s): …".

### Number ranges (Admin)

A number range hands out numbers like SAP document numbers (`SO-4500000001`, `SO-4500000002` …), one more with every message.

1. Open **Number Ranges**, click **Create**. Enter **Name**, **Prefix**, **Digits**, **First Number** (**Step**, **Suffix** and **Last Allowed Number** are optional).

   ![The form of a number range](images/guides/numberrange-1-form.png)

2. Click **Create** at the bottom. The tab **Status** shows the **next number** and the **last number issued**.

   ![A saved number range with Count Up, Count Down and Reset](images/guides/numberrange-2-saved.png)

3. Use it in a test case: `{{numberRange.SHIPMENTS}}`.

| Field / button | Meaning |
|---|---|
| **Name** | used as `{{numberRange.NAME}}`; letters, digits, `_`, `-` |
| **Prefix**, **Suffix** | text in front of / after the number |
| **Digits** | length, filled with zeros (`6` → `000042`; `0` = no zeros) |
| **First Number**, **Step**, **Last Allowed Number** | start, increment, optional end. At the end (or when the digits are not enough) runs stop with an error. |
| **Count Up** / **Count Down** | take the next number / give the last one back – to try a range without sending |
| **Reset** | set the next number (empty = back to the first number), e.g. for a new test series |

- Every message takes **its own** number: a test case run twice, or on two brokers, uses 42, 43, …; within **one** message the same expression is the same number.
- A number is never handed out twice – also not when the broker later rejects the message. **Preview** shows the next number without using it up.
- **Temporary variables** with `as` reuse one number or take a second one:

  ```
  "orderNumber": "{{numberRange.ORDERS as orderNo}}",
  "reference":   "{{orderNo}}",
  "followUp":    "{{numberRange.ORDERS as followUpNo}}"
  ```

  `orderNo` and `followUpNo` are two different numbers; `{{orderNo}}` works anywhere in the message, also before its definition.

### Test data with faker

Realistic names, addresses and more: `{{faker.<module>.<method>}}`, new values with every message.

| Expression | Example |
|---|---|
| `{{faker.person.fullName}}`, `{{faker.person.firstName}}`, `{{faker.person.lastName}}` | `Dagmar Keeling` |
| `{{faker.internet.email}}` | `Letizia.Eggenmueller@example.org` |
| `{{faker.company.name}}`, `{{faker.phone.number}}` | a company, a phone number |
| `{{faker.location.city}}`, `{{faker.location.streetAddress}}`, `{{faker.location.zipCode}}`, `{{faker.location.country}}` | address parts |
| `{{faker.commerce.productName}}`, `{{faker.commerce.price}}`, `{{faker.finance.iban}}` | product and finance data |
| `{{faker.date.past}}`, `{{faker.date.future}}` | a date like `2026-03-14T09:21:47.000Z` |
| `{{faker.number.int(1,100)}}`, `{{faker.string.numeric(8)}}`, `{{faker.string.uuid}}` | numbers and random text |
| `{{faker.lorem.sentence}}` | filler text |

- All methods: [faker.js documentation](https://fakerjs.dev/api/) – `faker.` + module + method.
- Arguments are plain: numbers, `true`/`false` or text, e.g. `{{faker.person.firstName('female')}}`.
- The same expression is the **same value in one message**; `as` gives a value of its own: `{{faker.person.fullName as buyer}}` … `{{buyer}}`.
- The language of the data is set by your administrator (English by default).

---

## 11. Use an AI assistant (MCP)

Connect an AI assistant (e.g. Claude Code, or GitHub Copilot for local development) and describe in plain language what you want: it **looks at test cases, brokers and results, plans new tests, previews messages, runs tests and explains the results** – with your user and your role.

**What it can and cannot do**

| | |
|---|---|
| **Can** | read test cases, folders, brokers (name and description), runs and results; create, change, move and copy folders and test cases (same checks as the apps); preview; run and report what failed |
| **Cannot** | delete anything; see global or broker variables, saved messages, connection data (shown as `<hidden>`) or who created what; use passwords – so it runs only on active **destination** brokers with *Available for AI Agents* on |
| **Limits** | 100 results per run, 2 runs at a time, 30 runs per hour per user |

**Connect (deployed suite)**

1. Ask your administrator for the address (`https://<your app>/mcp/agent`) and the **client ID** and **client secret** of the app (the same for everyone; they identify the app, not you).
2. Add the server, e.g. in Claude Code (it asks for the secret):

   ```sh
   claude mcp add --transport http --client-id <client ID> --client-secret --callback-port 8765 aem-suite https://<your app>/mcp/agent
   ```

3. In Claude Code run `/mcp`, choose `aem-suite`, **Authenticate**, and sign in with your BTP login in the browser.

Other assistants with MCP and OAuth work the same way (address, client ID, secret, callback `http://localhost:8765/callback`). The login needs a space deployed for development and testing; ask your administrator if it fails with a redirect error.

**Local development** (`npm run watch`, demo login `tester:tester`):

```sh
claude mcp add --transport http aem-suite http://localhost:4004/mcp/agent --header "Authorization: Basic dGVzdGVyOnRlc3Rlcg=="
```

For **GitHub Copilot** the repository has `.vscode/mcp.json`: open it, click **Start** above the server, switch Copilot Chat to **Agent** mode – `aem-suite` appears under the tools.

**Things you can ask**

- *"Which test cases exist for orders, and which of them failed last time?"*
- *"Create a folder 'Inventory' with a test case for `acme/inventory/updated/v1/{{sku}}` and show me how it looks for broker `aem-dev`."*
- *"Run all tests in the folder Orders on `aem-dev` and tell me what failed."*

What it creates is stored under your user. Broker messages and errors are shown to it only as data, never as instructions – still, connect only assistants you trust and look at what it plans to run.

---

## 12. Clean up old data (Admin)

Runs, results and saved messages pile up. **Data Cleanup** deletes what is no longer needed – always in two steps.

1. Open **Data Cleanup**. Switch on what to clean and set the **Age** (*older than* or *before* a date).

   ![The Data Cleanup page with Test runs switched on](images/guides/cleanup-1-form.png)

2. Click **Preview**: you see per kind how many rows would be deleted (**Show** opens the newest of them).
3. Click **Delete…** and confirm (above 1,000 rows you type the number). Deleting cannot be undone.

| What | Removes | More criteria |
|---|---|---|
| **Test runs** | runs with all results (never running ones; the *last result* of a test case stays) | result, started by, brokers, name, **keep the newest N** |
| **Run payloads** | only the sent payloads – frees most space, results stay | as for test runs |
| **Saved messages** | messages of all users | brokers, saved by, source, topic text |
| **Subscriber setups** | saved setups not changed for long | users, brokers |
| **Orphans** | leftovers of deleted brokers and test cases | which kinds |

- Change the selection and the preview is outdated – preview again. If more rows match at deletion time than previewed, nothing is deleted.
- Every cleanup is listed on the tab **History** (when, who, what, how many).
- A selection you need again: **Save as…**, later pick it under **Saved rule**.

---

## 13. Tips and troubleshooting

| Message / situation | What to do |
|---|---|
| No tiles, or *You have no role for the AEM Test Suite yet* | Ask for the role collection; sign out and in again after you got it. |
| Brokers, Global Variables … are missing | These need the Admin role. |
| *Password required* / *Username required for broker …* | Enter it for every direct broker in the dialog (or maintain the username on the broker). |
| *Connect failed: …* | Wrong URL, VPN, user or password, or the broker is not reachable – **Test Connection** on the broker shows which. |
| *No broker acknowledgement within … ms* | Try again, raise *ACK Timeout*, or ask your admin to check the broker. |
| *Rejected by broker: …* | The broker refused the message: missing permission (ACL), queue full, no subscriber with "reject on no subscription". |
| *Unknown variable(s): …* | Define the variable (test case, folder, broker or global) or fix the spelling – **Preview** shows it. |
| *Payload is not valid JSON* | Fix the JSON, or clear *Content Type* for plain text. |
| *Number range "…" is exhausted* | **Reset** the range or raise *Last Allowed Number* (Admin). |
| **Run…** is disabled | Save your draft, or select at least one row. |
| I don't see the test cases or runs of colleagues | Remove the filter *Created By* / *Started By*. |
| *WebSocket offline* in the Live Subscriber | The connection to the server dropped; it reconnects – reload the page if it stays. |
| A run stays *RUNNING* | A broker that does not answer is given up after its connect timeout; look again later or **Stop run**. |
| The app looks old after an update | Reload without cache: **Ctrl+F5** (Mac: **Cmd+Shift+R**). |
