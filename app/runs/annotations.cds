using TestService as service from '../../srv/test-service';

annotate service.TestRuns with @(
  UI.HeaderInfo        : {
    TypeName      : 'Test Run',
    TypeNamePlural: 'Test Runs',
    Title         : {Value: summary},
    Description   : {Value: createdAt}
  },
  UI.PresentationVariant: {
    SortOrder     : [{
      Property  : createdAt,
      Descending: true
    }],
    Visualizations: ['@UI.LineItem']
  },
  UI.SelectionFields   : [
    createdBy,
    status,
    createdAt
  ],
  UI.LineItem          : [
    {Value: createdAt},
    {Value: summary},
    {
      Value      : outcome,
      Criticality: statusCriticality
    },
    {Value: createdBy},
    {Value: totalCount},
    {Value: passedCount},
    {Value: failedCount},
    {Value: skippedCount},
    {Value: finishedAt}
  ],
  UI.HeaderFacets      : [{
    $Type : 'UI.ReferenceFacet',
    Target: '@UI.FieldGroup#Summary',
    Label : 'Summary'
  }],
  UI.FieldGroup #Summary: {Data: [
    {
      Value      : outcome,
      Criticality: statusCriticality
    },
    {Value: totalCount},
    {Value: passedCount},
    {Value: failedCount},
    {Value: skippedCount},
    {Value: repetitions},
    {Value: repetitionOrder},
    {Value: delayMs},
    {Value: stopOnFailure},
    {Value: startedAt},
    {Value: finishedAt}
  ]},
  UI.Facets            : [{
    $Type : 'UI.ReferenceFacet',
    ID    : 'Results',
    Target: 'results/@UI.LineItem#Run',
    Label : 'Results'
  }]
) {
  createdAt         @title: 'Started';
  summary           @title: 'Test Cases → Brokers';
  createdBy         @title: 'Started By'  @UI.HiddenFilter: false;
  createdAt         @UI.HiddenFilter: false;
  startedAt         @title: 'Started At';
  finishedAt        @title: 'Finished At';
  status            @title: 'Run Status';
  outcome           @title: 'Result';
  totalCount        @title: 'Total';
  passedCount       @title: 'Passed';
  failedCount       @title: 'Failed / Error';
  skippedCount      @title: 'Not Sent'  @Common.QuickInfo: 'Messages that were not sent: the run was stopped, or stop on first failure';
  repetitions       @title: 'Repetitions';
  repetitionOrder   @title: 'Order'  @Common.QuickInfo: 'Whole selection (a b c, a b c) or each test case in a row (a a, b b, c c)';
  delayMs           @title: 'Pause (ms)'  @Common.QuickInfo: 'Pause between two messages to the same broker';
  stopOnFailure     @title: 'Stop at First Failure';
  statusCriticality @UI.Hidden;
};

annotate service.RunResults with @(
  UI.HeaderInfo        : {
    TypeName      : 'Result',
    TypeNamePlural: 'Results',
    Title         : {Value: testCaseName},
    Description   : {Value: brokerName}
  },
  // main list of the app: one row per test case x broker
  UI.PresentationVariant: {
    SortOrder     : [
      {
        Property  : runStartedAt,
        Descending: true
      },
      {Property: brokerName},
      {Property: sequence}
    ],
    Visualizations: ['@UI.LineItem']
  },
  UI.SelectionFields   : [
    testCaseName,
    brokerName,
    status,
    runStartedBy,
    runStartedAt
  ],
  UI.LineItem          : [
    {
      $Type: 'UI.DataFieldWithUrl',
      Value: runStartedAt,
      Url  : runLink
    },
    {
      $Type: 'UI.DataFieldWithUrl',
      Value: testCaseName,
      Url  : testCaseLink
    },
    {
      $Type: 'UI.DataFieldWithUrl',
      Value: brokerName,
      Url  : brokerLink
    },
    {Value: iteration},
    {
      Value      : status,
      Criticality: statusCriticality
    },
    {Value: ackLatencyMs},
    {Value: deliveryMode},
    {Value: resolvedTopic},
    {Value: errorMessage},
    {Value: runStartedBy}
  ],
  // results table on the run page (run columns would be redundant there)
  UI.PresentationVariant #Run: {
    SortOrder     : [
      {Property: brokerName},
      {Property: sequence}
    ],
    Visualizations: ['@UI.LineItem#Run']
  },
  UI.LineItem #Run     : [
    {
      $Type: 'UI.DataFieldWithUrl',
      Value: testCaseName,
      Url  : testCaseLink
    },
    {
      $Type: 'UI.DataFieldWithUrl',
      Value: brokerName,
      Url  : brokerLink
    },
    {Value: iteration},
    {
      Value      : status,
      Criticality: statusCriticality
    },
    {Value: ackLatencyMs},
    {Value: deliveryMode},
    {Value: resolvedTopic},
    {Value: errorMessage}
  ],
  UI.HeaderFacets     : [{
    $Type : 'UI.ReferenceFacet',
    Target: '@UI.FieldGroup#Status',
    Label : 'Status'
  }],
  UI.FieldGroup #Status : {Data: [
    {
      Value      : status,
      Criticality: statusCriticality
    },
    {Value: ackLatencyMs},
    {Value: executedAt}
  ]},
  UI.FieldGroup #Message: {Data: [
    {
      $Type: 'UI.DataFieldWithUrl',
      Value: testCaseName,
      Url  : testCaseLink
    },
    {
      $Type: 'UI.DataFieldWithUrl',
      Value: brokerName,
      Url  : brokerLink
    },
    {
      $Type: 'UI.DataFieldWithUrl',
      Value: runStartedAt,
      Url  : runLink
    },
    {Value: runStartedBy},
    {Value: deliveryMode},
    {Value: resolvedTopic},
    {Value: correlationId},
    {Value: errorMessage}
  ]},
  UI.FieldGroup #Payload: {Data: [{Value: resolvedPayload}]},
  UI.Facets            : [
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Message',
      Target: '@UI.FieldGroup#Message',
      Label : 'Message'
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Payload',
      Target: '@UI.FieldGroup#Payload',
      Label : 'Resolved Payload'
    }
  ]
) {
  brokerName        @title: 'Broker';
  testCaseName      @title: 'Test Case';
  status            @title: 'Status';
  iteration         @title: 'Repetition'  @Common.QuickInfo: 'Which repetition of the test case this is (1 = the first)';
  sequence          @UI.Hidden;
  ackLatencyMs      @title: 'ACK Latency (ms)';
  deliveryMode      @title: 'Delivery Mode';
  resolvedTopic     @title: 'Topic'  @UI.MultiLineText;
  resolvedPayload   @title: 'Payload'  @UI.MultiLineText;
  correlationId     @title: 'Correlation ID';
  errorMessage      @title: 'Error';
  executedAt        @title: 'Executed At';
  runStartedAt      @title: 'Run Started'  @UI.HiddenFilter: false;
  runStartedBy      @title: 'Started By'  @UI.HiddenFilter: false;
  statusCriticality @UI.Hidden;
  testCaseLink      @UI.Hidden  @UI.HiddenFilter;
  brokerLink        @UI.Hidden  @UI.HiddenFilter;
  runLink           @UI.Hidden  @UI.HiddenFilter;
  run               @UI.Hidden;
  testCase          @UI.Hidden;
  broker            @UI.Hidden;
};
