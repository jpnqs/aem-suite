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
  UI.FieldGroup #Advanced: {Data: [
    {Value: description},
    {Value: deliveryMode},
    {Value: correlationId},
    {Value: contentType},
    {Value: ackTimeoutMs},
    {Value: timeToLiveMs},
    {Value: priority},
    {Value: dmqEligible}
  ]},
  UI.Facets            : [
    // topic + name: custom section "message" (full width, see manifest)
    {
      $Type        : 'UI.CollectionFacet',
      ID           : 'AdvancedSection',
      Label        : '{i18n>Advanced}',
      ![@UI.Hidden]: (kind = 'FOLDER'),
      Facets: [{
        $Type              : 'UI.ReferenceFacet',
        ID                 : 'Advanced',
        Target             : '@UI.FieldGroup#Advanced',
        Label              : '{i18n>OptionalSettings}',
        ![@UI.PartOfPreview]: false
      }]
    },
    {
      $Type        : 'UI.ReferenceFacet',
      ID           : 'UserProperties',
      Target       : 'userProperties/@UI.LineItem',
      Label        : '{i18n>UserProperties}',
      ![@UI.Hidden]: (kind = 'FOLDER')
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Variables',
      Target: 'variables/@UI.LineItem',
      Label : '{i18n>Variables}'
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

// TestCaseVariables: the layout of all variables lists, app/common.cds

annotate service.Brokers with {
  ID   @UI.Hidden;
  name @title: '{i18n>Broker}';
};
