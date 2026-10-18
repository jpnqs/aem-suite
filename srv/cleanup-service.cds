using {aem.suite as db} from '../db/schema';

/**
 * Data Cleanup app: deletes old test runs, run payloads, saved messages, subscriber setups and orphaned rows.
 * Always in two steps - preview (counts and samples, nothing deleted) and execute - and every execution is logged.
 * Not wired to MCP.
 */
@path    : '/odata/v4/cleanup'
@requires: 'Admin'
service CleanupService {

  @assert.range
  type AgeUnit         : String(6) enum {
    DAYS;
    WEEKS;
    MONTHS;
    YEARS;
  }

  /** "older than 3 MONTHS" or "before 2026-01-01" (before wins) - the age is at least one day */
  type Age {
    value  : Integer;
    unit   : AgeUnit;
    before : Date;
  }

  /** test runs (RUNS) and their payloads (RUN_PAYLOADS); running runs are never touched */
  type RunCriteria {
    age             : Age;
    /** PASSED, FAILED, STOPPED as the Test Runs app shows them; empty = all */
    outcomes        : many String(10);
    /** user names (createdBy); empty = all */
    startedBy       : many String(255);
    /** runs that sent to one of these brokers; empty = all */
    brokerIds       : many UUID;
    summaryContains : String(200);
    /** the newest N runs are always kept (0 / empty = none) */
    keepNewest      : Integer;
  }

  type MessageCriteria {
    age           : Age;
    brokerIds     : many UUID;
    savedBy       : many String(255);
    sourceTypes   : many db.SourceType;
    topicContains : String(200);
  }

  type PresetCriteria {
    age            : Age;
    users          : many String(255);
    brokerIds      : many UUID;
    /** only setups of brokers that are switched off */
    inactiveBroker : Boolean;
  }

  /** rows that point to a broker / test case that no longer exists - no age */
  type OrphanCriteria {
    messages  : Boolean;
    presets   : Boolean;
    stats     : Boolean;
    variables : Boolean;
  }

  /** what to clean up - a category that is left empty is not touched */
  type CleanupRequest {
    runs        : RunCriteria;
    runPayloads : RunCriteria;
    messages    : MessageCriteria;
    presets     : PresetCriteria;
    orphans     : OrphanCriteria;
  }

  /** RUNS, RUN_PAYLOADS, MESSAGES, PRESETS, ORPHAN_MESSAGES, ORPHAN_PRESETS, ORPHAN_STATS, ORPHAN_VARIABLES */
  type Category        : String(20);

  type Sample {
    ID    : String(36);
    title : String(500);
    info  : String(500);
    date  : Timestamp;
  }

  type CategoryResult {
    category : Category;
    count    : Integer;
    /** empty for orphans */
    cutoff   : Timestamp;
    /** the newest rows that would be cleaned up (at most 10) */
    samples  : many Sample;
  }

  type CategoryCount {
    category : Category;
    count    : Integer;
  }

  type ExecuteResult {
    logId      : UUID;
    totalCount : Integer;
    counts     : many CategoryCount;
  }

  /** Counts what execute would clean up, with the newest samples - deletes nothing. */
  action   preview(request : CleanupRequest)                                                         returns many CategoryResult;

  /**
   * Cleans up. `expected` are the counts of the preview: if more rows match now (new data in between), nothing
   * is deleted (409) - preview again. `ruleName` only goes into the log.
   */
  action   execute(request : CleanupRequest, expected : many CategoryCount, ruleName : String(100)) returns ExecuteResult;

  /** Users that started runs, saved messages or setups - value help of the "by user" criteria. */
  function users()                                                                                    returns many String;

  @readonly
  entity CleanupLogs  as projection on db.CleanupLogs;

  /** Saved selections; `request` is a CleanupRequest as JSON. */
  entity CleanupRules as projection on db.CleanupRules;

  @readonly
  entity Brokers      as
    projection on db.Brokers {
      ID,
      name,
      active
    };
}
