sap.ui.define([], function () {
  "use strict";

  // sections of the user guide (docs/user-guide.md) - a test checks that they exist
  var SECTION_FOLDERS = "4-organize-test-cases-in-folders";
  var SECTION_TEST_CASE = "5-create-and-edit-a-test-case";
  var SECTION_RUN = "6-run-tests";

  /** Opens a section of the user guide in a new tab, so nothing being edited here is lost. */
  function openSection(section) {
    var inLaunchpad = window.sap && window.sap.ushell && window.sap.ushell.Container;
    var url = inLaunchpad
      ? window.location.pathname + "#AEMSuiteHelp-display&/" + section
      : window.location.origin + "/help/index.html#/" + section;
    window.open(url, "_blank", "noopener");
  }

  return {
    /** List report: how to organize and run test cases. */
    openForList: function () {
      openSection(SECTION_FOLDERS);
    },

    /** Object page: folders are explained with the tree, test cases with their own section. */
    openForObjectPage: function (context) {
      openSection(context && context.getProperty("kind") === "FOLDER" ? SECTION_FOLDERS : SECTION_TEST_CASE);
    },

    /** Run dialog. */
    openForRun: function () {
      openSection(SECTION_RUN);
    }
  };
});
