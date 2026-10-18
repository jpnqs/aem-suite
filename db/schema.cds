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
 * dropdowns). Direct database writes (agent, import, copy) are checked by lib/testcases/node-validation.ts.
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
  /** aborted: crashed, or the server stopped while it ran */
  FAILED;
  /** stopped by the user (cancelRun): the messages not sent yet are SKIPPED */
  STOPPED;
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
  /** AI agents (MCP) may preview and run tests here - only effective for DESTINATION brokers (no password via AI) */
  agentAllowed           : Boolean default true;
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

@assert.range
type CleanupStatus : String(10) enum {
  DONE;
  /** some categories were cleaned up, then an error stopped the cleanup */
  PARTIAL;
  FAILED;
}

/** Every cleanup of the Data Cleanup app: who deleted what, with which selection (audit trail). */
entity CleanupLogs : cuid, managed {
  /** e.g. "Test runs 120, Saved messages 14" */
  summary      : String(500);
  status       : CleanupStatus;
  /** the CleanupService.CleanupRequest as JSON */
  request      : LargeString;
  /** JSON array of { category, count, cutoff } */
  counts       : LargeString;
  totalCount   : Integer default 0;
  durationMs   : Integer;
  /** the saved rule the cleanup was started from, if any (a name, so the log survives deleting the rule) */
  ruleName     : String(100);
  errorMessage : String(1000);
}

/** Saved selections of the Data Cleanup app, to repeat a cleanup with one click. */
@assert.unique: {name: [name]}
entity CleanupRules : cuid, managed {
  name        : String(100) @mandatory;
  description : String(500);
  /** the CleanupService.CleanupRequest as JSON */
  request     : LargeString @mandatory;
  lastRunAt   : Timestamp;
}

// ---------------------------------------------------------------------------------------------- field titles
// Titles and tooltips of the fields, for every app and service (CAP passes them on to the projections).
// The apps (app/*/annotations.cds) only add their layout. Timestamps are worded "<what> At".

annotate Brokers with {
  name                  @title: '{i18n>Name}';
  description           @title: '{i18n>Description}';
  credentialMode        @title: '{i18n>Credentials}';
  destinationName       @title: '{i18n>Destination}'
                        @Common.QuickInfo: '{i18n>InfoBTPDestinationURLWssEndpointAddition}';
  url                   @title: '{i18n>URL}'
                        @Common.QuickInfo: '{i18n>InfoHostIsEnoughEGMrXyzMessagingSolaceCl}';
  msgVpn                @title: '{i18n>MessageVPN}';
  username              @title: '{i18n>Username}'
                        @Common.QuickInfo: '{i18n>InfoOptionalIfEmptyTheUsernameIsAskedFor}';
  clientNamePrefix      @title: '{i18n>ClientNamePrefix}';
  connectTimeoutMs      @title: '{i18n>ConnectTimeoutMs}';
  active                @title: '{i18n>Active}';
  agentAllowed          @title: '{i18n>AvailableForAIAgents}'
                        @Common.QuickInfo: '{i18n>InfoAIAssistantsMCPMayPreviewAndRunTests}';
  lastConnectionStatus  @title: '{i18n>Status}';
  lastConnectionAt      @title: '{i18n>TestedAt}';
  lastConnectionMessage @title: '{i18n>Message}';
};

annotate Variables with {
  name  @title: '{i18n>Name}'  @Common.QuickInfo: '{i18n>InfoReferenceItInDoubleCurlyBracesInTopi}';
  value @title: '{i18n>Value}';
};

annotate TestCases with {
  name          @title: '{i18n>Name}'  @Common.QuickInfo: '{i18n>InfoTestCasesEmptyTopic}';
  kind          @title: '{i18n>Type}';
  description   @title: '{i18n>Description}';
  topic         @title: '{i18n>Topic}'  @Common.QuickInfo: '{i18n>InfoSupportsTemplateVariablesInDoubleCur}';
  payload       @title: '{i18n>Payload}';
  contentType   @title: '{i18n>ContentType}'  @Common.QuickInfo: '{i18n>InfoDefaultApplicationJsonEmptyDetectedO}';
  deliveryMode  @title: '{i18n>DeliveryMode}';
  timeToLiveMs  @title: '{i18n>TimeToLiveMs}'  @Common.QuickInfo: '{i18n>InfoEmptyOr0NoExpiry}';
  dmqEligible   @title: '{i18n>DMQEligible}'  @Common.QuickInfo: '{i18n>InfoEmptyBrokerDefault}';
  priority      @title: '{i18n>Priority0255}'  @Common.QuickInfo: '{i18n>InfoEmptyBrokerDefault}';
  correlationId @title: '{i18n>CorrelationID}'  @Common.QuickInfo: '{i18n>InfoSupportsTemplateVariablesInDoubleCur2}';
  ackTimeoutMs  @title: '{i18n>ACKTimeoutMs}';
  createdBy     @title: '{i18n>CreatedBy}';
  modifiedAt    @title: '{i18n>ChangedAt}';
  modifiedBy    @title: '{i18n>ChangedBy}';
};

