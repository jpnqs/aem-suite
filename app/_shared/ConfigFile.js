sap.ui.define(["module", "sap/m/MessageBox", "sap/m/MessageToast", "./Actions", "./Files"], function (module, MessageBox, MessageToast, Actions, Files) {
  "use strict";

  /**
   * Export and import of the admin configuration (number ranges, brokers, global variables) as a JSON file:
   * list report toolbar actions of these apps (manifest.json), called by Fiori elements with `this` = its
   * ExtensionAPI. The content travels in the actions exportConfig / importConfig of the AdminService
   * (srv/lib/config/export-import.ts). The texts come from the app's i18n.properties (config.*).
   */

  // the app this module is loaded for, e.g. "brokers" (see scripts/ui5/shared-ui.js)
  var APP = /([^/]+)\/shared\/[^/]+$/.exec(module.id)[1];
  var KINDS = { numberranges: "NUMBER_RANGES", brokers: "BROKERS", variables: "VARIABLES" };

  function textsOf(api) {
    var bundle = api.getModel("i18n").getResourceBundle();
    return function (key, args) {
      return bundle.getText(key, args) || key;
    };
  }

  /** "1 broker", "3 brokers" */
  function entries(count, t) {
    return t(count === 1 ? "config.one" : "config.many", [count]);
  }

  /** Asks whether the checked file should be imported; resolves true or false. */
  function confirmImport(fileName, check, t) {
    var importAction = t("action.import");
    return new Promise(function (resolve) {
      MessageBox.confirm(t("config.confirmImport", [fileName, check.created, check.updated]), {
        title: importAction,
        actions: [importAction, MessageBox.Action.CANCEL],
        emphasizedAction: importAction,
        onClose: function (action) {
          resolve(action === importAction);
        }
      });
    });
  }

  return {
    /** Saves the selected entries as a JSON file - all of them if nothing is selected. */
    exportSelected: function (_context, selectedContexts) {
      var api = this;
      var t = textsOf(api);
      var selected = selectedContexts || [];
      var ids = selected
        .filter(function (c) {
          return c.getProperty("IsActiveEntity") !== false;
        })
        .map(function (c) {
          return c.getProperty("ID");
        });
      // only unsaved drafts selected: nothing to export (no ids would mean "everything")
      if (selected.length && !ids.length) {
        MessageToast.show(t("config.draftsOnly"));
        return undefined;
      }
      return Actions.invokeAction(api.getModel(), "/exportConfig(...)", { kind: KINDS[APP], ids: ids })
        .then(function (result) {
          Files.download(result.filename, result.content);
          MessageToast.show(t("config.exported", [entries(result.count, t), result.filename]));
        })
        .catch(Actions.showError);
    },

    /** Lets the user pick a file, checks it on the server (dry run), asks, imports it and refreshes the list. */
    importFile: function () {
      var api = this;
      var t = textsOf(api);
      var model = api.getModel();
      var file;
      var importCall = function (dryRun) {
        return Actions.invokeAction(model, "/importConfig(...)", { kind: KINDS[APP], content: file.text, dryRun: dryRun });
      };
      return Files.pickJsonFile()
        .then(function (picked) {
          file = picked;
          return file && importCall(true);
        })
        .then(function (check) {
          return check && confirmImport(file.name, check, t);
        })
        .then(function (confirmed) {
          return confirmed && importCall(false);
        })
        .then(function (result) {
          if (!result) {
            return undefined;
          }
          MessageToast.show(t("config.imported", [result.created, result.updated]));
          return api.refresh();
        })
        .catch(Actions.showError);
    }
  };
});
