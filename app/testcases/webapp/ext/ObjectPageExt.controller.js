sap.ui.define(["sap/ui/core/mvc/ControllerExtension", "sap/ui/model/json/JSONModel"], function (ControllerExtension, JSONModel) {
  "use strict";

  /**
   * Object page: folders only show name, description and variables.
   * Manifest "visible" expressions are evaluated at templating time (no data yet), so the
   * test-case-only parts are toggled here once the page is bound. Fragments bind to aem>/isFolder.
   */
  return ControllerExtension.extend("aem.suite.testcases.ext.ObjectPageExt", {
    override: {
      onInit: function () {
        this.base.getView().setModel(new JSONModel({ isFolder: false }), "aem");
      },
      routing: {
        onAfterBinding: function (context) {
          if (!context) {
            return;
          }
          var that = this;
          context.requestProperty("kind").then(function (kind) {
            var isFolder = kind === "FOLDER";
            var view = that.base.getView();
            view.getModel("aem").setProperty("/isFolder", isFolder);
            ["fe::CustomSection::payload", "fe::CustomAction::preview"].forEach(function (id) {
              var control = view.byId(id);
              if (control) {
                control.setVisible(!isFolder);
              }
            });
          });
        }
      }
    }
  });
});
