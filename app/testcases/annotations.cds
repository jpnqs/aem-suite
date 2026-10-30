using TestService as service from '../../srv/test-service';

// field titles: db/schema.cds - here only the layout of the Test Cases app

annotate service.TestCases with @(
  UI.HeaderInfo        : {
    TypeName      : '{i18n>TestCase}',
    TypeNamePlural: '{i18n>TestCases}',
    Title         : {Value: name},
    Description   : {Value: topic}
  },
  UI.SelectionFields   : [
    createdBy,
    name,
    topic,
    deliveryMode
  ],
  // folders first, then manual (drag & drop) order
  UI.PresentationVariant: {
    SortOrder     : [
      {Property: kind},
      {Property: sortOrder},
      {Property: name}
    ],
    Visualizations: ['@UI.LineItem']
  },
  // quick variants of the list (segmented button in the table toolbar, see manifest): own ones first
  UI.SelectionVariant #mine: {
    Text         : '{i18n>MyTestCases}',
    SelectOptions: [{
      PropertyName: createdByMe,
      Ranges      : [{
        Sign  : #I,
        Option: #EQ,
        Low   : true
      }]
    }]
  },
  UI.SelectionVariant #all : {
    Text         : '{i18n>AllTestCases}',
    SelectOptions: []
  },
  UI.LineItem          : [
    {Value: name},
    // "Type" is a custom icon column (ext/TypeColumn.fragment.xml, see manifest)
    {Value: topic},
    {
      Value      : lastResult.status,
      Criticality: lastResult.criticality,
      Label      : '{i18n>LastResult}'
    },
    {
      Value: lastResult.runAt,
      Label: '{i18n>LastRunAt}'
    },
    {Value: deliveryMode},
    {Value: createdBy},
    {Value: modifiedAt}
  ],
  UI.HeaderFacets      : [{
    $Type        : 'UI.ReferenceFacet',
    Target       : '@UI.FieldGroup#LastResult',
    Label        : '{i18n>LastResult}',
    ![@UI.Hidden]: (kind = 'FOLDER')
  }],
  UI.FieldGroup #LastResult: {Data: [
    {
      Value      : lastResult.status,
      Criticality: lastResult.criticality
    },
    {Value: lastResult.runAt},
    {Value: lastResult.brokers},
    {Value: lastResult.message}
  ]},
  // description: the documentation, custom section "documentation" (see manifest)
  UI.FieldGroup #Advanced: {Data: [
    {Value: deliveryMode},
    {Value: correlationId},
    {Value: contentType},
    {Value: ackTimeoutMs},
    {Value: timeToLiveMs},
    {Value: priority},
    {Value: dmqEligible}
  ]},
  // expected outcome: the message that has to arrive after sending, and its checks
  UI.FieldGroup #Expectation: {Data: [
    {Value: expectMode},
    {Value: expectSource},
    {Value: expectTimeoutMs},
    {Value: expectCorrelation}
  ]},
  // folder contents: the subfolders and test cases directly below a folder, in tree order
  UI.LineItem #Children: [
    {
      $Type: 'UI.DataFieldWithUrl',
      Value: name,
      Url  : nodeLink
    },
    // "Type" is the icon column of the tree (see manifest)
    {Value: topic},
    {
      Value      : lastResult.status,
      Criticality: lastResult.criticality,
      Label      : '{i18n>LastResult}'
    },
    {
      Value: lastResult.runAt,
      Label: '{i18n>LastRunAt}'
    },
    {Value: modifiedAt}
  ],
  UI.PresentationVariant #Children: {
    SortOrder     : [
      {Property: kind},
      {Property: sortOrder},
      {Property: name}
    ],
    Visualizations: ['@UI.LineItem#Children']
  },
  // nodes are created and deleted in the tree of the list, not in the contents table
  Capabilities.NavigationRestrictions: {RestrictedProperties: [{
    NavigationProperty: children,
    InsertRestrictions: {Insertable: false},
    DeleteRestrictions: {Deletable: false}
  }]},
  UI.Facets            : [
    // topic + name: custom section "message", then "payload" (full width, see manifest)
    {
      $Type        : 'UI.ReferenceFacet',
      ID           : 'Children',
      Target       : 'children/@UI.PresentationVariant#Children',
      Label        : '{i18n>Contents}',
      ![@UI.Hidden]: (kind <> 'FOLDER')
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Variables',
      Target: 'variables/@UI.LineItem',
      Label : '{i18n>Variables}'
    },
    {
      $Type        : 'UI.CollectionFacet',
      ID           : 'ExpectedOutcome',
      Label        : '{i18n>ExpectedOutcome}',
      ![@UI.Hidden]: (kind = 'FOLDER'),
      Facets       : [
        {
          $Type : 'UI.ReferenceFacet',
          ID    : 'Expectation',
          Target: '@UI.FieldGroup#Expectation',
          Label : '{i18n>ExpectedMessage}'
        },
        {
          $Type : 'UI.ReferenceFacet',
          ID    : 'Checks',
          Target: 'checks/@UI.LineItem',
          Label : '{i18n>Checks}'
        }
      ]
    },
    {
      $Type        : 'UI.ReferenceFacet',
      ID           : 'UserProperties',
      Target       : 'userProperties/@UI.LineItem',
      Label        : '{i18n>UserProperties}',
      ![@UI.Hidden]: (kind = 'FOLDER')
    },
    {
      $Type        : 'UI.CollectionFacet',
      ID           : 'AdvancedSection',
      Label        : '{i18n>Advanced}',
      ![@UI.Hidden]: (kind = 'FOLDER'),
      Facets: [{
        $Type : 'UI.ReferenceFacet',
        ID    : 'Advanced',
        Target: '@UI.FieldGroup#Advanced',
        Label : '{i18n>OptionalSettings}'
      }]
    }
  ]
) {
  kind          @Common.Text: {
                  $value                : kindText,
                  ![@UI.TextArrangement]: #TextOnly
                };
  kindText      @UI.Hidden;
  sortOrder     @UI.Hidden;
  parent        @UI.Hidden;
  description   @UI.MultiLineText;
  topic         @UI.MultiLineText;
  payload       @UI.Hidden;
  deliveryMode  @Common.ValueListWithFixedValues
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
  expectModeInfo @UI.Hidden;
  expectMode    @Common.Text: expectModeInfo.name
                @Common.TextArrangement: #TextOnly
                @Common.ValueListWithFixedValues
                @Common.ValueList: {
                  CollectionPath   : 'ExpectModes',
                  PresentationVariantQualifier: 'byPosition',
                  Parameters       : [
                    {
                      $Type            : 'Common.ValueListParameterInOut',
                      LocalDataProperty: expectMode,
                      ValueListProperty: 'code'
                    },
                    {
                      $Type            : 'Common.ValueListParameterDisplayOnly',
                      ValueListProperty: 'name'
                    }
                  ]
                };
  // value helps of the filters: the values of the existing test cases
  name          @Common.ValueList: {
                  CollectionPath: 'TestCaseNames',
                  Parameters    : [{
                    $Type            : 'Common.ValueListParameterInOut',
                    LocalDataProperty: name,
                    ValueListProperty: 'name'
                  }]
                };
  topic         @Common.ValueList: {
                  CollectionPath: 'Topics',
                  Parameters    : [{
                    $Type            : 'Common.ValueListParameterInOut',
                    LocalDataProperty: topic,
                    ValueListProperty: 'topic'
                  }]
                };
  // name of the creator; the user id alone if that user has not logged in since names are kept
  createdByMe   @UI.HiddenFilter;
  nodeLink      @UI.Hidden;
  descriptionHtml @UI.Hidden;
  createdBy     @UI.HiddenFilter: false
                @Common.Text: creator.name
                @Common.TextArrangement: #TextFirst
                @Common.ValueList: {
                  CollectionPath: 'Creators',
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
};

// name follows the topic until it is changed by the user
annotate service.TestCases with @Common.SideEffects #topicName: {
  SourceProperties: ['topic'],
  TargetProperties: ['name']
};

