using TestService as service from '../../srv/test-service';

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
    {Value: kind},
    {Value: topic},
    {
      Value      : lastResult.status,
      Criticality: lastResult.criticality,
      Label      : 'Last Result'
    },
    {
      Value: lastResult.runAt,
      Label: 'Last Run'
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
      Criticality: lastResult.criticality,
      Label      : 'Status'
    },
    {
      Value: lastResult.runAt,
      Label: 'Run At'
    },
    {
      Value: lastResult.brokers,
      Label: 'Brokers'
    },
    {
      Value: lastResult.message,
      Label: 'Problems'
    }
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
  name          @title: 'Name'  @Common.QuickInfo: 'Test cases: empty = topic';
  kind          @title: 'Type'  @Core.Immutable
                @Common.Text: {
                  $value                : kindText,
                  ![@UI.TextArrangement]: #TextOnly
                };
  kindText      @UI.Hidden;
  sortOrder     @UI.Hidden;
  parent        @UI.Hidden;
  description   @title: 'Description'  @UI.MultiLineText;
  topic         @title: 'Topic'  @UI.MultiLineText
                @Common.QuickInfo: 'Supports template variables in double curly braces, e.g. variable region or built-in uuid';
  payload       @title: 'Payload'  @UI.Hidden;
  contentType   @title: 'Content Type'  @Common.QuickInfo: 'Default application/json - empty = detected on save (JSON or text/plain)';
  deliveryMode  @title: 'Delivery Mode'
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
  timeToLiveMs  @title: 'Time to Live (ms)'  @Common.QuickInfo: 'Empty or 0 = no expiry';
  dmqEligible   @title: 'DMQ Eligible'  @Common.QuickInfo: 'Empty = broker default';
  priority      @title: 'Priority (0-255)'  @Common.QuickInfo: 'Empty = broker default';
  correlationId @title: 'Correlation ID'  @Common.QuickInfo: 'Supports template variables in double curly braces, e.g. built-in uuid';
  ackTimeoutMs  @title: 'ACK Timeout (ms)';
  modifiedAt    @title: 'Changed At';
  createdBy     @title: 'Created By'  @UI.HiddenFilter: false;
  modifiedBy    @title: 'Changed By';
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
  name  @title: 'Name';
  value @title: 'Value'  @Common.QuickInfo: 'Supports template variables in double curly braces';
  type  @title: 'Type'
        @Common.QuickInfo: 'Empty = detected on save (42 = Integer, true = Boolean, else String)'
        @Common.ValueListWithFixedValues
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

annotate service.TestCaseVariables with @(
  UI.HeaderInfo: {
    TypeName      : 'Variable',
    TypeNamePlural: 'Variables',
    Title         : {Value: name}
  },
  UI.LineItem  : [
    {Value: name},
    {Value: value}
  ]
) {
  name  @title: 'Name';
  value @title: 'Value';
};

annotate service.Brokers with {
  ID   @UI.Hidden;
  name @title: 'Broker';
};
