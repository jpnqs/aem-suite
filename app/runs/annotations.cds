using TestService as service from '../../srv/test-service';

// field titles: db/schema.cds (outcome, run columns: srv/test-service.cds) - here only the layout

annotate service.TestRuns with @(
  UI.HeaderInfo        : {
    TypeName      : '{i18n>TestRun}',
    TypeNamePlural: '{i18n>TestRuns}',
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
    Label : '{i18n>Summary}'
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
    Label : '{i18n>Results}'
  }]
) {
  // name of the user that started the run; the user id alone if that user has not logged in since names are kept
  createdBy         @UI.HiddenFilter: false
                    @Common.Text: creator.name
                    @Common.TextArrangement: #TextFirst
                    @Common.ValueList: {
                      CollectionPath: 'RunStarters',
                      Parameters    : [
                        {
                          $Type            : 'Common.ValueListParameterInOut',
                          LocalDataProperty: createdBy,
                          ValueListProperty: 'ID'
                        },
                        {
                          $Type            : 'Common.ValueListParameterDisplayOnly',
                          ValueListProperty: 'name'
                        }
                      ]
                    };
  createdAt         @UI.HiddenFilter: false;
  statusCriticality @UI.Hidden;
};

annotate service.RunResults with @(
  UI.HeaderInfo        : {
    TypeName      : '{i18n>Result}',
    TypeNamePlural: '{i18n>Results}',
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
    Label : '{i18n>Status}'
  }],
  UI.FieldGroup #Status : {Data: [
    {
      Value      : status,
      Criticality: statusCriticality
    },
    {Value: ackLatencyMs},
    {Value: receiveLatencyMs},
    {Value: executedAt}
  ]},
  // the expected message (test cases with an expected outcome): what arrived and how the checks went
  UI.FieldGroup #Received: {Data: [
    {Value: expectMode},
    {Value: receivedTopic},
    {Value: receiveLatencyMs},
    {Value: receivedPayload}
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
  UI.Facets            : [
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Message',
      Target: '@UI.FieldGroup#Message',
      Label : '{i18n>Message}'
    },
    // the payload: custom section with a code editor (app/runs/webapp/ext/ResolvedPayload), placed after "Message"
    {
      $Type        : 'UI.CollectionFacet',
      ID           : 'ExpectedOutcome',
      Label        : '{i18n>ExpectedOutcome}',
      ![@UI.Hidden]: (expectMode = null),
      Facets       : [
        {
          $Type : 'UI.ReferenceFacet',
          ID    : 'Received',
          Target: '@UI.FieldGroup#Received',
          Label : '{i18n>ExpectedMessage}'
        },
        {
          $Type : 'UI.ReferenceFacet',
          ID    : 'Checks',
          Target: 'checks/@UI.LineItem',
          Label : '{i18n>Checks}'
        }
      ]
    }
  ]
) {
  sequence          @UI.Hidden;
  resolvedTopic     @UI.MultiLineText;
  resolvedPayload   @UI.MultiLineText;
  receivedTopic     @UI.MultiLineText;
  expectModeInfo    @UI.Hidden;
  expectMode        @Common.Text: expectModeInfo.name  @Common.TextArrangement: #TextOnly;
  receivedPayload   @UI.MultiLineText;
  runStartedAt      @UI.HiddenFilter: false;
  // value helps of the filters: the values of the existing results and runs
  runStartedBy      @UI.HiddenFilter: false
                    @Common.Text: runStartedByName
                    @Common.TextArrangement: #TextFirst
                    @Common.ValueList: {
                      CollectionPath: 'RunStarters',
                      Parameters    : [
                        {
                          $Type            : 'Common.ValueListParameterInOut',
                          LocalDataProperty: runStartedBy,
                          ValueListProperty: 'ID'
                        },
                        {
                          $Type            : 'Common.ValueListParameterDisplayOnly',
                          ValueListProperty: 'name'
                        }
                      ]
                    };
  runStartedByName  @UI.Hidden  @UI.HiddenFilter;
  testCaseName      @Common.ValueList: {
                      CollectionPath: 'ResultTestCaseNames',
                      Parameters    : [{
                        $Type            : 'Common.ValueListParameterInOut',
                        LocalDataProperty: testCaseName,
                        ValueListProperty: 'testCaseName'
                      }]
                    };
  brokerName        @Common.ValueList: {
                      CollectionPath: 'ResultBrokerNames',
                      Parameters    : [{
                        $Type            : 'Common.ValueListParameterInOut',
                        LocalDataProperty: brokerName,
                        ValueListProperty: 'brokerName'
                      }]
                    };
  status            @Common.Text: statusInfo.name
                    @Common.TextArrangement: #TextOnly
                    @Common.ValueListWithFixedValues
                    @Common.ValueList: {
                      CollectionPath              : 'ResultStatuses',
                      PresentationVariantQualifier: 'byPosition',
                      Parameters                  : [
                        {
                          $Type            : 'Common.ValueListParameterInOut',
                          LocalDataProperty: status,
                          ValueListProperty: 'code'
                        },
                        {
                          $Type            : 'Common.ValueListParameterDisplayOnly',
                          ValueListProperty: 'name'
                        }
                      ]
                    };
  deliveryMode      @Common.Text: deliveryModeInfo.name
                    @Common.TextArrangement: #TextOnly
                    @Common.ValueListWithFixedValues
                    @Common.ValueList: {
                      CollectionPath: 'DeliveryModes',
                      Parameters    : [
                        {
                          $Type            : 'Common.ValueListParameterInOut',
                          LocalDataProperty: deliveryMode,
                          ValueListProperty: 'code'
                        },
                        {
                          $Type            : 'Common.ValueListParameterDisplayOnly',
                          ValueListProperty: 'name'
                        }
                      ]
                    };
  statusCriticality @UI.Hidden;
  testCaseLink      @UI.Hidden  @UI.HiddenFilter;
  brokerLink        @UI.Hidden  @UI.HiddenFilter;
  runLink           @UI.Hidden  @UI.HiddenFilter;
  run               @UI.Hidden;
  testCase          @UI.Hidden;
  broker            @UI.Hidden;
  statusInfo        @UI.Hidden;
  deliveryModeInfo  @UI.Hidden;
};

annotate service.RunResultChecks with @(
  UI.PresentationVariant: {
    SortOrder     : [{Property: position}],
    Visualizations: ['@UI.LineItem']
  },
  UI.LineItem: [
    {
      Value      : passed,
      Criticality: criticality
    },
    {Value: description},
    {Value: actual}
  ]
) {
  position    @UI.Hidden;
  criticality @UI.Hidden;
};
