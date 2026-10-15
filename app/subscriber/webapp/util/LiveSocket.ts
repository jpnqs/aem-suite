export type LiveHandler = (event: string, data: Record<string, unknown>) => void;

/**
 * Client for the CAP websocket service LiveService (/ws/live) with automatic reconnect.
 * Only events of entered contexts (subscription ids) are delivered.
 */
export default class LiveSocket {
  private ws?: WebSocket;
  private readonly contexts = new Set<string>();
  private closed = false;
  private retry = 0;
  private openPromise: Promise<void>;

  constructor(private readonly onEvent: LiveHandler, private readonly onState?: (connected: boolean) => void) {
    this.openPromise = this.connect();
  }

  private connect(): Promise<void> {
    // relative to the app (HTML5 repo / Work Zone serve it below a prefix; its xs-app.json routes ws/ to the backend)
    const url = new URL(sap.ui.require.toUrl("com/aem/suite/subscriber/ws/live"), window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return new Promise((resolve) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.addEventListener("open", () => {
        this.retry = 0;
        this.contexts.forEach((c) => this.send("wsContext", { context: c }));
        this.onState?.(true);
        resolve();
      });
      ws.addEventListener("message", (msg: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(msg.data) as { event: string; data: Record<string, unknown> };
          this.onEvent(payload.event, payload.data);
        } catch {
          /* ignore malformed frames */
        }
      });
      ws.addEventListener("close", () => {
        this.onState?.(false);
        if (this.closed) return;
        const delay = Math.min(30000, 1000 * 2 ** this.retry++);
        setTimeout(() => {
          if (!this.closed) this.openPromise = this.connect();
        }, delay);
        resolve();
      });
    });
  }

  private send(event: string, data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ event, data }));
  }

  async enter(context: string): Promise<void> {
    this.contexts.add(context);
    await this.openPromise;
    this.send("wsContext", { context });
  }

  exit(context: string): void {
    this.contexts.delete(context);
    this.send("wsContext", { context, exit: true });
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
