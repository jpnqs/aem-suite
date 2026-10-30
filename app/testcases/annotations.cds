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
    tags,
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
    {Value: tags},
    {
      Value      : lastResult.status,
      Criticality: lastResult.criticality,
      Label      : '{i18n>LastResult}'
    },
    {
      Value: lastResult.runAt,
      Label: '{i18n>LastRunAt}'
    },
    {Value: lastResult.passRate},
    {
      Value      : lastResult.flaky,
      Criticality: lastResult.flakyCriticality
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
    {Value: lastResult.message},
    {Value: lastResult.history},
    {Value: lastResult.passRate},
    {
      Value      : lastResult.flaky,
      Criticality: lastResult.flakyCriticality
    }
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
  UI.FieldGroup #Tags: {Data: [{Value: tags}]},
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
      ID    : 'Tags',
      Target: '@UI.FieldGroup#Tags',
      Label : '{i18n>Tags}'
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Variables',
      Target: 'variables/@UI.LineItem',
      Label : '{i18n>Variables}'
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
    },
    // every save keeps a version (srv/lib/testcases/versions.ts)
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Versions',
      Target: 'versions/@UI.PresentationVariant',
      Label : '{i18n>Versions}'
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

// TestCaseVariables: the layout of all variables lists, app/common.cds

annotate service.Brokers with {
  ID   @UI.Hidden;
  name @title: '{i18n>Broker}';
};

annotate service.TestCaseVersions with @(
  UI.PresentationVariant: {
    SortOrder     : [{
      Property  : version,
      Descending: true
    }],
    Visualizations: ['@UI.LineItem']
  },
  UI.LineItem           : [
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'TestService.restore',
      Label : '{i18n>RestoreVersion}'
    },
    {Value: version},
    {Value: savedAt},
    {Value: savedBy},
    {Value: name},
    {Value: changes}
  ]
);
