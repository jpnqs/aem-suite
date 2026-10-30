/**
 * Types that more than one service returns or takes (TestService for the UI, TestAgentService for AI agents).
 * The services name them as their own types (`type ExportResult : api.ExportResult;`), so their OData / MCP
 * metadata stays the same, but the fields are defined here once.
 */
namespace aem.suite.api;

type ExportResult {
  /** suggested file name */
  filename  : String;
  /** the JSON file: { format, version, exportedAt, nodes: [ nested folders / test cases without IDs ] } */
  content   : LargeString;
  folders   : Integer;
  testCases : Integer;
}

type ImportRoot {
  ID   : UUID;
  name : String;
  kind : String;
}

type ImportResult {
  dryRun         : Boolean;
  folders        : Integer;
  testCases      : Integer;
  userProperties : Integer;
  variables      : Integer;
  roots          : many ImportRoot;
  /** name of the target folder, empty = top level */
  target         : String;
}

/** The message of a test case as it would be sent (variables resolved); valid = false: message says why not. */
type Preview {
  valid          : Boolean;
  message        : String;
  topic          : String;
  payload        : LargeString;
  correlationId  : String;
  userProperties : LargeString;
}

/**
 * Password of a DIRECT broker for one run - used in memory only, never stored.
 * The username is only needed if none is maintained on the broker.
 */
type BrokerCredential {
  brokerId : UUID;
  username : String;
  password : String;
}

/** The started run; total = number of messages (test cases x brokers x repetitions). */
type RunRef {
  runId : UUID;
  total : Integer;
}
