using {aem.suite as db} from '../db/schema';
using {aem.suite.api as api} from './common';

/** Test case maintenance and execution. */
@path    : '/odata/v4/test'
@requires: 'Tester'
// imports of whole test suites are sent as one request
@cds.server.body_parser.limit: '5mb'
service TestService {

  // a node stays a folder or a test case
  annotate TestCases with {
    kind @Core.Immutable;
  };

  @odata.draft.enabled
  @singular: 'TestCase' // cds-typer would derive "TestCas" (the annotation of db.TestCases is not inherited)
  entity TestCases as
    projection on db.TestCases {
      *,
      case when kind = 'FOLDER' then 'Folder' else 'Test Case' end as kindText : String(20),
      // the quick variant "My Test Cases" of the list (a selection variant cannot name the logged-in user)
      @title: '{i18n>CreatedByMe}'
      case when createdBy = $user then true else false end         as createdByMe : Boolean,
      // navigation target (launchpad intent) of the name column of the folder contents
      '#AEMSuiteTestCases-manage&/TestCases(ID=' || ID || ',IsActiveEntity=true)' as nodeLink : String,
      // the documentation (description, Markdown) as HTML for the rich text editor - converted both ways by srv/test-service.ts
      // written too (not computed): the editor sends its HTML here
      @Core.Computed: false
      virtual null as descriptionHtml : LargeString,
      // computed by CAP for hierarchy requests of the tree table
      null as LimitedDescendantCount : Int16,
      null as DistanceFromRoot       : Int16,
      null as DrillState             : String,
      null as LimitedRank            : Int16
    }
    actions {
      /** Runs this test case against the given brokers. Returns the started run (executes asynchronously). */
      @Core.OperationAvailable: in.IsActiveEntity
      action runTest(brokerIds : many UUID not null, credentials : many BrokerCredential, options : RunOptions) returns RunRef;

      /** Resolves topic, payload and properties against a broker's variables without sending anything. */
      action preview(brokerId : UUID) returns Preview;

      /**
       * What templates of this test case can use - its variables (where they come from, their value), the number
       * ranges and the faker.js expressions - for the suggestions of the payload editor. Built-ins are not listed.
       */
      action templateHints() returns many TemplateHint;

      /** Copies this test case or folder (a folder with everything below it); the copy is placed right after the original. */
      @Core.OperationAvailable: in.IsActiveEntity
      action duplicate() returns TestCases;

      /** Drag & drop ordering (Hierarchy ChangeNextSiblingAction): place this node before NextSibling (null = last). */
      action moveBefore(NextSibling : SiblingKey);
    };

  type TemplateHint {
    /** what goes between {{ and }} */
    expression : String;
    /** VARIABLE, NUMBER_RANGE or FAKER */
    kind       : String;
    /** where the value comes from, e.g. 'Folder "Orders"' */
    source     : String;
    /** the value it resolves to, or an example; empty if it depends on the broker */
    value      : String;
    /** all definitions of a variable in lookup order, the description of a number range */
    details    : String;
  }

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
      /** runs need options.confirmProduction */
      production,
      lastConnectionStatus
    }
    where active = true;

  @readonly
  entity TestRuns as
    projection on db.TestRuns {
      *,
      // keep in sync with runOutcome() in srv/lib/runs/test-runner.ts
      case
        when status = 'RUNNING' then 'RUNNING'
        when status = 'FAILED'  then 'FAILED'
        when failedCount > 0    then 'FAILED'
        when status = 'STOPPED' then 'STOPPED'
        else 'PASSED'
      end as outcome : String(10) @title: '{i18n>Result}',
      // PASSED 3, FAILED 1, RUNNING and STOPPED 2 (warning)
      case status
        when 'DONE'    then (case when failedCount > 0 then 1 else 3 end)
        when 'FAILED'  then 1
        when 'STOPPED' then (case when failedCount > 0 then 1 else 2 end)
        else 2
      end as statusCriticality : Integer
    };

  @readonly
  entity RunResults as
    projection on db.RunResults {
      *,
      // run data, so the result list can be filtered and sorted by it
      @title: '{i18n>RunStartedAt}'
      run.createdAt as runStartedAt,
      @title: '{i18n>StartedBy}'
      run.createdBy as runStartedBy,
      run.creator.name as runStartedByName : String(511),
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
      end as criticality : Integer,
      // flaky is a warning
      case when flaky = true then 2 else 0 end as flakyCriticality : Integer
    };

  /**
   * Compares two runs per test case and broker (repetitions folded into the worst outcome): BROKEN, FIXED, NEW,
   * GONE, STILL_FAILING or STILL_PASSING - the changes first.
   */
  function compareRuns(baseRunId : UUID not null, otherRunId : UUID not null) returns many RunComparison;

  type RunComparison {
    testCase          : String;
    broker            : String;
    baseStatus        : String;
    otherStatus       : String;
    change            : String;
    baseAckLatencyMs  : Integer;
    otherAckLatencyMs : Integer;
  }

  @readonly
  entity DeliveryModes as projection on db.DeliveryModes;

  /** Names of the users (TestCases.creator: the text of createdBy). */
  @readonly
  entity Users as projection on db.Users;

  /** The users that created test cases - value help of the "Created By" filter. */
  @readonly
  @cds.redirection.target: false
  entity Creators as
    select from db.TestCases distinct {
      key createdBy    as ID   : String(255) @title: '{i18n>User}',
          creator.name as name : String(511) @title: '{i18n>Name}'
    }
    where
      createdBy is not null;

  /** The names of test cases and folders - value help of the "Name" filter. */
  @readonly
  @cds.redirection.target: false
  entity TestCaseNames as
    select from db.TestCases distinct {
      key name
    }
    where
      name is not null;

  /** The topics of test cases - value help of the "Topic" filter. */
  @readonly
  @cds.redirection.target: false
  entity Topics as
    select from db.TestCases distinct {
      key topic
    }
    where
      topic is not null;

  @readonly
  entity PropertyTypes as projection on db.PropertyTypes;

  @readonly
  entity ResultStatuses as projection on db.ResultStatuses;

  // dropdowns show the name only, the result statuses in their own order (UI.PresentationVariant #byPosition)
  annotate DeliveryModes with {
    code @Common.Text: name  @Common.TextArrangement: #TextOnly;
  };

  annotate ResultStatuses with @UI.PresentationVariant #byPosition: {SortOrder: [{Property: position}]} {
    code     @Common.Text: name  @Common.TextArrangement: #TextOnly;
    position @UI.Hidden;
  };

  // ---- value helps of the result list filters (Test Runs app): the values of the existing results ----

  /** The users that started runs. */
  @readonly
  @cds.redirection.target: false
  entity RunStarters as
    select from db.TestRuns distinct {
      key createdBy    as ID   : String(255) @title: '{i18n>User}',
          creator.name as name : String(511) @title: '{i18n>Name}'
    }
    where
      createdBy is not null;

  /** The test case names of the results (snapshots: also of deleted or renamed test cases). */
  @readonly
  @cds.redirection.target: false
  entity ResultTestCaseNames as
    select from db.RunResults distinct {
      key testCaseName
    }
    where
      testCaseName is not null;

  /** The broker names of the results (snapshots). */
  @readonly
  @cds.redirection.target: false
  entity ResultBrokerNames as
    select from db.RunResults distinct {
      key brokerName
    }
    where
      brokerName is not null;

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

  type ExportResult : api.ExportResult;

  /**
   * Imports the content of an export file as new test cases and folders below parentId (empty = top level).
   * Existing nodes are never changed. All or nothing: if anything in the file is invalid, nothing is imported.
   * With dryRun the file is only checked and counted.
   */
  action importNodes(content : LargeString not null, parentId : UUID, dryRun : Boolean) returns ImportResult;

  type ImportResult : api.ImportResult;

  /** ID of the logged-in user - used to prefill "Created by" / "Started by" filters. */
  function currentUser() returns String;

  /** Runs several test cases against several brokers in one run. */
  action runTests(testCaseIds : many UUID not null, brokerIds : many UUID not null, credentials : many BrokerCredential, options : RunOptions) returns RunRef;

  /**
   * Stops a running run: messages not sent yet are skipped (status SKIPPED). Allowed for the user who started the run
   * (and administrators).
   */
  action cancelRun(runId : UUID not null);

  /**
   * Advanced run settings. All optional.
   *   repetitions   how often every test case is sent to every broker (1 - 1000, default 1)
   *   delayMs       pause between two messages to the same broker (0 - 60000, default 0)
   *   order         ROUND: the whole selection N times (a b c a b c); EACH: every test case N times in a row (a a b b c c)
   *   stopOnFailure after the first failed message of a broker, the rest of that broker is skipped
   */
  type RunOptions {
    repetitions   : Integer;
    delayMs       : Integer;
    order         : String;
    stopOnFailure : Boolean;
    /** required when a production broker is selected (Brokers.production) */
    confirmProduction : Boolean;
  }

  type BrokerCredential : api.BrokerCredential;
  type RunRef : api.RunRef;
  type Preview : api.Preview;
}
