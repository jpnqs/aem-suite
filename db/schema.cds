namespace aem.suite;

using {
  cuid,
  managed,
  sap.common.CodeList
} from '@sap/cds/common';

/**
 * Value helps for the enum fields below (initial data in db/data).
 * @singular: the model classes of cds-typer (@cds-models) would otherwise be named like the enum types.
 */
@singular: 'CredentialModeCode'
entity CredentialModes : CodeList {
  key code : CredentialMode;
}

@singular: 'DeliveryModeCode'
entity DeliveryModes : CodeList {
  key code : DeliveryMode;
}

@singular: 'PropertyTypeCode'
entity PropertyTypes : CodeList {
  key code : PropertyType;
}

/*
 * @assert.range on the enum types: CAP rejects other values on every OData write (the UI only offers them as
 * dropdowns). Direct database writes (agent, import, copy) are checked by lib/node-validation.ts.
 */
@assert.range
type CredentialMode : String(12) enum {
  DESTINATION;
  DIRECT;
}

@assert.range
type DeliveryMode   : String(12) enum {
  PERSISTENT;
  DIRECT;
}

@assert.range
type RunStatus      : String(10) enum {
  RUNNING;
  DONE;
  FAILED;
}

@assert.range
type NodeKind       : String(10) enum {
  FOLDER;
  TEST;
}

@assert.range
type ResultStatus   : String(10) enum {
  PENDING;
  PASSED;
  FAILED;
  ERROR;
  /** not sent: the run was stopped, or an earlier message failed (stop on first failure) */
  SKIPPED;
}

@assert.range
type PropertyType   : String(10) enum {
  STRING;
  INT;
  BOOL;
}

@assert.range
type ConnectionStatus : String(10) enum {
  OK;
  ERROR;
}

/** where a live view message came from (SubscribeService.SourceType) */
@assert.range
type SourceType     : String(15) enum {
  TOPIC;
  QUEUE_BROWSE;
  QUEUE_CONSUME;
}

/** delivery mode of a received message - NON_PERSISTENT exists on receive only */
@assert.range
type ReceivedDeliveryMode : String(20) enum {
  DIRECT;
  NON_PERSISTENT;
  PERSISTENT;
}

/** Client username on a broker (Brokers and the saved setups of the live subscriber). */
type Username : String(200);

/** ROUND: the whole selection N times (a b c a b c), EACH: every test case N times in a row (a a b b c c) */
@assert.range
type RunOrder : String(5) enum {
  ROUND;
  EACH;
}

/** A Solace / Advanced Event Mesh broker (message VPN) to test against. */
entity Brokers : cuid, managed {
  name                   : String(100) @mandatory;
  description            : String(500);
  credentialMode         : CredentialMode default 'DIRECT' @mandatory;
  /** DESTINATION mode: name of the BTP destination (URL = wss/tcps endpoint, property msgVpn) */
  destinationName        : String(200);
  /** DIRECT mode: connection data maintained in the app */
  url                    : String(500);
  msgVpn                 : String(100);
  /**
   * DIRECT mode: the password is never stored - it is entered for each run / connection test / subscription.
   * The username is optional: if empty, it is entered together with the password.
   */
  username               : Username;
  clientNamePrefix       : String(60) default 'aem-suite';
  connectTimeoutMs       : Integer default 10000 @assert.range: [1000, 120000];
  active                 : Boolean default true;
  lastConnectionStatus   : ConnectionStatus;
  lastConnectionAt       : Timestamp;
  lastConnectionMessage  : String(1000);
  variables              : Composition of many Variables
                             on variables.broker = $self;
}

/** Template variables. Without broker = global, with broker = broker specific (overrides global). */
entity Variables : cuid {
  broker : Association to Brokers;
  name   : String(100) @mandatory;
  value  : String(2000);
}

/**
 * Test cases and folders in one tree (Fiori tree table).
 * FOLDER nodes only use name, description, variables and children.
 */