annotate service.TestCases actions {
  runTest @UI.Hidden;
};

annotate service.TestCaseProperties with @(
  UI.HeaderInfo: {
    TypeName      : '{i18n>UserProperty}',
    TypeNamePlural: '{i18n>UserProperties}',
    Title         : {Value: name}
  },
  UI.LineItem  : [
    {Value: name},
    {Value: type},
    {Value: value}
  ]
) {
  type  @Common.ValueListWithFixedValues
        @Common.ValueList: {
          CollectionPath: 'PropertyTypes',
          Parameters    : [
            {
              $Type            : 'Common.ValueListParameterInOut',
              LocalDataProperty: type,
              ValueListProperty: 'code'
            },
            {
              $Type            : 'Common.ValueListParameterDisplayOnly',
              ValueListProperty: 'name'
            }
          ]
        };
};

annotate service.TestCaseChecks with @(
  UI.HeaderInfo: {
    TypeName      : '{i18n>Check}',
    TypeNamePlural: '{i18n>Checks}'
  },
  UI.PresentationVariant: {
    SortOrder     : [{Property: position}],
    Visualizations: ['@UI.LineItem']
  },
  UI.LineItem  : [
    {Value: position},
    {Value: target},
    {Value: path},
    {Value: operator},
    {Value: value}
  ]
) {
  targetInfo   @UI.Hidden;
  operatorInfo @UI.Hidden;
  target   @Common.Text: targetInfo.name
           @Common.TextArrangement: #TextOnly
           @Common.ValueListWithFixedValues
           @Common.ValueList: {
             CollectionPath   : 'CheckTargets',
             PresentationVariantQualifier: 'byPosition',
             Parameters       : [
               {
                 $Type            : 'Common.ValueListParameterInOut',
                 LocalDataProperty: target,
                 ValueListProperty: 'code'
               },
               {
                 $Type            : 'Common.ValueListParameterDisplayOnly',
                 ValueListProperty: 'name'
               }
             ]
           };
  operator @Common.Text: operatorInfo.name
           @Common.TextArrangement: #TextOnly
           @Common.ValueListWithFixedValues
           @Common.ValueList: {
             CollectionPath   : 'CheckOperators',
             PresentationVariantQualifier: 'byPosition',
             Parameters       : [
               {
                 $Type            : 'Common.ValueListParameterInOut',
                 LocalDataProperty: operator,
                 ValueListProperty: 'code'
               },
               {
                 $Type            : 'Common.ValueListParameterDisplayOnly',
                 ValueListProperty: 'name'
               }
             ]
           };
};

// TestCaseVariables: the layout of all variables lists, app/common.cds

annotate service.Brokers with {
  ID   @UI.Hidden;
  name @title: '{i18n>Broker}';
};
