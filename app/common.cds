using {aem.suite as db} from '../db/schema';

// Layout that several apps share - on the db entities, so every projection gets it.

// variables lists: broker variables (Brokers app), folder / test case variables (Test Cases app); the Global
// Variables app has its own layout (app/variables)
annotate db.Variables with @(
  UI.HeaderInfo: {
    TypeName      : 'Variable',
    TypeNamePlural: 'Variables',
    Title         : {Value: name}
  },
  UI.LineItem  : [
    {Value: name},
    {Value: value}
  ]
);

annotate db.TestCaseVariables with @(
  UI.HeaderInfo: {
    TypeName      : 'Variable',
    TypeNamePlural: 'Variables',
    Title         : {Value: name}
  },
  UI.LineItem  : [
    {Value: name},
    {Value: value}
  ]
);
