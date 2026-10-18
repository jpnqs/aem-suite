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
  UI.FieldGroup #Payload: {Data: [
    {Value: payload},
    {Value: userProperties}
  ]},
  UI.Facets            : [
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Message',
      Target: '@UI.FieldGroup#Message',
      Label : '{i18n>Message}'
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Payload',
      Target: '@UI.FieldGroup#Payload',
      Label : '{i18n>Payload}'
    }
  ]
) {
  topic          @UI.MultiLineText;
  payload        @UI.MultiLineText;
  userProperties @UI.MultiLineText;
  broker         @UI.Hidden;
};

// messages are created by the subscriber app only - hide "Create" in the list report
// (not updatable: srv/subscribe-service.cds)
annotate service.ReceivedMessages with @(UI.CreateHidden: true);
