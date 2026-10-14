using {aem.suite as db} from '../db/schema';

/** Test case maintenance and execution. */
@path    : '/odata/v4/test'
@requires: 'Tester'
service TestService {

  @odata.draft.enabled
  entity TestCases as projection on db.TestCases
    actions {
      /** Runs this test case against the given brokers. Returns the started run (executes asynchronously). */
      @Core.OperationAvailable: in.IsActiveEntity
      action runTest(brokerIds : many UUID not null, credentials : many BrokerCredential) returns RunRef;

      /** Resolves topic, payload and properties against a broker's variables without sending anything. */
      action preview(brokerId : UUID) returns Preview;

      @Core.OperationAvailable: in.IsActiveEntity
      action duplicate() returns TestCases;
    };

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
      case status
        when 'PASSED' then 3
        when 'FAILED' then 1
        when 'ERROR'  then 1
        else 0
      end as statusCriticality : Integer
    };

  @readonly
  entity DeliveryModes as projection on db.DeliveryModes;

  @readonly
  entity PropertyTypes as projection on db.PropertyTypes;

  /** Runs several test cases against several brokers in one run. */
  action runTests(testCaseIds : many UUID not null, brokerIds : many UUID not null, credentials : many BrokerCredential) returns RunRef;

  /** Password of a DIRECT broker for one run - used in memory only, never stored. */
  type BrokerCredential {
    brokerId : UUID;
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
