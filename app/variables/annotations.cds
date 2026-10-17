using AdminService as service from '../../srv/admin-service';

// field titles: db/schema.cds - here only the layout

annotate service.GlobalVariables with @(
  UI.HeaderInfo     : {
    TypeName      : 'Global Variable',
    TypeNamePlural: 'Global Variables',
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
    Label : 'Variable'
  }]
) {
  value  @UI.MultiLineText;
  broker @UI.Hidden;
};
