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
    {Value: startedAt},
    {Value: finishedAt}
  ]},
  UI.Facets            : [{
    $Type : 'UI.ReferenceFacet',
    ID    : 'Results',
    Target: 'results/@UI.LineItem',
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
  statusCriticality @UI.Hidden;
};

annotate service.RunResults with @(
  UI.HeaderInfo        : {
    TypeName      : 'Result',
    TypeNamePlural: 'Results',
    Title         : {Value: testCaseName},
    Description   : {Value: brokerName}
  },
  UI.PresentationVariant: {
    SortOrder     : [
      {Property: brokerName},
      {Property: testCaseName}
    ],
    Visualizations: ['@UI.LineItem']
  },
  UI.LineItem          : [
    {Value: brokerName},
    {Value: testCaseName},
    {
      Value      : status,
      Criticality: statusCriticality
    },
    {Value: ackLatencyMs},
    {Value: deliveryMode},
    {Value: resolvedTopic},
    {Value: errorMessage}
  ],
  UI.HeaderFacets      : [{
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
    {Value: brokerName},
    {Value: testCaseName},
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
  ackLatencyMs      @title: 'ACK Latency (ms)';
  deliveryMode      @title: 'Delivery Mode';
  resolvedTopic     @title: 'Topic'  @UI.MultiLineText;
  resolvedPayload   @title: 'Payload'  @UI.MultiLineText;
  correlationId     @title: 'Correlation ID';
  errorMessage      @title: 'Error';
  executedAt        @title: 'Executed At';
  statusCriticality @UI.Hidden;
  run               @UI.Hidden;
  testCase          @UI.Hidden;
  broker            @UI.Hidden;
};