@singular: 'TestCase' // cds-typer would derive "TestCas"
entity TestCases : cuid, managed {
  kind           : NodeKind default 'TEST' @mandatory;
  parent         : Association to TestCases;
  children       : Composition of many TestCases
                     on children.parent = $self;
  /** order among siblings (drag & drop) */
  sortOrder      : Integer default 0;
  /** empty = taken from the topic (test cases) */
  name           : String(200);
  description    : String(1000);
  /** topic template, e.g. acme/orders/{{region}}/created/v1/{{uuid}} - required for test cases */
  topic          : String(500);
  /** JSON payload template */
  payload        : LargeString;
  /** empty = detected from the payload on save (JSON or text) */
  contentType    : String(100) default 'application/json';
  /** only used by tests; folders (and old data) may leave it empty = PERSISTENT */
  deliveryMode   : DeliveryMode default 'PERSISTENT';
  /** empty / 0 = no TTL; empty priority / DMQ = broker defaults */
  timeToLiveMs   : Integer;
  dmqEligible    : Boolean;
  priority       : Integer @assert.range: [0, 255];
  /** correlation id template, e.g. {{uuid}} */
  correlationId  : String(200);
  ackTimeoutMs   : Integer default 5000 @assert.range: [100, 120000];
  userProperties : Composition of many TestCaseProperties
                     on userProperties.testCase = $self;
  variables      : Composition of many TestCaseVariables
                     on variables.testCase = $self;
  /**
   * outcome of the latest run (kept separately, so runs do not touch modifiedAt; not a composition, so a draft
   * does not copy it). TestService deletes the stats of deleted test cases.
   */
  lastResult     : Association to one TestCaseStats
                     on lastResult.testCase = $self;
}

/** Latest run outcome per test case - written by the test runner. */
entity TestCaseStats {
  key testCase  : Association to TestCases;
      status    : ResultStatus; // PASSED if all brokers passed, else FAILED / ERROR
      runAt     : Timestamp;
      run       : Association to TestRuns;
      brokers   : String(500);
      message   : String(1000);
}

entity TestCaseProperties : cuid {
  testCase : Association to TestCases;
  name     : String(100) @mandatory;
  /** empty = inferred from the value on save (42 -> INT, true -> BOOL, else STRING) */
  type     : PropertyType;
  /** value template */
  value    : String(1000);
}

/** Variables local to a test case - highest precedence. */
entity TestCaseVariables : cuid {
  testCase : Association to TestCases;
  name     : String(100) @mandatory;
  value    : String(2000);
}

entity TestRuns : cuid, managed {
  /** e.g. "Order created, Ping -> local-docker, aem-dev" */
  summary     : String(500);
  startedAt   : Timestamp;
  finishedAt  : Timestamp;
  status      : RunStatus default 'RUNNING';
  totalCount  : Integer default 0;
  passedCount : Integer default 0;
  failedCount : Integer default 0;
  /** messages that were not sent (run stopped, stop on first failure) */
  skippedCount : Integer default 0;
  /** advanced run settings (Run dialog): how often each message is sent, the pause between messages, ... */
  repetitions  : Integer default 1;
  /** the order of the repetitions ("order" is an SQL keyword) */
  repetitionOrder : RunOrder default 'ROUND';
  delayMs      : Integer default 0;
  stopOnFailure : Boolean default false;
  results     : Composition of many RunResults
                  on results.run = $self;
}

entity RunResults : cuid {
  run             : Association to TestRuns;
  testCase        : Association to TestCases;
  /** snapshots, so history stays readable if test case / broker get renamed or deleted */
  testCaseName    : String(200);
  broker          : Association to Brokers;
  brokerName      : String(100);
  status          : ResultStatus default 'PENDING';
  /** which repetition of the test case this is (1 = the first) */
  iteration       : Integer default 1;
  /** order of sending within the broker (1 = first) */
  sequence        : Integer;
  deliveryMode    : DeliveryMode;
  resolvedTopic   : String(500);
  resolvedPayload : LargeString;
  correlationId   : String(200);
  ackLatencyMs    : Integer;
  errorMessage    : String(2000);
  executedAt      : Timestamp;
}

