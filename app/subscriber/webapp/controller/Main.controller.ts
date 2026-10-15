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
import { ListBase$SelectionChangeEvent } from "sap/m/ListBase";
import LiveSocket from "../util/LiveSocket";

const MAX_MESSAGES = 500;
const FLUSH_MS = 250;
const HEARTBEAT_MS = 60 * 1000;
const PREFS_KEY = "aem-suite.subscriber";

interface SubscriberPrefs {
  brokerId?: string;
  sourceType?: string;
  topicsText?: string;
  queue?: string;
}

interface LiveMessage {
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
}

interface SelectedMessage extends LiveMessage {
  prettyPayload: string;
  prettyProperties: string;
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
    this.state = new JSONModel({
      brokerId: prefs.brokerId ?? null,
      sourceType: prefs.sourceType ?? "TOPIC",
      topicsText: prefs.topicsText ?? "",
      queue: prefs.queue ?? "",
      // password of DIRECT brokers: only in this page's memory until Start, never stored
      password: "",
      needsPassword: false,
      username: "",
      // DIRECT brokers without a maintained username: entered together with the password
      needsUsername: false,
      enteredUsername: "",
      subscriptionId: null,
      sourceLabel: "",
      status: "Not subscribed",
      busy: false,
      paused: false,
      socketConnected: true,
      received: 0,
      messages: [],
      selected: null
    });
    this.state.setSizeLimit(MAX_MESSAGES);
    this.getView()!.setModel(this.state, "state");

