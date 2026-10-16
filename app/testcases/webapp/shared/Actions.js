// GENERATED from app/_shared by scripts/sync-shared-ui.js - edit the original there, then run npm run sync:ui
sap.ui.define(["sap/m/MessageBox"], function (MessageBox) {
  "use strict";

  /** The text of an error from OData, a promise rejection or anything else. */
  function errorText(e) {
    return (e && (e.message || (e.error && e.error.message))) || String(e);
  }

  return {
    errorText: errorText,

    /** Shows an error to the user (and logs it, for the details). */
    showError: function (e) {
      // eslint-disable-next-line no-console
      console.error("[aem-suite] action failed", e);
      MessageBox.error(errorText(e));
    },

    /**
     * Calls an OData action and resolves with its result. The binding - with all parameters, passwords
     * included - is removed from the model afterwards, whether the call succeeded or not.
     *
     * @param {sap.ui.model.odata.v4.ODataModel} model
     * @param {string} path e.g. "/runTests(...)", or "Service.action(...)" for a bound action
     * @param {object} params action parameters
     * @param {sap.ui.model.odata.v4.Context} [context] context of a bound action
     */
    invokeAction: function (model, path, params, context) {
      var op = model.bindContext(path, context);
      Object.keys(params || {}).forEach(function (key) {
        op.setParameter(key, params[key]);
      });
      return op
        .invoke()
        .then(function () {
          return op.getBoundContext().getObject();
        })
        .finally(function () {
          op.destroy();
        });
    }
  };
});
