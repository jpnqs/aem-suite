using AdminService as service from '../../srv/admin-service';

// field titles: db/schema.cds - here only the layout of the Brokers app

annotate service.Brokers with @(
  UI.HeaderInfo                : {
    TypeName      : '{i18n>Broker}',
    TypeNamePlural: '{i18n>Brokers}',
    Title         : {Value: name},
    Description   : {Value: description}
  },
  UI.SelectionFields           : [
    credentialMode,
    active,
    lastConnectionStatus
  ],
  UI.LineItem                  : [
    {
      Value                : name,
      ![@UI.Importance]    : #High
    },
    {
      Value                : lastConnectionStatus,
      Criticality          : connectionCriticality,
      ![@UI.Importance]    : #High
    },
    {Value: url},
    {Value: msgVpn},
    {Value: credentialMode},
    {Value: destinationName},
    {Value: active},
    {Value: lastConnectionAt},
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'AdminService.testConnection',
      Label : '{i18n>TestConnection}'
    }
  ],
  UI.Identification            : [
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'AdminService.testConnection',
      Label : '{i18n>TestConnection}'
    },
  ],
  UI.HeaderFacets              : [{
    $Type : 'UI.ReferenceFacet',
    Target: '@UI.FieldGroup#Status',
    Label : '{i18n>LastConnectionTest}'
  }],
  UI.FieldGroup #Status        : {Data: [
    {
      Value      : lastConnectionStatus,
      Criticality: connectionCriticality
    },
    {Value: lastConnectionAt},
    {Value: lastConnectionMessage}
  ]},
  UI.FieldGroup #General       : {Data: [
    {Value: name},
    {Value: description},
    {Value: credentialMode},
    {Value: active}
  ]},
  UI.FieldGroup #Destination   : {Data: [
    {Value: destinationName},
    {Value: agentAllowed}
  ]},
  UI.FieldGroup #Direct        : {Data: [
    {Value: url},
    {Value: msgVpn},
    {Value: username}
  ]},
  UI.FieldGroup #Advanced      : {Data: [
    {Value: clientNamePrefix},
    {Value: connectTimeoutMs}
  ]},
  UI.Facets                    : [
    {
      $Type : 'UI.CollectionFacet',
      ID    : 'Connection',
      Label : '{i18n>Connection}',
      Facets: [
        {
          $Type : 'UI.ReferenceFacet',
          ID    : 'General',
          Target: '@UI.FieldGroup#General',
          Label : '{i18n>General}'
        },
        {
          $Type        : 'UI.ReferenceFacet',
          ID           : 'Destination',
          Target       : '@UI.FieldGroup#Destination',
          Label        : '{i18n>BTPDestination}',
          ![@UI.Hidden]: (credentialMode <> 'DESTINATION')
        },
        {
          $Type        : 'UI.ReferenceFacet',
          ID           : 'Direct',
          Target       : '@UI.FieldGroup#Direct',
          Label        : '{i18n>DirectConnection}',
          ![@UI.Hidden]: (credentialMode <> 'DIRECT')
        },
        {
          $Type : 'UI.ReferenceFacet',
          ID    : 'Advanced',
          Target: '@UI.FieldGroup#Advanced',
          Label : '{i18n>Advanced}'
        }
      ]
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Variables',
      Target: 'variables/@UI.LineItem',
      Label : '{i18n>BrokerVariables}'
    }
  ]
) {
  description           @UI.MultiLineText;
  credentialMode        @Common.ValueListWithFixedValues
                        @Common.ValueList: {
                          CollectionPath: 'CredentialModes',
                          Parameters    : [
                            {
                              $Type            : 'Common.ValueListParameterInOut',
                              LocalDataProperty: credentialMode,
                              ValueListProperty: 'code'
                            },
                            {
                              $Type            : 'Common.ValueListParameterDisplayOnly',
                              ValueListProperty: 'name'
                            }
                          ]
                        };
  destinationName       @Common.ValueList: {
                          CollectionPath: 'Destinations',
                          Label         : '{i18n>Destinations}',
                          Parameters    : [
                            {
                              $Type            : 'Common.ValueListParameterInOut',
                              LocalDataProperty: destinationName,
                              ValueListProperty: 'name'
                            },
                            {
                              $Type            : 'Common.ValueListParameterDisplayOnly',
                              ValueListProperty: 'url'
                            },
                            {
                              $Type            : 'Common.ValueListParameterDisplayOnly',
                              ValueListProperty: 'msgVpn'
                            },
                            {
                              $Type            : 'Common.ValueListParameterDisplayOnly',
                              ValueListProperty: 'source'
                            }
                          ]
                        };
  lastConnectionMessage @UI.MultiLineText;
  connectionCriticality @UI.Hidden;
}

// refresh the connection fields after a save (the automatic test) and after "Test Connection"
annotate service.Brokers with @Common.SideEffects #connection: {
  SourceEntities  : ['/AdminService.EntityContainer/Brokers'],
  TargetProperties: ['lastConnectionStatus', 'lastConnectionAt', 'lastConnectionMessage']
};

annotate service.Brokers actions {
  testConnection @Common.SideEffects: {TargetProperties: [
    'in/lastConnectionStatus',
    'in/lastConnectionAt',
    'in/lastConnectionMessage',
    'in/connectionCriticality'
  ]}
  (username @Common.Label: '{i18n>UsernameOnlyIfNotMaintainedOnTheBroker}',
   password @UI.Masked  @Common.Label: '{i18n>PasswordDirectModeOnlyNotStored}');
};


// BrokerVariables: the layout of all variables lists, app/common.cds
