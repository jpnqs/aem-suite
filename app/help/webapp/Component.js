sap.ui.define(["sap/ui/core/UIComponent"], function (UIComponent) {
  "use strict";
  return UIComponent.extend("com.aem.suite.help.Component", {
    metadata: {
      manifest: "json",
      interfaces: ["sap.ui.core.IAsyncContentCreation"],
      // use the whole width in the launchpad (otherwise the shell limits the app to a centered column)
      config: { fullWidth: true }
    }
    // No init() that starts the router: the main controller starts it once it listens - the address after the
    // app's own part, e.g. #AEMSuiteHelp-display&/6-run-tests, picks the section, and the first one must not be missed.
  });
});
