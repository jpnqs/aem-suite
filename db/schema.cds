namespace aem.suite;

using {
  cuid,
  managed,
  sap.common.CodeList
} from '@sap/cds/common';

/** Value helps for the enum fields below (initial data in db/data). */
entity CredentialModes : CodeList {
  key code : CredentialMode;
}

entity DeliveryModes : CodeList {
  key code : DeliveryMode;
}

entity PropertyTypes : CodeList {
  key code : PropertyType;
}

type CredentialMode : String(12) enum {
  DESTINATION;
  DIRECT;
}

type DeliveryMode   : String(12) enum {
  PERSISTENT;
  DIRECT;
}

type RunStatus      : String(10) enum {
  RUNNING;
  DONE;
  FAILED;
}

type NodeKind       : String(10) enum {
  FOLDER;
  TEST;
}

type ResultStatus   : String(10) enum {
  PENDING;
  PASSED;
  FAILED;
  ERROR;
  /** not sent: the run was stopped, or an earlier message failed (stop on first failure) */
  SKIPPED;
}

type PropertyType   : String(10) enum {
  STRING;
  INT;
  BOOL;
}

type ConnectionStatus : String(10) enum {
  OK;
  ERROR;
}

/** where a live view message came from (SubscribeService.SourceType) */
type SourceType     : String(15) enum {
  TOPIC;
  QUEUE_BROWSE;
  QUEUE_CONSUME;
}

/** delivery mode of a received message - NON_PERSISTENT exists on receive only */
type ReceivedDeliveryMode : String(20) enum {
  DIRECT;
  NON_PERSISTENT;
  PERSISTENT;
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
  username               : String(200);
  clientNamePrefix       : String(60) default 'aem-suite';
  connectTimeoutMs       : Integer default 10000;
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
  priority       : Integer;
  /** correlation id template, e.g. {{uuid}} */
  correlationId  : String(200);
  ackTimeoutMs   : Integer default 5000;
  userProperties : Composition of many TestCaseProperties
                     on userProperties.testCase = $self;
  variables      : Composition of many TestCaseVariables
                     on variables.testCase = $self;
  /** outcome of the latest run (kept separately, so runs do not touch modifiedAt) */
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
  username   : String(100);
}

/**
 * Number ranges: issue real-looking identifiers (like SAP number ranges). Used in templates as
 * {{numberRange.<name>}}; every message that uses a range gets the next number. `current` is the last number issued.
 */
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
