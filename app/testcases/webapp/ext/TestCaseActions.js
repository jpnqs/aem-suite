sap.ui.define(
  [
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel",
    "com/aem/suite/testcases/shared/Prefs",
    "com/aem/suite/testcases/shared/Actions",
    "com/aem/suite/testcases/ext/RunDialog",
    "com/aem/suite/testcases/ext/FileIO"
  ],
  function (MessageToast, JSONModel, Prefs, Actions, RunDialog, FileIO) {
    "use strict";

    /** The handlers of the custom actions in manifest.json (list report toolbar, object page header). */

    var showError = Actions.showError;
    var errorText = Actions.errorText;

    /** Brokers offered in the preview (the run dialog lists all of them). */
    var MAX_BROKERS = 200;

    /**
     * Copies test cases / folders (folders with everything below them) on the server.
     * Resolves with the copies; the copy is placed right after its original.
     */
    function copyNodes(api, ids) {
      return Actions.invokeAction(api.getModel(), "/copyNodes(...)", { ids: ids }).then(function (result) {
        return result.value || [];
      });
    }

    function copiedMessage(copies) {
      return copies.length === 1 ? 'Copied as "' + copies[0].name + '"' : copies.length + " copies created";
    }

    /** The selected nodes that are saved; tells the user if unsaved drafts were left out. */
    function activeContexts(contexts) {
      var all = contexts || [];
      var active = all.filter(function (c) {
        return c.getProperty("IsActiveEntity") !== false;
      });
      if (active.length !== all.length) {
        MessageToast.show("Unsaved drafts are skipped");
      }
      return active;
    }

    function idsOf(contexts) {
      return contexts.map(function (c) {
        return c.getProperty("ID");
      });
    }

    return {
      /** List report toolbar action: saves the selected test cases / folders (everything if nothing is selected) as a JSON file. */
      exportSelected: function (context, selectedContexts) {
        var ids = idsOf(activeContexts(selectedContexts));
        // only unsaved drafts selected: nothing to export (no ids would mean "everything")
        if ((selectedContexts || []).length && !ids.length) {
          return;
        }
        return FileIO.exportNodes(this, ids).catch(showError);
      },

      /** Object page header action: saves this test case or folder (with everything below) as a JSON file. */
      exportFromObjectPage: function (context) {
        return FileIO.exportNodes(this, [context.getProperty("ID")]).catch(showError);
      },

      /**
       * List report toolbar action: imports a JSON file as new test cases and folders. They go into the selected
       * folder (if exactly one folder is selected), otherwise to the top level. The file is checked first, then
       * the user confirms.
       */
      importFile: function (context, selectedContexts) {
        var selected = selectedContexts || [];
        var target = selected.length === 1 && selected[0].getProperty("kind") === "FOLDER" ? selected[0].getProperty("ID") : null;
        return FileIO.importNodes(this, target).catch(showError);
      },

      /** List report toolbar action (multi selection): copies the selected test cases and folders. */
      copySelected: function (context, selectedContexts) {
        var api = this;
        var ids = idsOf(activeContexts(selectedContexts));
        if (!ids.length) {
          return;
        }
        return copyNodes(api, ids)
          .then(function (copies) {
            MessageToast.show(copiedMessage(copies));
            return api.refresh();
          })
          .catch(showError);
      },

      /** Object page header action: copies this test case or folder. */
      copyFromObjectPage: function (context) {
        return copyNodes(this, [context.getProperty("ID")])
          .then(function (copies) {
            MessageToast.show(copiedMessage(copies) + " - find it next to the original in the list");
          })
          .catch(showError);
      },

      /** List report toolbar action (multi selection). */
      runSelected: function (context, selectedContexts) {
        var active = activeContexts(selectedContexts);
        if (!active.length) {
          return;
        }
        var ids = idsOf(active);
        var label = ids.length === 1 ? active[0].getProperty("name") : ids.length + " test cases";
        return RunDialog.open(this, ids, label).catch(showError);
      },

      /** Object page header action. */
      runFromObjectPage: function (context) {
        return RunDialog.open(this, [context.getProperty("ID")], context.getProperty("name")).catch(showError);
      },

      /** Object page header action: resolves templates without sending. */
      preview: function (context) {
        var api = this;
        var model = api.getModel();
        var state = new JSONModel({ brokerId: null, valid: false, message: "" });
        var dialog;

        var handler = {
          onResolve: function () {
            var brokerId = state.getProperty("/brokerId") || null;
            if (brokerId) {
              Prefs.set("lastPreviewBroker", brokerId);
            }
            Actions.invokeAction(model, "TestService.preview(...)", { brokerId: brokerId }, context)
              .then(function (result) {
                state.setData(Object.assign({ brokerId: state.getProperty("/brokerId") }, result));
              })
              .catch(function (e) {
                state.setProperty("/valid", false);
                state.setProperty("/message", errorText(e));
              });
          },
          onClose: function () {
            dialog.close();
          }
        };

        // preselect: last previewed broker, else broker of the last run, else the first broker
        var brokersLoaded = model
          .bindList("/Brokers", null, [], [], { $select: "ID", $orderby: "name" })
          .requestContexts(0, MAX_BROKERS)
          .then(function (contexts) {
            var ids = contexts.map(function (c) {
              return c.getProperty("ID");
            });
            var preferred = [Prefs.get("lastPreviewBroker")].concat(Prefs.get("lastBrokers", []), ids[0]);
            var pick = preferred.filter(function (id) {
              return id && ids.indexOf(id) >= 0;
            })[0];
            state.setProperty("/brokerId", pick || null);
          })
          .catch(function () {
            /* resolve with global variables only */
          });

        return Promise.all([
          api.loadFragment({ id: "previewDialog" + Date.now(), name: "com.aem.suite.testcases.ext.PreviewDialog", controller: handler }),
          brokersLoaded
        ])
          .then(function (results) {
            return results[0];
          })
          .then(function (d) {
            dialog = d;
            dialog.setModel(state, "preview");
            dialog.attachAfterClose(function () {
              dialog.destroy();
            });
            dialog.open();
            handler.onResolve();
          });
      }
    };
  }
);
