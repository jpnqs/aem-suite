import DynamicPage from "sap/f/DynamicPage";
import Select, { Select$ChangeEvent } from "sap/m/Select";
import Input, { Input$LiveChangeEvent } from "sap/m/Input";
import Dialog from "sap/m/Dialog";
import Button from "sap/m/Button";
import Label from "sap/m/Label";
import ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";
import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import ListBinding from "sap/ui/model/ListBinding";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import Context from "sap/ui/model/odata/v4/Context";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import Table from "sap/m/Table";
import ColumnListItem from "sap/m/ColumnListItem";
import { SearchField$LiveChangeEvent } from "sap/m/SearchField";
import { ListBase$DeleteEvent, ListBase$SelectionChangeEvent } from "sap/m/ListBase";
import Actions from "../shared/Actions";
import Help from "../shared/Help";
import LiveSocket from "../shared/LiveSocket";
import Navigation from "../shared/Navigation";
import Prefs from "../shared/Prefs";

const MAX_MESSAGES = 500;
const FLUSH_MS = 250;
const HEARTBEAT_MS = 60 * 1000;
/** shared/Prefs key ("aem-suite.subscriber" in localStorage, as before) */
const PREFS_KEY = "subscriber";
const MAX_TOPIC_HISTORY = 30;
const MAX_BROKERS = 200;
/** the server allows a few per user (cds.aemSuite.subscriptions.maxPerUser) */
const MAX_SUBSCRIPTIONS = 50;
const { errorText, invokeAction } = Actions;

interface SubscriberPrefs {
  brokerId?: string;
  sourceType?: string;
  /** topics of the last subscription, comma separated */
  topicsText?: string;
  /** topics used before (most recent first) - offered as suggestions */
  topicHistory?: string[];
  queue?: string;
}

/** The model "state" of the page. */
interface SubscriberState {
  brokerId: string | null;
  /** the selected saved setup */
  presetId: string;
  sourceType: SourceType;
  topics: { text: string }[];
  topicHistory: { text: string }[];
  queue: string;
  password: string;
  needsPassword: boolean;
  username: string;
  needsUsername: boolean;
  enteredUsername: string;
  subscriptionId: string | null;
  /** what the running subscription listens to - every message keeps a copy */
  subscription: Origin | null;
  brokerName: string;
  sourceLabel: string;
  status: string;
  busy: boolean;
  paused: boolean;
  socketConnected: boolean;
  received: number;
  messages: LiveMessage[];
  selected: SelectedMessage | null;
}

type SourceType = "TOPIC" | "QUEUE_BROWSE" | "QUEUE_CONSUME";

/** The subscription a message was received on. */
interface Origin {
  brokerId: string;
  sourceType: SourceType;
  sourceLabel: string;
}

interface LiveMessage {
  origin: Origin;
  seq: number;
  time: string;
  receivedAt: string;
  topic: string;
  payload: string;
  contentType: string | null;
  userProperties: string;
  correlationId: string | null;
  deliveryMode: string;
  size: string;
  savedId?: string;
  /** the row is selected (bound two-way to the table row) */
  selected?: boolean;
}

interface SelectedMessage extends LiveMessage {
  prettyPayload: string;
  prettyProperties: string;
  propertyCount: number;
  receivedLocal: string;
  editorType: string;
}

/**
 * @namespace com.aem.suite.subscriber.controller
 */
