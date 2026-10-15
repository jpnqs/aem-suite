using {aem.suite as db} from '../db/schema';

/** Broker and global variable administration. */
@path    : '/odata/v4/admin'
@requires: 'Admin'
service AdminService {

  @odata.draft.enabled
  @Common.SideEffects #connection: {
    SourceEntities  : ['/AdminService.EntityContainer/Brokers'],
    TargetProperties: ['lastConnectionStatus', 'lastConnectionAt', 'lastConnectionMessage']
  }
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
      @Common.SideEffects     : {TargetProperties: [
        'in/lastConnectionStatus',
        'in/lastConnectionAt',
        'in/lastConnectionMessage',
        'in/connectionCriticality'
      ]}
      action testConnection(username : String @Common.Label: 'Username (only if not maintained on the broker)',
                            password : String @UI.Masked
                                              @Common.Label: 'Password (direct mode only, not stored)') returns ConnectionResult;
    };

  entity BrokerVariables as projection on db.Variables;

  @readonly
  entity CredentialModes as projection on db.CredentialModes;

  /** Value help: destinations of the bound destination service (BTP) or env "destinations" (local). */
  @readonly
  @cds.persistence.skip
  entity Destinations {
    key name           : String(200) @title: 'Destination';
        url            : String(500) @title: 'URL';
        msgVpn         : String(100) @title: 'Message VPN';
        authentication : String(50)  @title: 'Authentication';
        source         : String(3)   @title: 'Source';
  }

  @odata.draft.enabled
  entity GlobalVariables as projection on db.Variables where broker.ID is null;

  type ConnectionResult {
    ok        : Boolean;
    message   : String;
    latencyMs : Integer;
  }
}
