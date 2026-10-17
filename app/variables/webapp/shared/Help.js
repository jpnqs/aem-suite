// GENERATED from app/_shared by scripts/sync-shared-ui.js - edit the original there, then run npm run sync:ui
sap.ui.define(["module", "./Navigation"], function (module, Navigation) {
  "use strict";

  // app this copy belongs to, e.g. "brokers" (see scripts/sync-shared-ui.js)
  var APP = /([^/]+)\/shared\/[^/]+$/.exec(module.id)[1];

  /** Sections of the user guide (docs/user-guide.md) per app - test/help.test.ts checks that they exist. */
  var SECTIONS = {
    brokers: "2-set-up-brokers-admin",
    variables: "3-global-variables-admin",
    numberranges: "number-ranges-admin",
    folders: "4-organize-test-cases-in-folders",
    testcases: "5-create-and-edit-a-test-case",
    run: "6-run-tests",
    runs: "7-check-results",
    subscriber: "8-watch-messages-live-live-subscriber",
    messages: "9-saved-messages"
  };

  /** Opens a section of the user guide in a new tab, so nothing being edited here is lost. */
  function openSection(key) {
    Navigation.toApp({ app: "help", path: SECTIONS[key], newTab: true });
  }

  return {
    SECTIONS: SECTIONS,

    /** "Help" button: the section that explains this app. */
    open: function () {
      openSection(APP);
    },

    /** Test cases list report: how to organize and run test cases. */
    openForList: function () {
      openSection("folders");
    },

    /** Test cases object page: folders are explained with the tree, test cases with their own section. */
    openForObjectPage: function (context) {
      openSection(context && context.getProperty("kind") === "FOLDER" ? "folders" : "testcases");
    },

    /** Run dialog. */
    openForRun: function () {
      openSection("run");
    }
  };
});
