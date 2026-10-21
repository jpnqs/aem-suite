sap.ui.define(["sap/fe/core/AppComponent", "com/aem/suite/runs/shared/Navigation"], function (AppComponent, Navigation) {
  "use strict";
  return AppComponent.extend("com.aem.suite.runs.Component", {
    metadata: { manifest: "json" },

    init: function () {
      AppComponent.prototype.init.apply(this, arguments);
      // the test case, broker and run links of the results go through the launchpad (shared/Navigation.js)
      Navigation.handleAppLinks();
    }
  });
});