export default class Main extends Controller {
  private state: JSONModel;
  private socket: LiveSocket;
  private buffer: LiveMessage[] = [];
  private flushTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  public onInit(): void {
    const prefs = loadPrefs();
    const initial: SubscriberState = {
      brokerId: prefs.brokerId ?? null,
      presetId: "",
      sourceType: (prefs.sourceType as SourceType) ?? "TOPIC",
      // topic subscriptions: a list of { text }; the input above the list adds to it
      topics: splitTopics(prefs.topicsText ?? "").map((text) => ({ text })),
      topicHistory: (prefs.topicHistory ?? []).map((text) => ({ text })),
      queue: prefs.queue ?? "",
      // password of DIRECT brokers: only in this page's memory until Start, never stored
      password: "",
      needsPassword: false,
      username: "",
      // DIRECT brokers without a maintained username: entered together with the password
      needsUsername: false,
      enteredUsername: "",
      subscriptionId: null,
      subscription: null,
      brokerName: "",
      sourceLabel: "",
      status: "Not subscribed",
      busy: false,
      paused: false,
      socketConnected: true,
      received: 0,
      messages: [],
      selected: null
    };
    this.state = new JSONModel(initial);
    this.state.setSizeLimit(MAX_MESSAGES);
    this.getView()!.setModel(this.state, "state");

    this.socket = new LiveSocket(
      (event, data) => this.onLiveEvent(event, data),
      (connected) => this.state.setProperty("/socketConnected", connected)
    );
    // the page shows the connection state from the start
    void this.socket.connect();
    this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
    window.addEventListener("beforeunload", this.onUnload);
    void this.preselectBroker();
  }

  /** The page state (a copy - change it with this.state.setProperty). */
  private data(): SubscriberState {
    return this.state.getData() as SubscriberState;
  }

  // ---------------------------------------------------------------- topics (list)

  // methods, not getters: the UI5 transpiler evaluates getters when the controller class is defined
  private topicInput(): Input {
    return this.byId("topics") as Input;
  }

  private topicList(): string[] {
    return ((this.state.getProperty("/topics") as { text: string }[]) ?? []).map((t) => t.text);
  }

  /** Appends topics to the list (trimmed, no duplicates). */
  private addTopics(texts: string[]): void {
    const topics = this.topicList();
    for (const text of texts.map((t) => t.trim())) if (text && !topics.includes(text)) topics.push(text);
    this.state.setProperty(
      "/topics",
      topics.map((text) => ({ text }))
    );
  }

  /** Enter, the Add button or a picked suggestion: the typed text (comma separated allowed) joins the list. */
  public onAddTopic(): void {
    const input = this.topicInput();
    const typed = splitTopics(input.getValue());
    this.addTopics(typed);
    input.setValue("");
    if (typed.length) input.focus();
  }

  /** A comma ends a topic, which also makes pasting "a, b, c" work. */
  public onTopicLiveChange(event: Input$LiveChangeEvent): void {
    const value = event.getParameter("value") ?? "";
    if (!value.includes(",")) return;
    const parts = value.split(",");
    const rest = parts.pop() ?? "";
    this.addTopics(parts);
    this.topicInput().setValue(rest.trimStart());
  }

  public onDeleteTopic(event: ListBase$DeleteEvent): void {
    const text = (event.getParameter("listItem") as ColumnListItem).getBindingContext("state")!.getProperty("text") as string;
    this.state.setProperty(
      "/topics",
      this.topicList()
        .filter((t) => t !== text)
        .map((t) => ({ text: t }))
    );
  }

  /** The list plus the text still being typed (so Start works without pressing Add first). */
  private collectTopics(): string[] {
    return [...new Set([...this.topicList(), ...splitTopics(this.topicInput().getValue())])];
  }

  private rememberTopics(topics: string[]): string[] {
    const history = [...topics, ...((this.state.getProperty("/topicHistory") as { text: string }[]) ?? []).map((h) => h.text)];
    const unique = [...new Set(history)].slice(0, MAX_TOPIC_HISTORY);
    this.state.setProperty(
      "/topicHistory",
      unique.map((text) => ({ text }))
    );
    return unique;
  }

  /** Keeps the remembered broker if it still exists, otherwise picks the first one. */
  private brokers: Record<string, { credentialMode: string; username: string }> = {};

