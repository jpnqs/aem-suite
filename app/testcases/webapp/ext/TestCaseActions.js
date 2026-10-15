sap.ui.define(
  [
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "com/aem/suite/testcases/ext/LiveSocket",
    "com/aem/suite/testcases/ext/Prefs"
  ],
  function (MessageBox, MessageToast, JSONModel, Filter, LiveSocket, Prefs) {
    "use strict";

    /** Navigates to the run in the runs app (FLP intent or standalone app). */
    function openRun(runId) {
      var hash = "AEMSuiteTestRuns-display&/TestRuns(" + runId + ")";
      if (window.sap && sap.ushell && sap.ushell.Container) {
        window.location.hash = "#" + hash;
      } else {
        window.open("/runs/index.html#/TestRuns(" + runId + ")", "_blank");
      }
    }

    function showError(e) {
      // eslint-disable-next-line no-console
      console.error("[aem-suite] action failed", e);
      MessageBox.error(errorText(e));
    }

    function errorText(e) {
      return (e && (e.message || (e.error && e.error.message))) || String(e);
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
        total: 0,
        done: 0,
        passed: 0,
        failed: 0,
        finished: false
      });
      var socket = new LiveSocket(function (event, data) {
        if (event !== "runProgress" || data.runId !== state.getProperty("/runId")) {
          return;
        }
        state.setProperty("/total", data.total);
        state.setProperty("/done", data.done);
        state.setProperty("/passed", data.passed);
        state.setProperty("/failed", data.failed);
        state.setProperty("/finished", data.status === "DONE");
        if (data.status === "DONE") {
          loadProblems(data.runId);
        }
      });

      /** Failed / errored results of the run, shown directly in the dialog. */
      function loadProblems(runId) {
        if (!state.getProperty("/failed")) {
          return;
        }
        model
          .bindList("/RunResults", null, [], [new Filter("run_ID", "EQ", runId), new Filter("status", "NE", "PASSED")], {
            $select: "testCaseName,brokerName,status,errorMessage"
          })
          .requestContexts(0, 50)
          .then(function (contexts) {
            state.setProperty(
              "/problems",
              contexts.map(function (c) {
                return c.getObject();
              })
            );
          })
          .catch(function () {
            /* details remain available in the results */
          });
      }
      var dialog;
      var preselected = false;

      function brokerList() {
        return dialog.getContent()[0].getItems()[1];
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

      var handler = {
        onBrokerSelection: function () {
          syncCredentials();
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
          state.setProperty("/starting", true);
          var op = model.bindContext("/runTests(...)");
          op.setParameter("testCaseIds", testCaseIds);
          op.setParameter("brokerIds", brokerIds);
          op.setParameter(
            "credentials",
            credentials.map(function (c) {
              return {
                brokerId: c.brokerId,
                username: c.needsUsername ? c.enteredUsername.trim() : null,
                password: c.password
              };
            })
          );
          op.invoke()
            .then(function () {
              // passwords are not kept in the UI after the run was started
              state.setProperty("/credentials", []);
              var id = op.getBoundContext().getProperty("runId");
              op.destroy(); // drop the request incl. passwords from the model
              state.setProperty("/total", testCaseIds.length * brokerIds.length);
              state.setProperty("/runId", id);
              return socket.enter(id).then(function () {
                // catch up in case the run finished before the context was entered
                var run = model.bindContext("/TestRuns(" + id + ")");
                return run.requestObject().then(function (r) {
                  if (r && r.status === "DONE") {
                    state.setProperty("/done", r.totalCount);
                    state.setProperty("/passed", r.passedCount);
                    state.setProperty("/failed", r.failedCount);
                    state.setProperty("/finished", true);
                    loadProblems(id);
                  }
                });
              }, function () {
                MessageToast.show("Live progress unavailable - open the results to see the outcome");
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
      var op = api.getModel().bindContext("/copyNodes(...)");
      op.setParameter("ids", ids);
      return op.invoke().then(function () {
        var copies = op.getBoundContext().getObject().value || [];
        op.destroy();
        return copies;
      });
    }

    function copiedMessage(copies) {
      return copies.length === 1 ? 'Copied as "' + copies[0].name + '"' : copies.length + " copies created";
    }

    return {
      /** List report toolbar action (multi selection): copies the selected test cases and folders. */
      copySelected: function (context, selectedContexts) {
        var api = this;
        var contexts = selectedContexts || [];
        var ids = contexts
          .filter(function (c) {
            return c.getProperty("IsActiveEntity") !== false;
          })
          .map(function (c) {
            return c.getProperty("ID");
          });
        if (ids.length !== contexts.length) {
          MessageToast.show("Unsaved drafts are skipped");
        }
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
        var contexts = selectedContexts || [];
        var ids = contexts
          .filter(function (c) {
            return c.getProperty("IsActiveEntity") !== false;
          })
          .map(function (c) {
            return c.getProperty("ID");
          });
        if (ids.length !== contexts.length) {
          MessageToast.show("Unsaved drafts are skipped");
        }
        if (!ids.length) {
          return;
        }
        var label = ids.length === 1 ? contexts[0].getProperty("name") : ids.length + " test cases";
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
            var op = model.bindContext("TestService.preview(...)", context);
            op.setParameter("brokerId", brokerId);
            op.invoke()
              .then(function () {
                state.setData(Object.assign({ brokerId: state.getProperty("/brokerId") }, op.getBoundContext().getObject()));
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
          .requestContexts(0, 200)
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
