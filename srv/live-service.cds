/**
 * Websocket channel (ws[s]://<host>/ws/live) for server push.
 * Clients enter a context (subscriptionId or runId) via
 *   {"event":"wsContext","data":{"context":"<id>"}}
 * and only receive events of that context.
 */
@protocol: 'ws'
@path    : 'live'
@requires: 'Tester'
service LiveService {

  /** A message received by a live subscription. */
  event message {
    @ws.context
    subscriptionId : UUID;
    brokerId       : UUID;
    topic          : String;
    payload        : LargeString;
    contentType    : String;
    userProperties : LargeString;
    correlationId  : String;
    deliveryMode   : String;
    receivedAt     : Timestamp;
    seq            : Integer;
  }

  /** Subscription state changes (UP, DOWN, ERROR). */
  event subscriptionStatus {
    @ws.context
    subscriptionId : UUID;
    status         : String;
    message        : String;
  }

  /** Progress of a test run. */
  event runProgress {
    @ws.context
    runId    : UUID;
    status   : String;
    total    : Integer;
    done     : Integer;
    passed   : Integer;
    failed   : Integer;
    resultId : UUID;
  }
}
