using SubscribeService as service from '../../srv/subscribe-service';

// field titles: db/schema.cds - here only the layout

annotate service.ReceivedMessages with @(
  UI.HeaderInfo        : {
    TypeName      : 'Saved Message',
    TypeNamePlural: 'Saved Messages',
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
      Label : 'Create Test Case'
    }
  ],
  UI.Identification    : [{
    $Type : 'UI.DataFieldForAction',
    Action: 'SubscribeService.createTestCase',
    Label : 'Create Test Case'
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
      Label : 'Message'
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Payload',
      Target: '@UI.FieldGroup#Payload',
      Label : 'Payload'
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