annotate TestCaseProperties with {
  name  @title: '{i18n>Name}';
  value @title: '{i18n>Value}'  @Common.QuickInfo: '{i18n>InfoSupportsTemplateVariablesInDoubleCur3}';
  type  @title: '{i18n>Type}'  @Common.QuickInfo: '{i18n>InfoEmptyDetectedOnSave42IntegerTrueBool}';
};

annotate TestCaseVariables with {
  name  @title: '{i18n>Name}';
  value @title: '{i18n>Value}';
};

annotate TestCaseStats with {
  status  @title: '{i18n>Status}';
  runAt   @title: '{i18n>RunAt}';
  brokers @title: '{i18n>Brokers}';
  message @title: '{i18n>Problems}';
};

annotate TestRuns with {
  createdAt       @title: '{i18n>StartedAt}';
  createdBy       @title: '{i18n>StartedBy}';
  summary         @title: '{i18n>TestCasesBrokers}';
  startedAt       @title: '{i18n>StartedAt}';
  finishedAt      @title: '{i18n>FinishedAt}';
  status          @title: '{i18n>RunStatus}';
  totalCount      @title: '{i18n>Total}';
  passedCount     @title: '{i18n>Passed}';
  failedCount     @title: '{i18n>FailedError}';
  skippedCount    @title: '{i18n>NotSent}'  @Common.QuickInfo: '{i18n>InfoMessagesThatWereNotSentTheRunWasStop}';
  repetitions     @title: '{i18n>Repetitions}';
  repetitionOrder @title: '{i18n>Order}'  @Common.QuickInfo: '{i18n>InfoWholeSelectionABCABCOrEachTestCaseIn}';
  delayMs         @title: '{i18n>PauseMs}'  @Common.QuickInfo: '{i18n>InfoPauseBetweenTwoMessagesToTheSameBrok}';
  stopOnFailure   @title: '{i18n>StopAtFirstFailure}';
};

annotate RunResults with {
  testCaseName    @title: '{i18n>TestCase}';
  brokerName      @title: '{i18n>Broker}';
  status          @title: '{i18n>Status}';
  iteration       @title: '{i18n>Repetition}'  @Common.QuickInfo: '{i18n>InfoWhichRepetitionOfTheTestCaseThisIs1T}';
  deliveryMode    @title: '{i18n>DeliveryMode}';
  resolvedTopic   @title: '{i18n>Topic}';
  resolvedPayload @title: '{i18n>Payload}';
  correlationId   @title: '{i18n>CorrelationID}';
  ackLatencyMs    @title: '{i18n>ACKLatencyMs}';
  errorMessage    @title: '{i18n>Error}';
  executedAt      @title: '{i18n>ExecutedAt}';
};

annotate ReceivedMessages with {
  brokerName     @title: '{i18n>Broker}';
  source         @title: '{i18n>SubscriptionQueue}';
  sourceType     @title: '{i18n>SourceType}';
  topic          @title: '{i18n>Topic}';
  payload        @title: '{i18n>Payload}';
  contentType    @title: '{i18n>ContentType}';
  userProperties @title: '{i18n>UserProperties}';
  correlationId  @title: '{i18n>CorrelationID}';
  deliveryMode   @title: '{i18n>DeliveryMode}';
  receivedAt     @title: '{i18n>ReceivedAt}';
  createdBy      @title: '{i18n>SavedBy}';
};

annotate NumberRanges with {
  name        @title: '{i18n>Name}'  @Common.QuickInfo: '{i18n>InfoUseItInTopicsPayloadsCorrelationIdsA}';
  description @title: '{i18n>Description}';
  prefix      @title: '{i18n>Prefix}'  @Common.QuickInfo: '{i18n>InfoTextInFrontOfTheNumberEGSO}';
  suffix      @title: '{i18n>Suffix}'  @Common.QuickInfo: '{i18n>InfoTextAfterTheNumberEGEU}';
  length      @title: '{i18n>Digits}'  @Common.QuickInfo: '{i18n>InfoLengthOfTheNumberFilledWithLeadingZe}';
  start       @title: '{i18n>FirstNumber}';
  step        @title: '{i18n>Step}'  @Common.QuickInfo: '{i18n>InfoIncrementBetweenTwoNumbers}';
  maximum     @title: '{i18n>LastAllowedNumber}'  @Common.QuickInfo: '{i18n>InfoEmptyUntilTheNumberNoLongerFitsIntoT}';
  lastUsedAt  @title: '{i18n>LastUsedAt}'  @Common.QuickInfo: '{i18n>InfoWhenARunTookANumberLast}';
};

annotate CleanupLogs with {
  createdAt    @title: '{i18n>CleanedUpAt}';
  createdBy    @title: '{i18n>CleanedUpBy}';
  summary      @title: '{i18n>Summary}';
  status       @title: '{i18n>Status}';
  totalCount   @title: '{i18n>Deleted}';
  durationMs   @title: '{i18n>DurationMs}';
  ruleName     @title: '{i18n>CleanupRule}';
  errorMessage @title: '{i18n>Error}';
};

annotate CleanupRules with {
  name        @title: '{i18n>Name}';
  description @title: '{i18n>Description}';
  lastRunAt   @title: '{i18n>LastRunAt}';
  modifiedAt  @title: '{i18n>ChangedAt}';
  modifiedBy  @title: '{i18n>ChangedBy}';
};
