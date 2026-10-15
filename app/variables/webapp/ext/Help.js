sap.ui.define([], function () {
  "use strict";

  // section of the user guide (docs/user-guide.md) that explains this app - a test checks that it exists
  var SECTION = "3-global-variables-admin";

  return {
    /** "Help" button: opens the matching section of the user guide in a new tab, so nothing being edited here is lost. */
    open: function () {
      var inLaunchpad = window.sap && window.sap.ushell && window.sap.ushell.Container;
      var url = inLaunchpad
        ? window.location.pathname + "#AEMSuiteHelp-display&/" + SECTION
        : window.location.origin + "/help/index.html#/" + SECTION;
      window.open(url, "_blank", "noopener");
    }
  };
});
