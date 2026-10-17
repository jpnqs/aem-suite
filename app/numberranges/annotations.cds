using AdminService as service from '../../srv/admin-service';

// field titles: db/schema.cds (lastNumber / nextNumber: srv/admin-service.cds) - here only the layout

annotate service.NumberRanges with @(
  UI.HeaderInfo      : {
    TypeName      : '{i18n>NumberRange}',
    TypeNamePlural: '{i18n>NumberRanges}',
    Title         : {Value: name},
    Description   : {Value: description}
  },
  UI.SelectionFields : [name],
  UI.LineItem        : [
    {
      Value            : name,
      ![@UI.Importance]: #High
    },
    {Value: description},
    {
      Value            : nextNumber,
      ![@UI.Importance]: #High
    },
    {
      Value            : lastNumber,
      ![@UI.Importance]: #High
    },
    {Value: lastUsedAt},
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'AdminService.reset',
      Label : '{i18n>Reset}'
    }
  ],
  UI.Identification  : [{
    $Type : 'UI.DataFieldForAction',
    Action: 'AdminService.reset',
    Label : '{i18n>Reset}'
  }],
  UI.FieldGroup #Status : {Data: [
    {Value: nextNumber},
    {Value: lastNumber},
    {Value: lastUsedAt}
  ]},
  UI.FieldGroup #General : {Data: [
    {Value: name},
    {Value: description}
  ]},
  UI.FieldGroup #Format  : {Data: [
    {Value: prefix},
    {Value: length},
    {Value: suffix}
  ]},
  UI.FieldGroup #Range   : {Data: [
    {Value: start},
    {Value: step},
    {Value: maximum}
  ]},
  UI.Facets          : [
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'General',
      Target: '@UI.FieldGroup#General',
      Label : '{i18n>General}'
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Format',
      Target: '@UI.FieldGroup#Format',
      Label : '{i18n>Format}'
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Range',
      Target: '@UI.FieldGroup#Range',
      Label : '{i18n>Range}'
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Status',
      Target: '@UI.FieldGroup#Status',
      Label : '{i18n>Status}'
    }
  ]
) {
  current @UI.Hidden;
};

annotate service.NumberRanges actions {
  reset @Common.SideEffects: {TargetProperties: [
    'in/current',
    'in/lastNumber',
    'in/nextNumber'
  ]}
  (nextNumber @Common.Label: '{i18n>NextNumberEmptyStartOfTheRange}');
};
