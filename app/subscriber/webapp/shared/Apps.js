// GENERATED from app/_shared by scripts/sync-shared-ui.js - edit the original there, then run npm run sync:ui
sap.ui.define([], function () {
  "use strict";

  /**
   * The apps of the suite: launchpad intent, icon and the role a user needs to open the app (null = everyone).
   * The key is the app folder (app/<key>, HTML5 app comaemsuite<key>).
   * The sandbox launchpad (app/launchpad/webapp/index.html) cannot load this module, so it repeats intents and
   * icons; test/launchpad.test.ts checks that both agree with each other and with the apps' manifests.
   */
  var APPS = {
    home: { intent: "AEMSuiteHome-display", icon: "sap-icon://home", role: null },
    testcases: { intent: "AEMSuiteTestCases-manage", icon: "sap-icon://lab", role: "tester" },
    runs: { intent: "AEMSuiteTestRuns-display", icon: "sap-icon://kpi-managing-my-area", role: "tester" },
    subscriber: { intent: "AEMSuiteSubscriber-display", icon: "sap-icon://feeder-arrow", role: "tester" },
    messages: { intent: "AEMSuiteSavedMessages-display", icon: "sap-icon://inbox", role: "tester" },
    brokers: { intent: "AEMSuiteBrokers-manage", icon: "sap-icon://connected", role: "admin" },
    variables: { intent: "AEMSuiteVariables-manage", icon: "sap-icon://key-user-settings", role: "admin" },
    numberranges: { intent: "AEMSuiteNumberRanges-manage", icon: "sap-icon://numbered-text", role: "admin" },
    help: { intent: "AEMSuiteHelp-display", icon: "sap-icon://sys-help", role: null }
  };

  return {
    APPS: APPS,

    /** The app of a key; throws for an unknown key, so a typo shows up at once. */
    get: function (key) {
      var app = APPS[key];
      if (!app) {
        throw new Error("Unknown app " + key);
      }
      return app;
    }
  };
});
