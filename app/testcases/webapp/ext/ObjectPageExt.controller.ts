import ControllerExtension from "sap/ui/core/mvc/ControllerExtension";
import View from "sap/ui/core/mvc/View";
import Control from "sap/ui/core/Control";
import JSONModel from "sap/ui/model/json/JSONModel";
import Context from "sap/ui/model/odata/v4/Context";

/** `this` of the overrides: the extension, with the page controller as base */
type Extension = { base: { getView(): View } };

/**
 * Object page: folders only show name, description and variables.
 * Manifest "visible" expressions are evaluated at templating time (no data yet) - a runtime binding on kind
 * does not hide the custom action either (e2e/apps.spec.ts) - so the test-case-only parts are toggled here once
 * the page is bound. Fragments bind to aem>/isFolder.
 */
export default ControllerExtension.extend("com.aem.suite.testcases.ext.ObjectPageExt", {
  override: {
    onInit(this: Extension): void {
      // typedPayload: the payload being typed (PayloadSection.ts), null = the bound one
      this.base.getView().setModel(new JSONModel({ isFolder: false, typedPayload: null }), "aem");
    },
    routing: {
      onAfterBinding(this: Extension, context?: Context): void {
        if (!context) {
          return;
        }
        const view = this.base.getView();
        const aem = view.getModel("aem") as JSONModel;
        // another object (or the draft of this one): nothing typed yet
        aem.setProperty("/typedPayload", null);
        context
          .requestProperty("kind")
          .then((kind) => {
            const isFolder = kind === "FOLDER";
            aem.setProperty("/isFolder", isFolder);
            // the stable ids Fiori elements gives the custom section and action of the manifest
            for (const id of ["fe::CustomSection::payload", "fe::CustomAction::preview"]) {
              (view.byId(id) as Control | undefined)?.setVisible(!isFolder);
            }
          })
          .catch(() => {
            // the page could not be read - Fiori elements shows the message; keep the test case layout
          });
      }
    }
  }
});
