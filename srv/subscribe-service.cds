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

  /** Names of the users (ReceivedMessages.creator: the text of createdBy). */
  @readonly
  entity Users as projection on db.Users;

  // dropdowns show the name only, source types in their own order (UI.PresentationVariant #byPosition)
  @readonly
  entity SourceTypes as projection on db.SourceTypes;

  @readonly
  entity ReceivedDeliveryModes as projection on db.ReceivedDeliveryModes;

  annotate SourceTypes with @UI.PresentationVariant #byPosition: {SortOrder: [{Property: position}]} {
    code     @Common.Text: name  @Common.TextArrangement: #TextOnly;
    position @UI.Hidden;
  };

  annotate ReceivedDeliveryModes with {
    code @Common.Text: name  @Common.TextArrangement: #TextOnly;
  };

  // ---- value helps of the saved message filters: the values of the saved messages ----

  /** The users that saved messages. */
  @readonly
  @cds.redirection.target: false
  entity MessageSavers as
    select from db.ReceivedMessages distinct {
      key createdBy    as ID   : String(255) @title: '{i18n>User}',
          creator.name as name : String(511) @title: '{i18n>Name}'
    }
    where
      createdBy is not null;

  @readonly
  @cds.redirection.target: false
  entity MessageBrokers as
    select from db.ReceivedMessages distinct {
      key brokerName
    }
    where
      brokerName is not null;

  @readonly
  @cds.redirection.target: false
  entity MessageTopics as
    select from db.ReceivedMessages distinct {
      key topic
    }
    where
      topic is not null;

  /** subscriptions and queues the messages were received on */
  @readonly
  @cds.redirection.target: false
  entity MessageSources as
    select from db.ReceivedMessages distinct {
      key source
    }
    where
      source is not null;

  @readonly
  @cds.redirection.target: false
  entity MessageContentTypes as
    select from db.ReceivedMessages distinct {
      key contentType
    }
    where
      contentType is not null;

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
