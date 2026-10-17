using {aem.suite as db} from '../db/schema';

/** Broker and global variable administration. */
@path    : '/odata/v4/admin'
@requires: 'Admin'
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
    };

  type ConnectionResult {
    ok        : Boolean;
    message   : String;
    latencyMs : Integer;
  }
}