/** Messages captured by the live subscriber that a user decided to keep. */
entity ReceivedMessages : cuid, managed {
  broker         : Association to Brokers;
  brokerName     : String(100);
  /** subscription expression or queue name the message was received on */
  source         : String(500);
  sourceType     : SourceType;
  topic          : String(500);
  payload        : LargeString;
  contentType    : String(100);
  /** JSON object of user properties */
  userProperties : LargeString;
  correlationId  : String(200);
  deliveryMode   : ReceivedDeliveryMode;
  receivedAt     : Timestamp;
}

/**
 * Saved setups of the live subscriber (per user): broker, source, topics / queue and the username.
 * Never a password.
 */
entity SubscriberPresets : cuid, managed {
  name       : String(100) @mandatory;
  broker     : Association to Brokers;
  sourceType : SourceType default 'TOPIC';
  /** JSON array of topic subscriptions (TOPIC) */
  topics     : LargeString;
  /** queue name (QUEUE_BROWSE / QUEUE_CONSUME) */
  queue      : String(500);
  /** only if the user wants it remembered; DIRECT brokers without a maintained username */
  username   : Username;
}

/**
 * Number ranges: issue real-looking identifiers (like SAP number ranges). Used in templates as
 * {{numberRange.<name>}}; every message that uses a range gets the next number. `current` is the last number issued.
 */
// the name check of AdminService ignores case; the constraint also stops two creates that pass it at the same time
@assert.unique: {name: [name]}
entity NumberRanges : cuid, managed {
  /** used in the template: {{numberRange.<name>}} */
  name        : String(50) @mandatory;
  description : String(200);
  prefix      : String(20);
  suffix      : String(20);
  /** digits of the number, filled with leading zeros (0 = no padding) */
  length      : Integer default 6;
  /** first number of the range */
  start       : Integer64 default 1;
  step        : Integer default 1;
  /** last allowed number; empty = unlimited (until the number no longer fits into the length) */
  maximum     : Integer64;
  /** last number issued; empty = nothing issued yet */
  current     : Integer64;
  lastUsedAt  : Timestamp;
}

// ---------------------------------------------------------------------------------------------- field titles
// Titles and tooltips of the fields, for every app and service (CAP passes them on to the projections).
// The apps (app/*/annotations.cds) only add their layout. Timestamps are worded "<what> At".

annotate Brokers with {
  name                  @title: 'Name';
  description           @title: 'Description';
  credentialMode        @title: 'Credentials';
  destinationName       @title: 'Destination'
                        @Common.QuickInfo: 'BTP destination: URL = wss:// endpoint, additional property msgVpn';
  url                   @title: 'URL'
                        @Common.QuickInfo: 'Host is enough, e.g. mr-xyz.messaging.solace.cloud - completed to wss://host:443 (port 55443 gives tcps, 55555 gives tcp)';
  msgVpn                @title: 'Message VPN';
  username              @title: 'Username'
                        @Common.QuickInfo: 'Optional. If empty, the username is asked for together with the password when running tests, testing the connection or subscribing. The password is never stored';
  clientNamePrefix      @title: 'Client Name Prefix';
  connectTimeoutMs      @title: 'Connect Timeout (ms)';
  active                @title: 'Active';
  lastConnectionStatus  @title: 'Status';
  lastConnectionAt      @title: 'Tested At';
  lastConnectionMessage @title: 'Message';
};

annotate Variables with {
  name  @title: 'Name'  @Common.QuickInfo: 'Reference it in double curly braces in topics, payloads, correlation ids and user properties';
  value @title: 'Value';
};

annotate TestCases with {
  name          @title: 'Name'  @Common.QuickInfo: 'Test cases: empty = topic';
  kind          @title: 'Type';
  description   @title: 'Description';
  topic         @title: 'Topic'  @Common.QuickInfo: 'Supports template variables in double curly braces, e.g. variable region or built-in uuid';
  payload       @title: 'Payload';
  contentType   @title: 'Content Type'  @Common.QuickInfo: 'Default application/json - empty = detected on save (JSON or text/plain)';
  deliveryMode  @title: 'Delivery Mode';
  timeToLiveMs  @title: 'Time to Live (ms)'  @Common.QuickInfo: 'Empty or 0 = no expiry';
  dmqEligible   @title: 'DMQ Eligible'  @Common.QuickInfo: 'Empty = broker default';
  priority      @title: 'Priority (0-255)'  @Common.QuickInfo: 'Empty = broker default';
  correlationId @title: 'Correlation ID'  @Common.QuickInfo: 'Supports template variables in double curly braces, e.g. built-in uuid';
  ackTimeoutMs  @title: 'ACK Timeout (ms)';
  createdBy     @title: 'Created By';
  modifiedAt    @title: 'Changed At';
  modifiedBy    @title: 'Changed By';
};

