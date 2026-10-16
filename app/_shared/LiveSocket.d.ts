export type LiveHandler = (event: string, data: Record<string, unknown>) => void;

/** Client for the CAP websocket service LiveService (/ws/live) with automatic reconnect - see LiveSocket.js. */
export default class LiveSocket {
  constructor(onEvent: LiveHandler, onState?: (connected: boolean) => void);
  /** connects now instead of on the first enter() */
  connect(): Promise<void>;
  enter(context: string): Promise<void>;
  exit(context: string): void;
  close(): void;
}
