sap.ui.define(["sap/ui/core/UIComponent"], function (UIComponent) {
  "use strict";
  return UIComponent.extend("com.aem.suite.home.Component", {
    metadata: {
      manifest: "json",
      interfaces: ["sap.ui.core.IAsyncContentCreation"],
      // use the whole width in the launchpad (otherwise the shell limits the app to a centered column)
      config: { fullWidth: true }
    }
  });
});
