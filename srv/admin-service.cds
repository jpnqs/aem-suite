using {aem.suite as db} from '../db/schema';

/** Broker and global variable administration. */
@path    : '/odata/v4/admin'
@requires: 'Admin'
// imports of configuration files are sent as one request
@cds.server.body_parser.limit: '2mb'
service AdminService {

  @odata.draft.enabled
  entity Brokers as
    projection on db.Brokers {
      *,
      variables : redirected to BrokerVariables,
      case
        when lastConnectionStatus = 'OK'    then 3
        when lastConnectionStatus = 'ERROR' then 1
        else 0
      end as connectionCriticality : Integer
    }
    actions {
      /**
       * Opens and closes a session against the broker and records the result.
       * DIRECT mode needs the password - it is used for this test only and never stored.
       * The username is only needed if none is maintained on the broker.
       */
      @Core.OperationAvailable: in.IsActiveEntity
      action testConnection(username : String, password : String) returns ConnectionResult;
    };

  // written by the connection test only
  annotate Brokers with {
    lastConnectionStatus  @readonly;
    lastConnectionAt      @readonly;
    lastConnectionMessage @readonly;
  };

  entity BrokerVariables as projection on db.Variables;

  /** Messages and acknowledgement latency per broker and day (section "Last Days" of a broker). */
  @readonly
  entity BrokerDailyStats as
    projection on db.BrokerDailyStats {
      *,
      @title: '{i18n>PassRate}'
      case when messages > 0 then cast(round(100.0 * passed / messages, 0) as Integer) else null end as passRate : Integer,
      @title: '{i18n>ACKLatencyAvgMs}'
      case when ackCount > 0 then cast(round(1.0 * ackSumMs / ackCount, 0) as Integer) else null end as ackAvgMs : Integer,
      case when messages > 0 and passed = messages then 3 when messages > 0 and passed = 0 then 1 when messages > 0 then 2 else 0 end as criticality : Integer
    };

  @readonly
  entity CredentialModes as projection on db.CredentialModes;

  /** Value help: destinations of the bound destination service (BTP) or env "destinations" (local). */
  @readonly
  @cds.persistence.skip
  entity Destinations {
    key name           : String(200) @title: '{i18n>Destination}';
        url            : String(500) @title: '{i18n>URL}';
        msgVpn         : String(100) @title: '{i18n>MessageVPN}';
        authentication : String(50)  @title: '{i18n>Authentication}';
        source         : String(3)   @title: '{i18n>Source}';
  }

  @odata.draft.enabled
  entity GlobalVariables as projection on db.Variables where broker.ID is null;

  /** Number ranges for template numbers: {{numberRange.<name>}} (see the Number Ranges app). */
  @odata.draft.enabled
  entity NumberRanges as
    projection on db.NumberRanges {
      *,
      virtual lastNumber : String @title: '{i18n>LastIssued}',
      virtual nextNumber : String @title: '{i18n>NextNumber}'
    }
    actions {
      /**
       * Sets the range back (or forward): the number given is the next one issued. Empty = the start of the range.
       */
      @Core.OperationAvailable: in.IsActiveEntity
      action reset(nextNumber : Integer64);

      /** Issues the next number, as a run does - to try the range out. */
      @Core.OperationAvailable: in.IsActiveEntity
      action countUp();

      /** Gives the last issued number back: the next number issued is that one again. */
      @Core.OperationAvailable: in.IsActiveEntity
      action countDown();
    };

  /** What a configuration file holds: number ranges, brokers (with their variables) or global variables. */
  type ConfigKind : String enum {
    NUMBER_RANGES;
    BROKERS;
    VARIABLES;
  }

  /**
   * Exports number ranges, brokers or global variables as the content of a JSON file; without ids all of the kind.
   * Without IDs, authors, number range counters and connection status - and brokers have no stored passwords.
   */
  action exportConfig(kind : ConfigKind not null, ids : many UUID) returns ConfigExportResult;

  /**
   * Imports a file of exportConfig: every entry is added as a new one, existing entries are never changed. A taken
   * name gets a number ("ORDERS_2", "aem-dev (2)"). All or nothing; dryRun only checks the file.
   */
  action importConfig(kind : ConfigKind not null, content : LargeString not null, dryRun : Boolean) returns ConfigImportResult;

  type ConfigExportResult {
    /** suggested file name */
    filename : String;
    /** the JSON file: { format, version, exportedAt, <numberRanges | brokers | variables>: [ ... ] } */
    content  : LargeString;
    count    : Integer;
  }

  type ConfigImportResult {
    dryRun  : Boolean;
    created : Integer;
    /** entries whose name was taken: the name in the file and the one they get */
    renamed : many {
      name    : String;
      newName : String;
    };
  }

  type ConnectionResult {
    ok        : Boolean;
    message   : String;
    latencyMs : Integer;
  }
}
