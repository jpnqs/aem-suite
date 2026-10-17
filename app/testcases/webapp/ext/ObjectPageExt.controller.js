sap.ui.define(["sap/ui/core/mvc/ControllerExtension", "sap/ui/model/json/JSONModel"], function (ControllerExtension, JSONModel) {
  "use strict";

  /**
   * Object page: folders only show name, description and variables.
   * Manifest "visible" expressions are evaluated at templating time (no data yet) - a runtime binding on kind
   * does not hide the custom action either (e2e/apps.spec.ts) - so the test-case-only parts are toggled here once
   * the page is bound. Fragments bind to aem>/isFolder.
   */
  return ControllerExtension.extend("com.aem.suite.testcases.ext.ObjectPageExt", {
    override: {
      onInit: function () {
        // typedPayload: the payload being typed (PayloadSection.js), null = the bound one
        this.base.getView().setModel(new JSONModel({ isFolder: false, typedPayload: null }), "aem");
      },
      routing: {
        onAfterBinding: function (context) {
          if (!context) {
            return;
          }
          var that = this;
          // another object (or the draft of this one): nothing typed yet
          this.base.getView().getModel("aem").setProperty("/typedPayload", null);
          context.requestProperty("kind").then(function (kind) {
            var isFolder = kind === "FOLDER";
            var view = that.base.getView();
            view.getModel("aem").setProperty("/isFolder", isFolder);
            // the stable ids Fiori elements gives the custom section and action of the manifest
            ["fe::CustomSection::payload", "fe::CustomAction::preview"].forEach(function (id) {
              var control = view.byId(id);
              if (control) {
                control.setVisible(!isFolder);
              }
            });
          }).catch(function () {
            // the page could not be read - Fiori elements shows the message; keep the test case layout
          });
        }
      }
    }
  });
});
