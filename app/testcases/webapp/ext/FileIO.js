sap.ui.define(["sap/m/MessageBox", "sap/m/MessageToast", "com/aem/suite/testcases/shared/Actions"], function (MessageBox, MessageToast, Actions) {
  "use strict";

  /**
   * Export and import of test cases and folders as a JSON file: the browser saves / reads the file, the content
   * travels in the actions exportNodes / importNodes of the service (srv/lib/export-import.ts).
   */

  var REVOKE_URL_MS = 1000;

  /** "2 folders and 5 test cases" */
  function describeCounts(r) {
    var parts = [];
    if (r.folders) {
      parts.push(r.folders + (r.folders === 1 ? " folder" : " folders"));
    }
    if (r.testCases) {
      parts.push(r.testCases + (r.testCases === 1 ? " test case" : " test cases"));
    }
    return parts.join(" and ") || "nothing";
  }

  /** Lets the browser save text as a file. */
  function download(filename, text) {
    var url = URL.createObjectURL(new window.Blob([text], { type: "application/json" }));
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // the download has started by then; the object URL only keeps the text in memory
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, REVOKE_URL_MS);
  }

  /** Opens the file chooser; resolves with { name, text } or null if nothing was chosen. */
  function pickJsonFile() {
    return new Promise(function (resolve) {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (!file) {
          resolve(null);
          return;
        }
        file.text().then(function (text) {
          resolve({ name: file.name, text: text });
        });
      });
      input.addEventListener("cancel", function () {
        resolve(null);
      });
      input.click();
    });
  }

  /** Asks whether the checked file should be imported; resolves true or false. */
  function confirmImport(fileName, check) {
    return new Promise(function (resolve) {
      MessageBox.confirm(
        "Import " + describeCounts(check) + ' from "' + fileName + '" into ' +
          (check.target ? 'the folder "' + check.target + '"' : "the top level") + "?\n\n" +
          "They are added as new items. Existing test cases and folders are not changed.",
        {
          title: "Import",
          actions: ["Import", MessageBox.Action.CANCEL],
          emphasizedAction: "Import",
          onClose: function (action) {
            resolve(action === "Import");
          }
        }
      );
    });
  }

  return {
    /** Saves the given nodes (no ids: everything) as a JSON file. */
    exportNodes: function (api, ids) {
      return Actions.invokeAction(api.getModel(), "/exportNodes(...)", { ids: ids }).then(function (result) {
        download(result.filename, result.content);
        MessageToast.show("Exported " + describeCounts(result) + " to " + result.filename);
      });
    },

    /**
     * Lets the user pick a file, checks it on the server (dry run), asks, then imports it below parentId
     * (null = top level) and refreshes the list. Resolves when done or cancelled.
     */
    importNodes: function (api, parentId) {
      var model = api.getModel();
      var file;
      var importCall = function (dryRun) {
        return Actions.invokeAction(model, "/importNodes(...)", { content: file.text, parentId: parentId, dryRun: dryRun });
      };
      return pickJsonFile().then(function (picked) {
        file = picked;
        if (!file) {
          return undefined;
        }
        return importCall(true)
          .then(function (check) {
            return confirmImport(file.name, check);
          })
          .then(function (confirmed) {
            return confirmed ? importCall(false) : undefined;
          })
          .then(function (result) {
            if (!result) {
              return undefined;
            }
            MessageToast.show("Imported " + describeCounts(result));
            return api.refresh();
          });
      });
    }
  };
});