annotate TestCaseProperties with {
  name  @title: 'Name';
  value @title: 'Value'  @Common.QuickInfo: 'Supports template variables in double curly braces';
  type  @title: 'Type'  @Common.QuickInfo: 'Empty = detected on save (42 = Integer, true = Boolean, else String)';
};

annotate TestCaseVariables with {
  name  @title: 'Name';
  value @title: 'Value';
};

annotate TestCaseStats with {
  status  @title: 'Status';
  runAt   @title: 'Run At';
  brokers @title: 'Brokers';
  message @title: 'Problems';
};

annotate TestRuns with {
  createdAt       @title: 'Started At';
  createdBy       @title: 'Started By';
  summary         @title: 'Test Cases → Brokers';
  startedAt       @title: 'Started At';
  finishedAt      @title: 'Finished At';
  status          @title: 'Run Status';
  totalCount      @title: 'Total';
  passedCount     @title: 'Passed';
  failedCount     @title: 'Failed / Error';
  skippedCount    @title: 'Not Sent'  @Common.QuickInfo: 'Messages that were not sent: the run was stopped, or stop on first failure';
  repetitions     @title: 'Repetitions';
  repetitionOrder @title: 'Order'  @Common.QuickInfo: 'Whole selection (a b c, a b c) or each test case in a row (a a, b b, c c)';
  delayMs         @title: 'Pause (ms)'  @Common.QuickInfo: 'Pause between two messages to the same broker';
  stopOnFailure   @title: 'Stop at First Failure';
};

annotate RunResults with {
  testCaseName    @title: 'Test Case';
  brokerName      @title: 'Broker';
  status          @title: 'Status';
  iteration       @title: 'Repetition'  @Common.QuickInfo: 'Which repetition of the test case this is (1 = the first)';
  deliveryMode    @title: 'Delivery Mode';
  resolvedTopic   @title: 'Topic';
  resolvedPayload @title: 'Payload';
  correlationId   @title: 'Correlation ID';
  ackLatencyMs    @title: 'ACK Latency (ms)';
  errorMessage    @title: 'Error';
  executedAt      @title: 'Executed At';
};

annotate ReceivedMessages with {
  brokerName     @title: 'Broker';
  source         @title: 'Subscription / Queue';
  sourceType     @title: 'Source Type';
  topic          @title: 'Topic';
  payload        @title: 'Payload';
  contentType    @title: 'Content Type';
  userProperties @title: 'User Properties';
  correlationId  @title: 'Correlation ID';
  deliveryMode   @title: 'Delivery Mode';
  receivedAt     @title: 'Received At';
  createdBy      @title: 'Saved By';
};

annotate NumberRanges with {
  name        @title: 'Name'  @Common.QuickInfo: 'Use it in topics, payloads, correlation ids and user properties as {{numberRange.<name>}}';
  description @title: 'Description';
  prefix      @title: 'Prefix'  @Common.QuickInfo: 'Text in front of the number, e.g. SO-';
  suffix      @title: 'Suffix'  @Common.QuickInfo: 'Text after the number, e.g. -EU';
  length      @title: 'Digits'  @Common.QuickInfo: 'Length of the number, filled with leading zeros (0 = no leading zeros)';
  start       @title: 'First Number';
  step        @title: 'Step'  @Common.QuickInfo: 'Increment between two numbers';
  maximum     @title: 'Last Allowed Number'  @Common.QuickInfo: 'Empty = until the number no longer fits into the digits';
  lastUsedAt  @title: 'Last Used At'  @Common.QuickInfo: 'When a run took a number last';
};
