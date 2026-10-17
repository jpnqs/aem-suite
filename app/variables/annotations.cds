using AdminService as service from '../../srv/admin-service';

// field titles: db/schema.cds - here only the layout

annotate service.GlobalVariables with @(
  UI.HeaderInfo     : {
    TypeName      : '{i18n>GlobalVariable}',
    TypeNamePlural: '{i18n>GlobalVariables}',
    Title         : {Value: name},
    Description   : {Value: value}
  },
  UI.SelectionFields: [name],
  UI.LineItem       : [
    {Value: name},
    {Value: value}
  ],
  UI.FieldGroup #Main: {Data: [
    {Value: name},
    {Value: value}
  ]},
  UI.Facets         : [{
    $Type : 'UI.ReferenceFacet',
    ID    : 'Main',
    Target: '@UI.FieldGroup#Main',
    Label : '{i18n>Variable}'
  }]
) {
  value  @UI.MultiLineText;
  broker @UI.Hidden;
};
