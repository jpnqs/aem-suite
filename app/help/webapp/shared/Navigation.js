// GENERATED from app/_shared by scripts/sync-shared-ui.js - edit the original there, then run npm run sync:ui
sap.ui.define(["module"], function (module) {
  "use strict";

  // namespace of the app this copy belongs to, e.g. "com/aem/suite/brokers" (see scripts/sync-shared-ui.js)
  var APP_NAMESPACE = module.id.replace(/\/shared\/[^/]+$/, "");

  function inLaunchpad() {
    return !!(window.sap && window.sap.ushell && window.sap.ushell.Container);
  }

  /**
   * URL of another app of the suite when this app runs on its own (outside the launchpad).
   * The apps are siblings: locally and in the HTML5 repo at /comaemsuite<app>/, in Work Zone with a prefix
   * ("<service>.comaemsuite<app>-<version>"). The last path segment of this app's root names this app, so
   * swapping the app name there gives the other app in every one of these setups.
   */
  function standaloneUrl(app, hashPath) {
    var root = new URL(sap.ui.require.toUrl(APP_NAMESPACE + "/manifest.json"), window.location.href);
    var segments = root.pathname.replace(/\/manifest\.json$/, "").split("/");
    segments[segments.length - 1] = segments[segments.length - 1].replace(/comaemsuite[a-z]+/, "comaemsuite" + app);
    return root.origin + segments.join("/") + "/index.html#/" + hashPath;
  }

  return {
    inLaunchpad: inLaunchpad,

    /**
     * Shows another app of the suite.
     * @param {object} target
     * @param {string} target.app app name, e.g. "runs" (the HTML5 app is "comaemsuiteruns")
     * @param {string} target.intent launchpad intent, e.g. "AEMSuiteTestRuns-display"
     * @param {string} target.path route inside the app, e.g. "TestRuns(<id>)"
     * @param {boolean} [target.newTab] open in a new tab, so nothing being edited here is lost
     */
    toApp: function (target) {
      if (inLaunchpad()) {
        var hash = "#" + target.intent + "&/" + target.path;
        if (target.newTab) {
          window.open(window.location.pathname + window.location.search + hash, "_blank", "noopener");
        } else {
          window.location.hash = hash;
        }
        return;
      }
      window.open(standaloneUrl(target.app, target.path), "_blank", "noopener");
    }
  };
});
