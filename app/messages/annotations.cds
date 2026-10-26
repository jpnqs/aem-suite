using SubscribeService as service from '../../srv/subscribe-service';

// field titles: db/schema.cds - here only the layout

annotate service.ReceivedMessages with @(
  UI.HeaderInfo        : {
    TypeName      : '{i18n>SavedMessage}',
    TypeNamePlural: '{i18n>SavedMessages}',
    Title         : {Value: topic},
    Description   : {Value: brokerName}
  },
  UI.PresentationVariant: {
    SortOrder     : [{
      Property  : receivedAt,
      Descending: true
    }],
    Visualizations: ['@UI.LineItem']
  },
  UI.SelectionFields   : [
    brokerName,
    topic,
    sourceType,
    createdBy
  ],
  UI.LineItem          : [
    {Value: receivedAt},
    {Value: brokerName},
    {Value: topic},
    {Value: source},
    {Value: sourceType},
    {Value: deliveryMode},
    {Value: createdBy},
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'SubscribeService.createTestCase',
      Label : '{i18n>CreateTestCase}'
    }
  ],
  UI.Identification    : [{
    $Type : 'UI.DataFieldForAction',
    Action: 'SubscribeService.createTestCase',
    Label : '{i18n>CreateTestCase}'
  }],
  UI.FieldGroup #Message: {Data: [
    {Value: brokerName},
    {Value: topic},
    {Value: source},
    {Value: sourceType},
    {Value: deliveryMode},
    {Value: contentType},
    {Value: correlationId},
    {Value: receivedAt},
    {Value: createdBy}
  ]},
  UI.Facets            : [
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Message',
      Target: '@UI.FieldGroup#Message',
      Label : '{i18n>Message}'
    }
    // payload and user properties: custom section with code editors (app/messages/webapp/ext/MessageBody)
  ]
) {
  topic          @UI.MultiLineText
                 @Common.ValueList: {
                   CollectionPath: 'MessageTopics',
                   Parameters    : [
                     {
                       $Type            : 'Common.ValueListParameterInOut',
                       LocalDataProperty: topic,
                       ValueListProperty: 'topic'
                     }
                   ]
                 };
  payload        @UI.MultiLineText;
  userProperties @UI.MultiLineText;
  broker         @UI.Hidden;
  creator          @UI.Hidden;
  sourceTypeInfo   @UI.Hidden;
  deliveryModeInfo @UI.Hidden;
  // value helps of the filters: the values of the saved messages; the code lists as name-only dropdowns
  brokerName     @Common.ValueList: {
                   CollectionPath: 'MessageBrokers',
                   Parameters    : [
                     {
                       $Type            : 'Common.ValueListParameterInOut',
                       LocalDataProperty: brokerName,
                       ValueListProperty: 'brokerName'
                     }
                   ]
                 };
  source         @Common.ValueList: {
                   CollectionPath: 'MessageSources',
                   Parameters    : [
                     {
                       $Type            : 'Common.ValueListParameterInOut',
                       LocalDataProperty: source,
                       ValueListProperty: 'source'
                     }
                   ]
                 };
  contentType    @Common.ValueList: {
                   CollectionPath: 'MessageContentTypes',
                   Parameters    : [
                     {
                       $Type            : 'Common.ValueListParameterInOut',
                       LocalDataProperty: contentType,
                       ValueListProperty: 'contentType'
                     }
                   ]
                 };
  // name of the user that saved the message; the user id alone if that user has not logged in since names are kept
  createdBy      @UI.HiddenFilter: false
                 @Common.Text: creator.name
                 @Common.TextArrangement: #TextFirst
                 @Common.ValueList: {
                   CollectionPath: 'MessageSavers',
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
  sourceType     @Common.Text: sourceTypeInfo.name
                 @Common.TextArrangement: #TextOnly
                 @Common.ValueListWithFixedValues
                 @Common.ValueList: {
                   CollectionPath              : 'SourceTypes',
                   PresentationVariantQualifier: 'byPosition',
                   Parameters                  : [
                     {
                       $Type            : 'Common.ValueListParameterInOut',
                       LocalDataProperty: sourceType,
                       ValueListProperty: 'code'
                     },
                     {
                       $Type            : 'Common.ValueListParameterDisplayOnly',
                       ValueListProperty: 'name'
                     }
                   ]
                 };
  deliveryMode   @Common.Text: deliveryModeInfo.name
                 @Common.TextArrangement: #TextOnly
                 @Common.ValueListWithFixedValues
                 @Common.ValueList: {
                   CollectionPath: 'ReceivedDeliveryModes',
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
};

// messages are created by the subscriber app only - hide "Create" in the list report
// (not updatable: srv/subscribe-service.cds)
annotate service.ReceivedMessages with @(UI.CreateHidden: true);
