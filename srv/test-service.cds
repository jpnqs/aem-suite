using {aem.suite as db} from '../db/schema';

/** Test case maintenance and execution. */
@path    : '/odata/v4/test'
@requires: 'Tester'
// imports of whole test suites are sent as one request
@cds.server.body_parser.limit: '5mb'
service TestService {

  @odata.draft.enabled
  entity TestCases as
    projection on db.TestCases {
      *,
      case when kind = 'FOLDER' then 'Folder' else 'Test Case' end as kindText : String(20),
      // computed by CAP for hierarchy requests of the tree table
      null as LimitedDescendantCount : Int16,
      null as DistanceFromRoot       : Int16,
      null as DrillState             : String,
      null as LimitedRank            : Int16
    }
    actions {
      /** Runs this test case against the given brokers. Returns the started run (executes asynchronously). */
      @Core.OperationAvailable: in.IsActiveEntity
      action runTest(brokerIds : many UUID not null, credentials : many BrokerCredential) returns RunRef;

      /** Resolves topic, payload and properties against a broker's variables without sending anything. */
      action preview(brokerId : UUID) returns Preview;

      /** Copies this test case or folder (a folder with everything below it); the copy is placed right after the original. */
      @Core.OperationAvailable: in.IsActiveEntity
      action duplicate() returns TestCases;

      /** Drag & drop ordering (Hierarchy ChangeNextSiblingAction): place this node before NextSibling (null = last). */
      action moveBefore(NextSibling : SiblingKey);
    };

  type SiblingKey {
    ID             : UUID;
    IsActiveEntity : Boolean;
  }

  // ---- tree table (CAP hierarchy support) ----
  annotate TestCases with @(
    Aggregation.RecursiveHierarchy #TestTree    : {
      $Type                   : 'Aggregation.RecursiveHierarchyType',
      NodeProperty            : ID,
      ParentNavigationProperty: parent
    },
    Hierarchy.RecursiveHierarchy #TestTree      : {
      $Type                 : 'Hierarchy.RecursiveHierarchyType',
      LimitedDescendantCount: LimitedDescendantCount,
      DistanceFromRoot      : DistanceFromRoot,
      DrillState            : DrillState,
      LimitedRank           : LimitedRank
    },
    Hierarchy.RecursiveHierarchyActions #TestTree: {
      $Type                  : 'Hierarchy.RecursiveHierarchyActionsType',
      ChangeNextSiblingAction: 'TestService.moveBefore'
    },
    Capabilities.FilterRestrictions.NonFilterableProperties: [
      'LimitedDescendantCount',
      'DistanceFromRoot',
      'DrillState',
      'LimitedRank'
    ],
    Capabilities.SortRestrictions.NonSortableProperties    : [
      'LimitedDescendantCount',
      'DistanceFromRoot',
      'DrillState',
      'LimitedRank'
    ]
  );

  @readonly
  entity Brokers as
    projection on db.Brokers {
      ID,
      name,
      description,
      credentialMode,
      username,
      url,
      msgVpn,
      active,
      lastConnectionStatus
    }
    where active = true;

  @readonly
  entity TestRuns as
    projection on db.TestRuns {
      *,
      // keep in sync with runOutcome() in srv/lib/test-runner.ts
      case
        when status = 'RUNNING' then 'RUNNING'
        when status = 'FAILED'  then 'FAILED'
        when failedCount > 0    then 'FAILED'
        else 'PASSED'
      end as outcome : String(10),
      case status
        when 'DONE'   then (case when failedCount > 0 then 1 else 3 end)
        when 'FAILED' then 1
        else 2
      end as statusCriticality : Integer
    };

  @readonly
  entity RunResults as
    projection on db.RunResults {
      *,
      // run data, so the result list can be filtered and sorted by it
      run.createdAt as runStartedAt,
      run.createdBy as runStartedBy,
      // navigation targets (launchpad intents) for the link columns
      '#AEMSuiteTestCases-manage&/TestCases(ID=' || testCase.ID || ',IsActiveEntity=true)' as testCaseLink : String,
      '#AEMSuiteBrokers-manage&/Brokers(ID=' || broker.ID || ',IsActiveEntity=true)'       as brokerLink   : String,
      '#AEMSuiteTestRuns-display&/TestRuns(' || run.ID || ')'                              as runLink      : String,
      case status
        when 'PASSED' then 3
        when 'FAILED' then 1
        when 'ERROR'  then 1
        else 0
      end as statusCriticality : Integer
    };

  @readonly
  entity TestCaseStats as
    projection on db.TestCaseStats {
      *,
      case status
        when 'PASSED' then 3
        when 'FAILED' then 1
        when 'ERROR'  then 1
        else 0
      end as criticality : Integer
    };

  @readonly
  entity DeliveryModes as projection on db.DeliveryModes;

  @readonly
  entity PropertyTypes as projection on db.PropertyTypes;

  /**
   * Copies test cases and folders (folders with everything below them: subfolders, test cases, variables,
   * user properties). A selected node below another selected folder is copied with that folder only.
   * Each copy is placed right after its original and named "<name> (Copy)".
   */
  action copyNodes(ids : many UUID not null) returns many CopyResult;

  type CopyResult {
    ID   : UUID;
    name : String;
  }

  /**
   * Exports test cases and folders (a folder with everything below it) as the content of a JSON file.
   * Without ids the whole tree is exported.
   */
  action exportNodes(ids : many UUID) returns ExportResult;

  type ExportResult {
    /** suggested file name */
    filename  : String;
    content   : LargeString;
    folders   : Integer;
    testCases : Integer;
  }

  /**
   * Imports the content of an export file as new test cases and folders below parentId (empty = top level).
   * Existing nodes are never changed. All or nothing: if anything in the file is invalid, nothing is imported.
   * With dryRun the file is only checked and counted.
   */
  action importNodes(content : LargeString not null, parentId : UUID, dryRun : Boolean) returns ImportResult;

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

  /** ID of the logged-in user - used to prefill "Created by" / "Started by" filters. */
  function currentUser() returns String;

  /** Runs several test cases against several brokers in one run. */
  action runTests(testCaseIds : many UUID not null, brokerIds : many UUID not null, credentials : many BrokerCredential) returns RunRef;

  /**
   * Password of a DIRECT broker for one run - used in memory only, never stored.
   * The username is only needed if none is maintained on the broker.
   */
  type BrokerCredential {
    brokerId : UUID;
    username : String;
    password : String;
  }

  type RunRef {
    runId : UUID;
  }

  type Preview {
    topic          : String;
    payload        : LargeString;
    correlationId  : String;
    userProperties : LargeString;
    valid          : Boolean;
    message        : String;
  }
}
