/**
 * Start page of the suite (Home app): who is logged in, which apps the roles open, and a few figures.
 * Open to every logged-in user - the figures are only filled for what the user's roles allow (else null).
 */
@path    : '/odata/v4/home'
@requires: 'authenticated-user'
service HomeService {

  type RecentRun {
    ID          : UUID;
    summary     : String(500);
    startedAt   : Timestamp;
    startedBy   : String(255);
    /** RUNNING, PASSED, FAILED or STOPPED (as TestRuns.outcome) */
    outcome     : String(10);
    totalCount  : Integer;
    passedCount : Integer;
    failedCount : Integer;
  }

  type Overview {
    user              : String(255);
    /** first name from the login (token claim given_name), empty if the login has none: the start page greets with it */
    firstName         : String(255);
    tester            : Boolean;
    admin             : Boolean;
    // ---- role Tester
    testCases         : Integer;
    folders           : Integer;
    myTestCases       : Integer;
    /** runs started in the last 7 days */
    runsLast7Days     : Integer;
    runningRuns       : Integer;
    /** results of the runs of the last 7 days */
    resultsPassed     : Integer;
    resultsFailed     : Integer;
    /** passed results in percent, null without results */
    passRate          : Integer;
    lastRuns          : many RecentRun;
    /** active brokers and their last connection test */
    brokers           : Integer;
    brokersOk         : Integer;
    brokersFailing    : Integer;
    brokersUntested   : Integer;
    /** names of the active brokers whose last connection test failed */
    failingBrokers    : many String(100);
    savedMessages     : Integer;
    /** live subscriptions of this user */
    liveSubscriptions : Integer;
  }

  function overview() returns Overview;
}