  private async preselectBroker(): Promise<void> {
    try {
      const contexts = await this.odata()
        .bindList("/Brokers", undefined, [], [], { $select: "ID,credentialMode,username", $orderby: "name" })
        .requestContexts(0, MAX_BROKERS);
      this.brokers = Object.fromEntries(
        contexts.map((c) => [c.getProperty("ID") as string, c.getObject() as { credentialMode: string; username: string }])
      );
      const ids = Object.keys(this.brokers);
      const current = this.state.getProperty("/brokerId") as string | null;
      if (!current || !ids.includes(current)) this.state.setProperty("/brokerId", ids[0] ?? null);
      this.onBrokerChange();
    } catch {
      /* broker list unavailable - user selects manually */
    }
  }

  // ---------------------------------------------------------------- saved setups

  private presetBinding(): ODataListBinding {
    return (this.byId("preset") as Select).getBinding("items") as ODataListBinding;
  }

  private presetContexts(): Context[] {
    return this.presetBinding().getAllCurrentContexts();
  }

  /** A saved setup was picked: fills broker, source, topics / queue and username (the password is never part of it). */
  public async onPresetChange(event: Select$ChangeEvent): Promise<void> {
    // the key from the event: the binding to the state is updated only after this handler
    const key = event.getParameter("selectedItem")?.getKey();
    const ctx = this.presetContexts().find((c) => c.getProperty("ID") === key);
    if (!ctx) return;
    // the list of setups only read the names so far
    const [broker_ID, sourceType, topicsJson, queue, username] = (await ctx.requestProperty(["broker_ID", "sourceType", "topics", "queue", "username"])) as (string | undefined)[];
    const preset = { name: ctx.getProperty("name") as string, broker_ID, sourceType: sourceType as SourceType | undefined, topics: topicsJson, queue, username };
    this.state.setProperty("/sourceType", preset.sourceType ?? "TOPIC");
    let topics: string[] = [];
    try {
      topics = JSON.parse(preset.topics || "[]") as string[];
    } catch {
      /* ignore */
    }
    this.state.setProperty(
      "/topics",
      topics.map((text) => ({ text }))
    );
    this.state.setProperty("/queue", preset.queue ?? "");
    if (preset.broker_ID && this.brokers[preset.broker_ID]) {
      this.state.setProperty("/brokerId", preset.broker_ID);
      this.onBrokerChange();
    } else {
      MessageToast.show("The broker of this setup is not available (any more) - pick another one");
    }
    if (this.state.getProperty("/needsUsername")) this.state.setProperty("/enteredUsername", preset.username ?? "");
    MessageToast.show(`Setup "${preset.name}" loaded`);
  }

  /** Asks for a name and saves what is on the page; an existing name is updated. */
  public onSavePreset(): void {
    const s = this.data();
    const topics = this.collectTopics();
    if (!s.brokerId) return void MessageToast.show("Select a broker first");
    if (s.sourceType === "TOPIC" && !topics.length) return void MessageToast.show("Add at least one topic first");
    if (s.sourceType !== "TOPIC" && !s.queue?.trim()) return void MessageToast.show("Enter a queue name first");

    const current = (this.byId("preset") as Select).getSelectedItem()?.getText() ?? "";
    const name = new Input({ value: current, placeholder: "e.g. Orders on dev", maxLength: 100, width: "100%" });
    const dialog: Dialog = new Dialog({
      title: "Save setup",
      contentWidth: "26rem",
      content: [new Label({ text: "Name (an existing name is updated)", labelFor: name.getId() }), name],
      beginButton: new Button({
        text: "Save",
        type: "Emphasized",
        press: () => {
          void this.savePreset(name.getValue().trim(), topics).then((ok) => {
            if (ok) dialog.close();
          });
        }
      }),
      endButton: new Button({ text: "Cancel", press: () => dialog.close() }),
      afterClose: () => dialog.destroy()
    }).addStyleClass("sapUiContentPadding");
    this.getView()!.addDependent(dialog);
    dialog.open();
  }

