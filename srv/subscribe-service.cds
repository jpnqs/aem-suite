using {aem.suite as db} from '../db/schema';

/** Live subscriptions (topics, queue browse / consume) and saved messages. */
@path    : '/odata/v4/subscribe'
@requires: 'Tester'
service SubscribeService {

  @readonly
  entity Brokers as
    projection on db.Brokers {
      ID,
      name,
      msgVpn,
      credentialMode,
      username,
      active
    }
    where active = true;

  entity ReceivedMessages as projection on db.ReceivedMessages
    actions {
      /** Creates a new test case from this message (topic, payload, user properties). */
      action createTestCase() returns TestCaseRef;
    };

  type SourceType : String enum {
    TOPIC;
    QUEUE_BROWSE;
    QUEUE_CONSUME;
  }

  /**
   * Starts a live subscription. Received messages are pushed via websocket
   * (service LiveService, event "message") into context = returned subscriptionId.
   */
  action start(brokerId : UUID not null,
               sourceType : SourceType not null,
               /** topic subscriptions (TOPIC) */
               topics : many String,
               /** queue name (QUEUE_BROWSE / QUEUE_CONSUME) */
               queue : String,
               /** DIRECT brokers: password, held in memory while the subscription runs, never stored */
               password : String,
               /** DIRECT brokers without a maintained username */
               username : String)       returns SubscriptionRef;

  action stop(subscriptionId : UUID not null);

  function activeSubscriptions()        returns many SubscriptionInfo;

  type SubscriptionRef {
    subscriptionId : UUID;
  }

  type SubscriptionInfo {
    subscriptionId : UUID;
    brokerId       : UUID;
    brokerName     : String;
    sourceType     : String;
    source         : String;
    startedAt      : Timestamp;
    messageCount   : Integer;
  }

  type TestCaseRef {
    ID : UUID;
  }
}
