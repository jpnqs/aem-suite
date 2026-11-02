using AdminService as service from '../../srv/admin-service';

// field titles: db/schema.cds - here only the layout of the Audit Log app

annotate service.AuditLog with @(
  UI.HeaderInfo         : {
    TypeName      : '{i18n>AuditEntry}',
    TypeNamePlural: '{i18n>AuditLog}',
    Title         : {Value: actionText},
    Description   : {Value: at}
  },
  UI.SelectionFields    : [
    at,
    user,
    action,
    target
  ],
  // newest first
  UI.PresentationVariant: {
    SortOrder     : [{
      Property  : at,
      Descending: true
    }],
    Visualizations: ['@UI.LineItem']
  },
  UI.LineItem           : [
    {Value: at},
    {Value: user},
    {Value: action},
    {Value: target},
    {Value: name},
    {Value: details}
  ],
  UI.FieldGroup #Entry  : {Data: [
    {Value: at},
    {Value: user},
    {Value: action},
    {Value: target},
    {Value: targetId},
    {Value: name},
    {Value: details},
    {Value: service}
  ]},
  UI.Facets             : [{
    $Type : 'UI.ReferenceFacet',
    ID    : 'Entry',
    Target: '@UI.FieldGroup#Entry',
    Label : '{i18n>AuditEntry}'
  }]
) {
  details    @UI.MultiLineText;
  // "Created (CREATE)", "Test case (TestCases)": readable, and the code is still there to filter by
  action     @Common.Text: actionText  @Common.TextArrangement: #TextFirst;
  target     @Common.Text: targetText  @Common.TextArrangement: #TextFirst;
  actionText @UI.Hidden;
  targetText @UI.Hidden;
};
