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

  /**
   * Saved messages: every tester sees all of them and can turn any into a test case, but only deletes their own.
   * Created by the live view's "Save"; never changed afterwards.
   */
  @restrict: [
    {
      grant: ['READ', 'CREATE', 'createTestCase'],
      to   : 'Tester'
    },
    {
      grant: 'DELETE',
      to   : 'Tester',
      where: 'createdBy = $user'
    },
    {
      grant: 'DELETE',
      to   : 'Admin'
    }
  ]
  @Capabilities.UpdateRestrictions.Updatable: false
  entity ReceivedMessages as projection on db.ReceivedMessages
    actions {
      /** Creates a new test case from this message (topic, payload, user properties). */
      action createTestCase() returns TestCaseRef;
    };

  /** The user's saved setups of the live subscriber (broker, source, topics, username - never a password). */
  @restrict: [{
    grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'],
    to   : 'Tester',
    where: 'createdBy = $user'
  }]
  entity SubscriberPresets as projection on db.SubscriberPresets;

  type SourceType : db.SourceType;

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

  /**
   * Called regularly by the page that started the subscription: keeps it from being closed by the idle timeout.
   * Only this one subscription - one left behind by a closed tab still times out. active = false: it ended on the server.
   */
  action heartbeat(subscriptionId : UUID not null) returns HeartbeatResult;

  /** The user's subscriptions (read only - does not keep them alive). */
  function activeSubscriptions()        returns many SubscriptionInfo;

  type HeartbeatResult {
    active : Boolean;
  }

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
