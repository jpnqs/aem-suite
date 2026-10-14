using AdminService as service from '../../srv/admin-service';

annotate service.Brokers with @(
  UI.HeaderInfo                : {
    TypeName      : 'Broker',
    TypeNamePlural: 'Brokers',
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
      Label : 'Test Connection'
    }
  ],
  UI.Identification            : [
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'AdminService.testConnection',
      Label : 'Test Connection'
    },
  ],
  UI.HeaderFacets              : [{
    $Type : 'UI.ReferenceFacet',
    Target: '@UI.FieldGroup#Status',
    Label : 'Last Connection Test'
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
  UI.FieldGroup #Destination   : {Data: [{Value: destinationName}]},
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
      Label : 'Connection',
      Facets: [
        {
          $Type : 'UI.ReferenceFacet',
          ID    : 'General',
          Target: '@UI.FieldGroup#General',
          Label : 'General'
        },
        {
          $Type        : 'UI.ReferenceFacet',
          ID           : 'Destination',
          Target       : '@UI.FieldGroup#Destination',
          Label        : 'BTP Destination',
          ![@UI.Hidden]: (credentialMode <> 'DESTINATION')
        },
        {
          $Type        : 'UI.ReferenceFacet',
          ID           : 'Direct',
          Target       : '@UI.FieldGroup#Direct',
          Label        : 'Direct Connection',
          ![@UI.Hidden]: (credentialMode <> 'DIRECT')
        },
        {
          $Type : 'UI.ReferenceFacet',
          ID    : 'Advanced',
          Target: '@UI.FieldGroup#Advanced',
          Label : 'Advanced'
        }
      ]
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Variables',
      Target: 'variables/@UI.LineItem',
      Label : 'Broker Variables'
    }
  ]
) {
  name                  @title: 'Name';
  description           @title: 'Description'  @UI.MultiLineText;
  credentialMode        @title: 'Credentials'
                        @Common.ValueListWithFixedValues
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
  destinationName       @title: 'Destination'
                        @Common.QuickInfo: 'BTP destination: URL = wss:// endpoint, additional property msgVpn'
                        @Common.ValueList: {
                          CollectionPath: 'Destinations',
                          Label         : 'Destinations',
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
  url                   @title: 'URL'
                        @Common.QuickInfo: 'Host is enough, e.g. mr-xyz.messaging.solace.cloud - completed to wss://host:443 (port 55443 gives tcps, 55555 gives tcp)';
  msgVpn                @title: 'Message VPN';
  username              @title: 'Username'
                        @Common.QuickInfo: 'The password is not stored - it is entered when running tests, testing the connection or subscribing';
  clientNamePrefix      @title: 'Client Name Prefix';
  connectTimeoutMs      @title: 'Connect Timeout (ms)';
  active                @title: 'Active';
  lastConnectionStatus  @title: 'Status'  @readonly;
  lastConnectionAt      @title: 'Tested At'  @readonly;
  lastConnectionMessage @title: 'Message'  @readonly  @UI.MultiLineText;
  connectionCriticality @UI.Hidden;
}


annotate service.BrokerVariables with @(
  UI.HeaderInfo: {
    TypeName      : 'Variable',
    TypeNamePlural: 'Variables',
    Title         : {Value: name}
  },
  UI.LineItem  : [
    {Value: name},
    {Value: value}
  ]
) {
  name  @title: 'Name';
  value @title: 'Value';
};