  private async savePreset(name: string, topics: string[]): Promise<boolean> {
    if (!name) {
      MessageToast.show("Give the setup a name");
      return false;
    }
    const s = this.data();
    const data = {
      name,
      broker_ID: s.brokerId,
      sourceType: s.sourceType,
      topics: JSON.stringify(s.sourceType === "TOPIC" ? topics : []),
      queue: s.sourceType === "TOPIC" ? null : s.queue.trim(),
      // only a username that was typed in - a maintained one belongs to the broker
      username: s.needsUsername && s.enteredUsername?.trim() ? s.enteredUsername.trim() : null
    };
    try {
      const existing = this.presetContexts().find((c) => (c.getProperty("name") as string).toLowerCase() === name.toLowerCase());
      let id: string;
      if (existing) {
        for (const [k, v] of Object.entries(data)) if (k !== "name") existing.setProperty(k, v);
        await this.odata().submitBatch("$auto");
        id = existing.getProperty("ID") as string;
      } else {
        id = await this.create(this.presetBinding(), data);
      }
      this.state.setProperty("/presetId", id);
      MessageToast.show(existing ? `Setup "${name}" updated` : `Setup "${name}" saved`);
      return true;
    } catch (e) {
      // a rejected change would otherwise stay pending and be sent again with the next request
      await this.presetBinding().resetChanges().catch(() => undefined);
      MessageBox.error(errorText(e));
      return false;
    }
  }

  public onDeletePreset(): void {
    const key = this.state.getProperty("/presetId") as string;
    const ctx = this.presetContexts().find((c) => c.getProperty("ID") === key);
    if (!ctx) return;
    const name = ctx.getProperty("name") as string;
    MessageBox.confirm(`Delete the setup "${name}"?`, {
      title: "Delete setup",
      actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
      emphasizedAction: MessageBox.Action.DELETE,
      onClose: async (action: string | null) => {
        if (action !== MessageBox.Action.DELETE) return;
        try {
          await ctx.delete();
          this.state.setProperty("/presetId", "");
          MessageToast.show(`Setup "${name}" deleted`);
        } catch (e) {
          MessageBox.error(errorText(e));
        }
      }
    });
  }

  /** Shows the password field for DIRECT brokers, plus a username field if the broker has none. */
  public onBrokerChange(): void {
    const broker = this.brokers[this.state.getProperty("/brokerId") as string];
    const direct = !!broker && broker.credentialMode !== "DESTINATION";
    this.state.setProperty("/needsPassword", direct);
    this.state.setProperty("/needsUsername", direct && !broker.username);
    this.state.setProperty("/username", broker?.username ?? "");
    this.state.setProperty("/enteredUsername", "");
    this.state.setProperty("/password", "");
  }

  public onExit(): void {
    window.removeEventListener("beforeunload", this.onUnload);
    if (this.flushTimer) clearInterval(this.flushTimer);
    void this.stopCurrent();
    this.socket.close();
  }

  private readonly onUnload = (): void => {
    void this.stopCurrent();
  };

  // a method, not a getter: the UI5 transpiler evaluates getters when the controller class is defined
  private odata(): ODataModel {
    // from the component: in onInit the view has not received the component's models yet
    return this.getOwnerComponent()!.getModel() as ODataModel;
  }

  // ---------------------------------------------------------------- subscription

