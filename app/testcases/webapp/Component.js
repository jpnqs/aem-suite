// TreeRules is preloaded: Fiori elements resolves the tree table hooks synchronously
sap.ui.define(["sap/fe/core/AppComponent", "aem/suite/testcases/ext/TreeRules"], function (AppComponent) {
  "use strict";
  return AppComponent.extend("aem.suite.testcases.Component", {
    metadata: { manifest: "json" }
  });
});
