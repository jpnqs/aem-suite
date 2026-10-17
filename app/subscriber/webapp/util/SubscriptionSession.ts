import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import Actions from "com/aem/suite/subscriber/shared/Actions";
import LiveSocket from "com/aem/suite/subscriber/shared/LiveSocket";

const { invokeAction } = Actions;

/** The server closes a subscription without heartbeat after 5 minutes (cds.aemSuite.subscriptions.idleTimeoutMs). */
const HEARTBEAT_MS = 60 * 1000;

/** What SubscribeService.start takes (srv/subscribe-service.cds). */
export interface StartParams {
  brokerId: string;
  sourceType: string;
  topics: string[];
  queue: string | null;
  /** DIRECT brokers: only sent with this call, never kept */
  password: string | null;
  username: string | null;
}

/**
 * The live subscription of the page on the server: start, stop, and the heartbeat that keeps it from being closed
 * as idle. Messages and status events arrive through the LiveSocket in the subscription's context.
 */
export default class SubscriptionSession {
  private id: string | null = null;
  private timer?: ReturnType<typeof setInterval>;

  /**
   * @param model the OData model of SubscribeService (a function: the controller gets it from its component)
   * @param onEnded called when the heartbeat finds the subscription gone on the server
   */
  constructor(
    private readonly model: () => ODataModel,
    private readonly socket: LiveSocket,
    private readonly onEnded: () => void
  ) {}

  /** The running subscription, or null. */
  currentId(): string | null {
    return this.id;
  }

  /** Starts the subscription and enters its websocket context; resolves with its ID. */
  async start(params: StartParams): Promise<string> {
    // the binding (with the password) is dropped from the model afterwards, also if starting fails
    const { subscriptionId } = await invokeAction<{ subscriptionId: string }>(this.model(), "/start(...)", { ...params });
    await this.socket.enter(subscriptionId);
    this.id = subscriptionId;
    this.timer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    return subscriptionId;
  }

  /** Stops the running subscription on the server (nothing if there is none). */
  async stop(): Promise<void> {
    const id = this.id;
    if (!id) return;
    this.ended();
    this.socket.exit(id);
    await invokeAction(this.model(), "/stop(...)", { subscriptionId: id });
  }

  /** The subscription ended (status event from the server, or stopped): no more heartbeats. */
  ended(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.id = null;
  }

  /** Keeps this page's subscription alive on the server (only this one: a closed tab's subscription times out). */
  private async heartbeat(): Promise<void> {
    const id = this.id;
    if (!id) return;
    try {
      const { active } = await invokeAction<{ active: boolean }>(this.model(), "/heartbeat(...)", { subscriptionId: id });
      if (!active && this.id === id) {
        this.ended();
        this.onEnded();
      }
    } catch {
      /* transient - retry on next tick */
    }
  }
}