  public async onStart(): Promise<void> {
    const s = this.data();
    if (s.subscriptionId) return;
    const brokerId = s.brokerId;
    if (!brokerId) return void MessageToast.show("Select a broker");
    const topics = this.collectTopics();
    if (s.sourceType === "TOPIC" && !topics.length) return void MessageToast.show("Enter at least one topic");
    if (s.sourceType !== "TOPIC" && !s.queue?.trim()) return void MessageToast.show("Enter a queue name");
    if (s.needsUsername && !s.enteredUsername?.trim()) return void MessageToast.show("Enter the broker username");
    if (s.needsPassword && !s.password) return void MessageToast.show("Enter the broker password");

    this.state.setProperty("/busy", true);
    try {
      // the binding (with the password) is dropped from the model afterwards, also if starting fails
      const { subscriptionId: id } = await invokeAction<{ subscriptionId: string }>(this.odata(), "/start(...)", {
        brokerId,
        sourceType: s.sourceType,
        topics: s.sourceType === "TOPIC" ? topics : [],
        queue: s.sourceType === "TOPIC" ? null : s.queue.trim(),
        password: s.needsPassword ? s.password : null,
        username: s.needsUsername ? s.enteredUsername.trim() : null
      });
      this.state.setProperty("/password", "");
      await this.socket.enter(id);
      // the text that was still being typed is now a topic, too
      this.topicInput().setValue("");
      this.addTopics(topics);
      const history = s.sourceType === "TOPIC" ? this.rememberTopics(topics) : ((this.state.getProperty("/topicHistory") as { text: string }[]) ?? []).map((h) => h.text);
      savePrefs({
        brokerId,
        sourceType: s.sourceType,
        topicsText: topics.join(", "),
        topicHistory: history,
        queue: s.queue
      });

      const label = s.sourceType === "TOPIC" ? topics.join(", ") : `${s.sourceType === "QUEUE_BROWSE" ? "Browsing" : "Consuming"} ${s.queue.trim()}`;
      this.state.setProperty("/subscriptionId", id);
      const origin: Origin = { brokerId, sourceType: s.sourceType, sourceLabel: label };
      this.state.setProperty("/subscription", origin);
      this.state.setProperty("/brokerName", (this.byId("broker") as Select).getSelectedItem()?.getText() ?? "");
      this.state.setProperty("/sourceLabel", label);
      this.state.setProperty("/status", "Subscribed");
      this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
      // the form is not needed while listening - give the messages the room
      this.setHeaderExpanded(false);
    } catch (e) {
      MessageBox.error(errorText(e));
    } finally {
      this.state.setProperty("/busy", false);
    }
  }

  public async onStop(): Promise<void> {
    this.state.setProperty("/busy", true);
    try {
      await this.stopCurrent();
    } finally {
      this.state.setProperty("/busy", false);
    }
  }

  private async stopCurrent(): Promise<void> {
    const id = this.state.getProperty("/subscriptionId") as string | null;
    if (!id) return;
    this.markStopped("Not subscribed");
    this.socket.exit(id);
    try {
      await invokeAction(this.odata(), "/stop(...)", { subscriptionId: id });
    } catch (e) {
      MessageToast.show(errorText(e));
    }
  }

