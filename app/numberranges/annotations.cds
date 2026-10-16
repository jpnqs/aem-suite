using AdminService as service from '../../srv/admin-service';

annotate service.NumberRanges with @(
  UI.HeaderInfo      : {
    TypeName      : 'Number Range',
    TypeNamePlural: 'Number Ranges',
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
      Label            : 'Next Number',
      ![@UI.Importance]: #High
    },
    {
      Value            : lastNumber,
      Label            : 'Last Issued',
      ![@UI.Importance]: #High
    },
    {Value: lastUsedAt},
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'AdminService.reset',
      Label : 'Reset'
    }
  ],
  UI.Identification  : [{
    $Type : 'UI.DataFieldForAction',
    Action: 'AdminService.reset',
    Label : 'Reset'
  }],
  UI.FieldGroup #Status : {Data: [
    {
      Value: nextNumber,
      Label: 'Next Number'
    },
    {
      Value: lastNumber,
      Label: 'Last Issued'
    },
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
      Label : 'General'
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Format',
      Target: '@UI.FieldGroup#Format',
      Label : 'Format'
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Range',
      Target: '@UI.FieldGroup#Range',
      Label : 'Range'
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Status',
      Target: '@UI.FieldGroup#Status',
      Label : 'Status'
    }
  ]
) {
  name        @title: 'Name'          @Common.QuickInfo: 'Use it in topics, payloads, correlation ids and user properties as {{numberRange.<name>}}';
  description @title: 'Description';
  prefix      @title: 'Prefix'        @Common.QuickInfo: 'Text in front of the number, e.g. SO-';
  suffix      @title: 'Suffix'        @Common.QuickInfo: 'Text after the number, e.g. -EU';
  length      @title: 'Digits'        @Common.QuickInfo: 'Length of the number, filled with leading zeros (0 = no leading zeros)';
  start       @title: 'First Number';
  step        @title: 'Step'          @Common.QuickInfo: 'Increment between two numbers';
  maximum     @title: 'Last Allowed Number'  @Common.QuickInfo: 'Empty = until the number no longer fits into the digits';
  current     @UI.Hidden;
  lastUsedAt  @title: 'Last Used'      @Common.QuickInfo: 'When a run took a number last';
  lastNumber  @title: 'Last Issued'    @Core.Computed;
  nextNumber  @title: 'Next Number'    @Core.Computed;
};
