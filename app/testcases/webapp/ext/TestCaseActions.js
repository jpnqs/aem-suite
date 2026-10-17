sap.ui.define(
  [
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "com/aem/suite/testcases/ext/Prefs",
    "com/aem/suite/testcases/shared/Actions",
    "com/aem/suite/testcases/shared/Help",
    "com/aem/suite/testcases/shared/LiveSocket",
    "com/aem/suite/testcases/shared/Navigation"
  ],
  function (MessageBox, MessageToast, JSONModel, Filter, Prefs, Actions, Help, LiveSocket, Navigation) {
    "use strict";

    var showError = Actions.showError;
    var errorText = Actions.errorText;

    /** How often the run dialog reads the run while it waits (in case live progress is lost or the run aborts). */
    var POLL_MS = 5000;
    /** Problems shown in the run dialog - the rest are in the results app. */
    var MAX_PROBLEMS = 50;
    /** Brokers offered in the preview (the run dialog lists all of them). */
    var MAX_BROKERS = 200;
    var REVOKE_URL_MS = 1000;

    /** Navigates to the run in the runs app. */
    function openRun(runId) {
      Navigation.toApp({ app: "runs", path: "TestRuns(" + runId + ")" });
    }

    /**
     * Opens the broker selection dialog and runs the given test cases.
     * `api` is the FE ExtensionAPI (this of a custom action handler).
     */
    function openRunDialog(api, testCaseIds, label) {
      var model = api.getModel();
      var state = new JSONModel({
        label: label,
        credentials: [],
        problems: [],
        runId: null,
        starting: false,
        // advanced settings (remembered for the next run)
        repetitions: Prefs.get("runRepetitions", 1),
        delayMs: Prefs.get("runDelayMs", 0),
        order: Prefs.get("runOrder", "ROUND"),
        stopOnFailure: Prefs.get("runStopOnFailure", false),
        estimate: "",
        stopping: false,
        skipped: 0,
        total: 0,
        done: 0,
        passed: 0,
        failed: 0,
        /** failures beyond MAX_PROBLEMS (not listed in the dialog) */
        moreProblems: 0,
        finished: false,
        aborted: false,
        connectionLost: false
      });
      var socket = new LiveSocket(
        function (event, data) {
          if (event !== "runProgress" || data.runId !== state.getProperty("/runId")) {
            return;
          }
          state.setProperty("/total", data.total);
          state.setProperty("/done", data.done);
          state.setProperty("/passed", data.passed);
          state.setProperty("/failed", data.failed);
          state.setProperty("/skipped", data.skipped || 0);
          if (data.status !== "RUNNING") {
            finish(data.runId);
          }
        },
        function (connected) {
          state.setProperty("/connectionLost", !connected);
        }
      );
      var pollTimer;

      function finish(runId) {
        if (state.getProperty("/finished")) {
          return;
        }
        state.setProperty("/finished", true);
        clearInterval(pollTimer);
        loadProblems(runId);
      }

      /**
       * Reads the run itself: catches up if it finished before the live context was entered, and ends the wait
       * when no progress arrives (connection lost, or the run was aborted on the server). The run's counts are
       * written when it ends; the total is right from the start (the dialog's own estimate is not for folders).
       */
      function poll(runId) {
        var binding = model.bindContext("/TestRuns(" + runId + ")");
        return binding
          .requestObject()
          .then(function (r) {
            if (r) {
              state.setProperty("/total", r.totalCount);
            }
            if (r && r.status !== "RUNNING") {
              state.setProperty("/done", r.totalCount);
              state.setProperty("/passed", r.passedCount);
              state.setProperty("/failed", r.failedCount);
              state.setProperty("/skipped", r.skippedCount || 0);
              state.setProperty("/aborted", r.status === "FAILED");
              finish(runId);
            }
          })
          .catch(function () {
            /* try again on the next tick */
          })
          .finally(function () {
            binding.destroy();
          });
      }

      /** Failed / errored results of the run, shown directly in the dialog. */
      function loadProblems(runId) {
        if (!state.getProperty("/failed")) {
          return;
        }
        model
          .bindList("/RunResults", null, [], [new Filter("run_ID", "EQ", runId), new Filter("status", "NE", "PASSED"), new Filter("status", "NE", "SKIPPED")], {
            $select: "testCaseName,brokerName,status,errorMessage"
          })
          .requestContexts(0, MAX_PROBLEMS)
          .then(function (contexts) {
            state.setProperty(
              "/problems",
              contexts.map(function (c) {
                return c.getObject();
              })
            );
            state.setProperty("/moreProblems", Math.max(0, state.getProperty("/failed") - contexts.length));
          })
          .catch(function () {
            /* details remain available in the results */
          });
      }
      var dialog;
      var preselected = false;

      // found by what it is, not by its position: the dialog layout may change (a help link once shifted it)
      /** the broker list (id brokerList in RunDialog.fragment.xml; the id gets the fragment's prefix) */
      function brokerList() {
        return dialog.findAggregatedObjects(true, function (c) {
          return /--brokerList$/.test(c.getId());
        })[0];
      }

      /**
       * One credentials row per selected DIRECT broker (password, plus username if the broker has none);
       * typed values are kept while the selection changes.
       */
      function syncCredentials() {
        var typed = {};
        state.getProperty("/credentials").forEach(function (c) {
          typed[c.brokerId] = c;
        });
        var rows = brokerList()
          .getSelectedContexts()
          .map(function (c) {
            return c.getObject();
          })
          .filter(function (b) {
            return b.credentialMode !== "DESTINATION";
          })
          .map(function (b) {
            var prev = typed[b.ID] || {};
            return {
              brokerId: b.ID,
              name: b.name,
              username: b.username || "",
              needsUsername: !b.username,
              enteredUsername: prev.enteredUsername || "",
              password: prev.password || "",
              missing: false
            };
          });
        state.setProperty("/credentials", rows);
      }

      /** "5 test cases x 2 brokers x 10 = at least 100 messages; the pauses alone take about 2 min" */
      function updateEstimate() {
        var brokers = brokerList() ? brokerList().getSelectedContexts().length : 0;
        var reps = Math.max(1, Number(state.getProperty("/repetitions")) || 1);
        var delay = Math.max(0, Number(state.getProperty("/delayMs")) || 0);
        var perBroker = testCaseIds.length * reps;
        var text = "";
        if (brokers && (reps > 1 || delay > 0)) {
          text = perBroker * brokers + " or more messages (" + testCaseIds.length + " × " + brokers + " broker(s) × " + reps + "; folders send everything below them)";
          if (delay > 0 && perBroker > 1) {
            text += "; the pauses alone take about " + formatDuration((perBroker - 1) * delay);
          }
        }
        state.setProperty("/estimate", text);
      }

      function formatDuration(ms) {
        var s = Math.round(ms / 1000);
        if (s < 60) {
          return Math.max(s, 1) + " s";
        }
        var m = Math.floor(s / 60);
        return m < 60 ? m + " min " + (s % 60) + " s" : Math.floor(m / 60) + " h " + (m % 60) + " min";
      }

      var handler = {
        onHelp: function () {
          Help.openForRun();
        },
        onBrokerSelection: function () {
          syncCredentials();
          updateEstimate();
        },
        onOptionsChange: function () {
          updateEstimate();
        },
        /** Stops the run: messages not sent yet are skipped. */
        onStop: function () {
          state.setProperty("/stopping", true);
          Actions.invokeAction(model, "/cancelRun(...)", { runId: state.getProperty("/runId") }).catch(function (e) {
            state.setProperty("/stopping", false);
            MessageBox.error(errorText(e));
          });
        },
        /** Preselects the brokers of the last run, or the only broker there is. */
        onBrokersLoaded: function (event) {
          var list = event.getSource();
          var items = list.getItems();
          if (preselected || !items.length) {
            return;
          }
          preselected = true;
          var last = Prefs.get("lastBrokers", []);
          var hit = false;
          items.forEach(function (item) {
            if (last.indexOf(item.getBindingContext().getProperty("ID")) >= 0) {
              list.setSelectedItem(item, true);
              hit = true;
            }
          });
          if (!hit && items.length === 1) {
            list.setSelectedItem(items[0], true);
          }
          syncCredentials();
          updateEstimate();
        },
        onPrimary: function () {
          var runId = state.getProperty("/runId");
          if (runId) {
            dialog.close();
            openRun(runId);
            return;
          }
          var brokerIds = brokerList()
            .getSelectedContexts()
            .map(function (c) {
              return c.getProperty("ID");
            });
          if (!brokerIds.length) {
            MessageToast.show("Select at least one broker");
            return;
          }
          var credentials = state.getProperty("/credentials");
          var missing = credentials.filter(function (c) {
            return !c.password || (c.needsUsername && !c.enteredUsername.trim());
          });
          if (missing.length) {
            credentials.forEach(function (c) {
              c.missing = true;
            });
            state.refresh(true);
            MessageToast.show(
              "Enter the missing credentials for " +
                missing
                  .map(function (c) {
                    return c.name;
                  })
                  .join(", ")
            );
            return;
          }
          Prefs.set("lastBrokers", brokerIds);
          var options = {
            repetitions: Math.max(1, Math.round(Number(state.getProperty("/repetitions")) || 1)),
            delayMs: Math.max(0, Math.round(Number(state.getProperty("/delayMs")) || 0)),
            order: state.getProperty("/order"),
            stopOnFailure: !!state.getProperty("/stopOnFailure")
          };
          Prefs.set("runRepetitions", options.repetitions);
          Prefs.set("runDelayMs", options.delayMs);
          Prefs.set("runOrder", options.order);
          Prefs.set("runStopOnFailure", options.stopOnFailure);
          state.setProperty("/starting", true);
          Actions.invokeAction(model, "/runTests(...)", {
            testCaseIds: testCaseIds,
            brokerIds: brokerIds,
            credentials: credentials.map(function (c) {
              return {
                brokerId: c.brokerId,
                username: c.needsUsername ? c.enteredUsername.trim() : null,
                password: c.password
              };
            }),
            options: options
          })
            .then(function (result) {
              // passwords are not kept in the UI after the run was started
              state.setProperty("/credentials", []);
              var id = result.runId;
              state.setProperty("/total", testCaseIds.length * brokerIds.length * options.repetitions);
              state.setProperty("/runId", id);
              pollTimer = setInterval(function () {
                poll(id);
              }, POLL_MS);
              return socket.enter(id).then(function () {
                return poll(id);
              });
            })
            .catch(function (e) {
              MessageBox.error(errorText(e));
            })
            .finally(function () {
              state.setProperty("/starting", false);
            });
        },
        onClose: function () {
          dialog.close();
        }
      };

      return api
        .loadFragment({
          id: "runDialog" + Date.now(),
          name: "com.aem.suite.testcases.ext.RunDialog",
          controller: handler
        })
        .then(function (d) {
          dialog = d;
          dialog.setModel(state, "run");
          dialog.attachAfterClose(function () {
            clearInterval(pollTimer);
            socket.close();
            dialog.destroy();
          });
          dialog.open();
        });
    }

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

    /** Calls an unbound action of the service and resolves with its result. */
    function callAction(api, path, params) {
      return Actions.invokeAction(api.getModel(), path, params);
    }

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

    function exportNodes(api, ids) {
      return callAction(api, "/exportNodes(...)", { ids: ids }).then(function (result) {
        download(result.filename, result.content);
        MessageToast.show("Exported " + describeCounts(result) + " to " + result.filename);
      });
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
        return exportNodes(this, ids).catch(showError);
      },

      /** Object page header action: saves this test case or folder (with everything below) as a JSON file. */
      exportFromObjectPage: function (context) {
        return exportNodes(this, [context.getProperty("ID")]).catch(showError);
      },

      /**
       * List report toolbar action: imports a JSON file as new test cases and folders. They go into the selected
       * folder (if exactly one folder is selected), otherwise to the top level. The file is checked first, then
       * the user confirms.
       */
      importFile: function (context, selectedContexts) {
        var api = this;
        var selected = selectedContexts || [];
        var target = selected.length === 1 && selected[0].getProperty("kind") === "FOLDER" ? selected[0].getProperty("ID") : null;
        return pickJsonFile()
          .then(function (file) {
            if (!file) {
              return undefined;
            }
            return callAction(api, "/importNodes(...)", { content: file.text, parentId: target, dryRun: true })
              .then(function (check) {
                return new Promise(function (resolve) {
                  MessageBox.confirm(
                    "Import " + describeCounts(check) + ' from "' + file.name + '" into ' +
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
              })
              .then(function (confirmed) {
                if (!confirmed) {
                  return undefined;
                }
                return callAction(api, "/importNodes(...)", { content: file.text, parentId: target, dryRun: false }).then(function (result) {
                  MessageToast.show("Imported " + describeCounts(result));
                  return api.refresh();
                });
              });
          })
          .catch(showError);
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
        return openRunDialog(this, ids, label).catch(showError);
      },

      /** Object page header action. */
      runFromObjectPage: function (context) {
        return openRunDialog(this, [context.getProperty("ID")], context.getProperty("name")).catch(showError);
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