    this.socket = new LiveSocket(
      (event, data) => this.onLiveEvent(event, data),
      (connected) => this.state.setProperty("/socketConnected", connected)
    );
    this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
    window.addEventListener("beforeunload", this.onUnload);
    void this.preselectBroker();
  }

  /** Keeps the remembered broker if it still exists, otherwise picks the first one. */
  private brokers: Record<string, { credentialMode: string; username: string }> = {};

  private async preselectBroker(): Promise<void> {
    try {
      const contexts = await this.odata()
        .bindList("/Brokers", undefined, [], [], { $select: "ID,credentialMode,username", $orderby: "name" })
        .requestContexts(0, 200);
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
    const s = this.state.getData() as Record<string, string>;
    if (this.state.getProperty("/subscriptionId")) return;
    if (!s.brokerId) return void MessageToast.show("Select a broker");
    const topics = (s.topicsText || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (s.sourceType === "TOPIC" && !topics.length) return void MessageToast.show("Enter at least one topic");
    if (s.sourceType !== "TOPIC" && !s.queue?.trim()) return void MessageToast.show("Enter a queue name");
    const needsPassword = this.state.getProperty("/needsPassword") as boolean;
    const needsUsername = this.state.getProperty("/needsUsername") as boolean;
    if (needsUsername && !s.enteredUsername?.trim()) return void MessageToast.show("Enter the broker username");
    if (needsPassword && !s.password) return void MessageToast.show("Enter the broker password");

    this.state.setProperty("/busy", true);
    try {
      const op = this.odata().bindContext("/start(...)");
      op.setParameter("brokerId", s.brokerId);
      op.setParameter("sourceType", s.sourceType);
      op.setParameter("topics", s.sourceType === "TOPIC" ? topics : []);
      op.setParameter("queue", s.sourceType === "TOPIC" ? null : s.queue.trim());
      op.setParameter("password", needsPassword ? s.password : null);
      op.setParameter("username", needsUsername ? s.enteredUsername.trim() : null);
      await op.invoke();
      const id = (op.getBoundContext() as Context).getProperty("subscriptionId") as string;
      op.destroy(); // drop the request incl. password from the model
      this.state.setProperty("/password", "");
      await this.socket.enter(id);
      savePrefs({ brokerId: s.brokerId, sourceType: s.sourceType, topicsText: s.topicsText, queue: s.queue });

      const label = s.sourceType === "TOPIC" ? topics.join(", ") : `${s.sourceType === "QUEUE_BROWSE" ? "Browsing" : "Consuming"} ${s.queue.trim()}`;
      this.state.setProperty("/subscriptionId", id);
      this.state.setProperty("/sourceLabel", label);
      this.state.setProperty("/status", `Subscribed: ${label}`);
      this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
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
      const op = this.odata().bindContext("/stop(...)");
      op.setParameter("subscriptionId", id);
      await op.invoke();
    } catch (e) {
      MessageToast.show(errorText(e));
    }
  }

  private markStopped(status: string): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.state.setProperty("/subscriptionId", null);
    this.state.setProperty("/status", status);
  }

  private async heartbeat(): Promise<void> {
    const id = this.state.getProperty("/subscriptionId") as string | null;
    if (!id) return;
    try {
      const list = await this.fetchActive();
      if (!list.some((s) => s.subscriptionId === id)) this.markStopped("Subscription ended on the server");
    } catch {
      /* transient - retry on next tick */
    }
  }

  private async fetchActive(): Promise<Record<string, string>[]> {
    const binding = this.odata().bindList("/activeSubscriptions()");
    const contexts = await binding.requestContexts(0, 50);
    return contexts.map((c) => c.getObject() as Record<string, string>);
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
          for (const s of others) {
            const op = this.odata().bindContext("/stop(...)");
            op.setParameter("subscriptionId", s.subscriptionId);
            await op.invoke().catch(() => undefined);
          }
          MessageToast.show(`${others.length} subscription(s) stopped`);
        }
      });
    } catch (e) {
      MessageBox.error(errorText(e));
    }
  }

  // ---------------------------------------------------------------- live events

  private onLiveEvent(event: string, data: Record<string, unknown>): void {
    const current = this.state.getProperty("/subscriptionId") as string | null;
    if (data.subscriptionId !== current) return;

    if (event === "message") {
      const received = new Date(String(data.receivedAt));
      const payload = String(data.payload ?? "");
      this.buffer.push({
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
    this.state.setProperty("/selected", {
      ...msg,
      prettyPayload: json !== undefined ? JSON.stringify(json, null, 2) : msg.payload,
      editorType: json !== undefined ? "json" : "text",
      prettyProperties: JSON.stringify(tryJson(msg.userProperties) ?? {}, null, 2)
    } as SelectedMessage);
  }

  // ---------------------------------------------------------------- actions on a message

  public async onCopy(): Promise<void> {
    const sel = this.state.getProperty("/selected") as SelectedMessage | null;
    if (!sel) return;
    await navigator.clipboard.writeText(sel.prettyPayload);
    MessageToast.show("Payload copied");
  }

  /** Persists the selected message; returns the context of the saved entity. */
  private async save(): Promise<Context | undefined> {
    const sel = this.state.getProperty("/selected") as SelectedMessage | null;
    if (!sel) return undefined;
    const s = this.state.getData() as Record<string, string>;
    if (sel.savedId) return this.odata().bindContext(`/ReceivedMessages(${sel.savedId})`).getBoundContext() as Context;

    const list = this.odata().bindList("/ReceivedMessages");
    const ctx = list.create({
      broker_ID: s.brokerId,
      source: s.sourceLabel,
      sourceType: s.sourceType === "TOPIC" ? "TOPIC" : "QUEUE",
      topic: sel.topic,
      payload: sel.payload,
      contentType: sel.contentType,
      userProperties: sel.userProperties,
      correlationId: sel.correlationId,
      deliveryMode: sel.deliveryMode,
      receivedAt: sel.receivedAt
    });
    await ctx.created();
    const id = ctx.getProperty("ID") as string;
    this.state.setProperty("/selected/savedId", id);
    const messages = this.state.getProperty("/messages") as LiveMessage[];
    const row = messages.find((m) => m.seq === sel.seq && m.receivedAt === sel.receivedAt);
    if (row) row.savedId = id;
    return ctx;
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
      const ctx = await this.save();
      if (!ctx) return;
      const op = this.odata().bindContext("SubscribeService.createTestCase(...)", ctx);
      await op.invoke();
      const testCaseId = (op.getBoundContext() as Context).getProperty("ID") as string;
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

function loadPrefs(): SubscriberPrefs {
  try {
    return (JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}") as SubscriberPrefs) ?? {};
  } catch {
    return {};
  }
}

function savePrefs(prefs: SubscriberPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

function openTestCase(id: string): void {
  const path = `TestCases(ID=${id},IsActiveEntity=true)`;
  const ushell = (window as unknown as { sap?: { ushell?: { Container?: unknown } } }).sap?.ushell;
  if (ushell?.Container) window.location.hash = `#AEMSuiteTestCases-manage&/${path}`;
  else window.open(`/testcases/index.html#/${path}`, "_blank");
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

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