  private markStopped(status: string): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.state.setProperty("/subscriptionId", null);
    this.state.setProperty("/subscription", null);
    this.state.setProperty("/status", status);
    this.setHeaderExpanded(true);
  }

  private setHeaderExpanded(expanded: boolean): void {
    (this.byId("page") as DynamicPage | undefined)?.setHeaderExpanded(expanded);
  }

  /** Keeps this page's subscription alive on the server (only this one: a closed tab's subscription times out). */
  private async heartbeat(): Promise<void> {
    const id = this.state.getProperty("/subscriptionId") as string | null;
    if (!id) return;
    try {
      const { active } = await invokeAction<{ active: boolean }>(this.odata(), "/heartbeat(...)", { subscriptionId: id });
      if (!active && this.state.getProperty("/subscriptionId") === id) this.markStopped("Subscription ended on the server");
    } catch {
      /* transient - retry on next tick */
    }
  }

  private async fetchActive(): Promise<Record<string, string>[]> {
    const binding = this.odata().bindList("/activeSubscriptions()");
    const contexts = await binding.requestContexts(0, MAX_SUBSCRIPTIONS);
    return contexts.map((c) => c.getObject() as Record<string, string>);
  }

  /** Opens the matching section of the user guide in a new tab, so the running subscription is not interrupted. */
  public onHelp(): void {
    Help.open();
  }

  public async onShowActive(): Promise<void> {
    try {
      const list = await this.fetchActive();
      if (!list.length) return void MessageToast.show("No active subscriptions");
      const current = this.state.getProperty("/subscriptionId") as string | null;
      const others = list.filter((s) => s.subscriptionId !== current);
      const text = list
        .map((s) => `• ${s.brokerName}: ${s.sourceType} ${s.source} (${s.messageCount} msgs)${s.subscriptionId === current ? " – this page" : ""}`)
        .join("\n");
      MessageBox.information(text, {
        title: "Your active subscriptions",
        actions: others.length ? ["Stop others", MessageBox.Action.CLOSE] : [MessageBox.Action.CLOSE],
        onClose: async (action: string | null) => {
          if (action !== "Stop others") return;
          for (const s of others) await invokeAction(this.odata(), "/stop(...)", { subscriptionId: s.subscriptionId }).catch(() => undefined);
          MessageToast.show(others.length === 1 ? "1 subscription stopped" : `${others.length} subscriptions stopped`);
        }
      });
    } catch (e) {
      MessageBox.error(errorText(e));
    }
  }

  // ---------------------------------------------------------------- live events

  private onLiveEvent(event: string, data: Record<string, unknown>): void {
    const { subscriptionId: current, subscription } = this.data();
    if (data.subscriptionId !== current || !subscription) return;

    if (event === "message") {
      const received = new Date(String(data.receivedAt));
      const payload = String(data.payload ?? "");
      this.buffer.push({
        origin: subscription,
        seq: Number(data.seq),
        time: received.toLocaleTimeString(),
        receivedAt: received.toISOString(),
        topic: String(data.topic ?? ""),
        payload,
        contentType: (data.contentType as string) ?? null,
        userProperties: String(data.userProperties ?? "{}"),
        correlationId: (data.correlationId as string) ?? null,
        deliveryMode: String(data.deliveryMode ?? ""),
        size: formatSize(new Blob([payload]).size)
      });
      // while paused nothing is shown - keep only what the table could show afterwards
      if (this.buffer.length > MAX_MESSAGES) this.buffer.splice(0, this.buffer.length - MAX_MESSAGES);
      this.state.setProperty("/received", (this.state.getProperty("/received") as number) + 1);
    } else if (event === "subscriptionStatus") {
      const status = String(data.status);
      if (status === "THROTTLED" || status === "RESUMED") {
        MessageToast.show(String(data.message));
      } else {
        this.markStopped(`${status}: ${data.message}`);
        if (status === "DOWN") MessageBox.warning(`Subscription lost: ${data.message}`);
      }
    }
  }

  /** Batches incoming messages into the table (newest first). */
  private flush(): void {
    if (!this.buffer.length || this.state.getProperty("/paused")) return;
    const incoming = this.buffer.splice(0).reverse();
    const messages = (this.state.getProperty("/messages") as LiveMessage[]) ?? [];
    this.state.setProperty("/messages", incoming.concat(messages).slice(0, MAX_MESSAGES));
  }

  public onClear(): void {
    this.buffer = [];
    this.state.setProperty("/messages", []);
    this.state.setProperty("/received", 0);
    this.state.setProperty("/selected", null);
  }

  public onFilter(event: SearchField$LiveChangeEvent): void {
    const query = event.getParameter("newValue") ?? "";
    const binding = (this.byId("messages") as Table).getBinding("items") as ListBinding;
    binding.filter(
      query
        ? [
            new Filter({
              filters: [
                new Filter("topic", FilterOperator.Contains, query),
                new Filter("payload", FilterOperator.Contains, query)
              ],
              and: false
            })
          ]
        : []
    );
  }

  public onSelect(event: ListBase$SelectionChangeEvent): void {
    const item = event.getParameter("listItem") as ColumnListItem;
    const msg = item.getBindingContext("state")!.getObject() as LiveMessage;
    const json = tryJson(msg.payload);
    const properties = (tryJson(msg.userProperties) ?? {}) as Record<string, unknown>;
    this.state.setProperty("/selected", {
      ...msg,
      prettyPayload: json !== undefined ? JSON.stringify(json, null, 2) : msg.payload,
      editorType: json !== undefined ? "json" : "text",
      prettyProperties: JSON.stringify(properties, null, 2),
      propertyCount: Object.keys(properties).length,
      receivedLocal: new Date(msg.receivedAt).toLocaleString()
    } as SelectedMessage);
  }

  // ---------------------------------------------------------------- actions on a message

  public async onCopy(): Promise<void> {
    const sel = this.state.getProperty("/selected") as SelectedMessage | null;
    if (!sel) return;
    await navigator.clipboard.writeText(sel.prettyPayload);
    MessageToast.show("Payload copied");
  }

  /** Persists the selected message (once); returns the ID of the saved entity. */
  private async save(): Promise<string | undefined> {
    const sel = this.state.getProperty("/selected") as SelectedMessage | null;
    if (!sel) return undefined;
    if (sel.savedId) return sel.savedId;

    // the subscription the message came from - the form may show another one by now
    const list = this.odata().bindList("/ReceivedMessages");
    try {
      const id = await this.create(list, {
      broker_ID: sel.origin.brokerId,
      source: sel.origin.sourceLabel,
      sourceType: sel.origin.sourceType,
      topic: sel.topic,
      payload: sel.payload,
      contentType: sel.contentType,
      userProperties: sel.userProperties,
      correlationId: sel.correlationId,
        deliveryMode: sel.deliveryMode,
        receivedAt: sel.receivedAt
      });
      this.state.setProperty("/selected/savedId", id);
      const messages = this.state.getProperty("/messages") as LiveMessage[];
      const row = messages.find((m) => m.seq === sel.seq && m.receivedAt === sel.receivedAt);
      if (row) row.savedId = id;
      return id;
    } finally {
      list.destroy();
    }
  }

  /** Creates an entity in the list; a failed creation is taken back, so it is not sent again with the next request. */
  private async create(list: ODataListBinding, data: Record<string, unknown>): Promise<string> {
    const ctx = list.create(data);
    try {
      await ctx.created();
    } catch (e) {
      await list.resetChanges().catch(() => undefined);
      throw e;
    }
    return ctx.getProperty("ID") as string;
  }

  public async onSave(): Promise<void> {
    try {
      await this.save();
      MessageToast.show("Message saved - see app 'Saved Messages'");
    } catch (e) {
      MessageBox.error(errorText(e));
    }
  }

  public async onSaveAsTestCase(): Promise<void> {
    try {
      const id = await this.save();
      if (!id) return;
      const message = this.odata().bindContext(`/ReceivedMessages(${id})`);
      let testCaseId: string;
      try {
        ({ ID: testCaseId } = await invokeAction<{ ID: string }>(this.odata(), "SubscribeService.createTestCase(...)", {}, message.getBoundContext() as Context));
      } finally {
        message.destroy();
      }
      MessageBox.success("Test case created.", {
        actions: ["Open Test Case", MessageBox.Action.CLOSE],
        emphasizedAction: "Open Test Case",
        onClose: (action: string | null) => {
          if (action === "Open Test Case") openTestCase(testCaseId);
        }
      });
    } catch (e) {
      MessageBox.error(errorText(e));
    }
  }
}

function splitTopics(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function loadPrefs(): SubscriberPrefs {
  return Prefs.get<SubscriberPrefs>(PREFS_KEY, {}) ?? {};
}

function savePrefs(prefs: SubscriberPrefs): void {
  Prefs.set(PREFS_KEY, prefs);
}

function openTestCase(id: string): void {
  Navigation.toApp({ app: "testcases", path: `TestCases(ID=${id},IsActiveEntity=true)` });
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
