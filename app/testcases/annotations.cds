using TestService as service from '../../srv/test-service';

// field titles: db/schema.cds - here only the layout of the Test Cases app

annotate service.TestCases with @(
  UI.HeaderInfo        : {
    TypeName      : 'Test Case',
    TypeNamePlural: 'Test Cases',
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
      Label      : 'Last Result'
    },
    {
      Value: lastResult.runAt,
      Label: 'Last Run At'
    },
    {Value: deliveryMode},
    {Value: modifiedAt}
  ],
  UI.HeaderFacets      : [{
    $Type        : 'UI.ReferenceFacet',
    Target       : '@UI.FieldGroup#LastResult',
    Label        : 'Last Result',
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
      Label        : 'Advanced',
      ![@UI.Hidden]: (kind = 'FOLDER'),
      Facets: [{
        $Type              : 'UI.ReferenceFacet',
        ID                 : 'Advanced',
        Target             : '@UI.FieldGroup#Advanced',
        Label              : 'Optional settings',
        ![@UI.PartOfPreview]: false
      }]
    },
    {
      $Type        : 'UI.ReferenceFacet',
      ID           : 'UserProperties',
      Target       : 'userProperties/@UI.LineItem',
      Label        : 'User Properties',
      ![@UI.Hidden]: (kind = 'FOLDER')
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Variables',
      Target: 'variables/@UI.LineItem',
      Label : 'Variables'
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
  createdBy     @UI.HiddenFilter: false;
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
    TypeName      : 'User Property',
    TypeNamePlural: 'User Properties',
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
  name @title: 'Broker';
};
