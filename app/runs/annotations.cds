using TestService as service from '../../srv/test-service';

// field titles: db/schema.cds (outcome, run columns: srv/test-service.cds) - here only the layout

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
  createdBy         @UI.HiddenFilter: false;
  createdAt         @UI.HiddenFilter: false;
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
  sequence          @UI.Hidden;
  resolvedTopic     @UI.MultiLineText;
  resolvedPayload   @UI.MultiLineText;
  runStartedAt      @UI.HiddenFilter: false;
  runStartedBy      @UI.HiddenFilter: false;
  statusCriticality @UI.Hidden;
  testCaseLink      @UI.Hidden  @UI.HiddenFilter;
  brokerLink        @UI.Hidden  @UI.HiddenFilter;
  runLink           @UI.Hidden  @UI.HiddenFilter;
  run               @UI.Hidden;
  testCase          @UI.Hidden;
  broker            @UI.Hidden;
};
