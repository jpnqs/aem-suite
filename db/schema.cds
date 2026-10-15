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
  DIRECT;
  PERSISTENT;
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
}

type PropertyType   : String(10) enum {
  STRING;
  INT;
  BOOL;
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
  lastConnectionStatus   : String(10);
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
  deliveryMode   : DeliveryMode default 'PERSISTENT' @mandatory;
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
  sourceType     : String(10); // TOPIC | QUEUE
  topic          : String(500);
  payload        : LargeString;
  contentType    : String(100);
  /** JSON object of user properties */
  userProperties : LargeString;
  correlationId  : String(200);
  deliveryMode   : String(20);
  receivedAt     : Timestamp;
}
