sap.ui.define(
  [
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "com/aem/suite/testcases/shared/Prefs",
    "com/aem/suite/testcases/shared/Actions",
    "com/aem/suite/testcases/shared/Help",
    "com/aem/suite/testcases/shared/LiveSocket",
    "com/aem/suite/testcases/shared/Navigation"
  ],
  function (MessageBox, MessageToast, JSONModel, Filter, Prefs, Actions, Help, LiveSocket, Navigation) {
    "use strict";

    /**
     * The Run dialog (RunDialog.fragment.xml): broker selection, credentials of direct brokers, the advanced
     * settings, then the run with its live progress (websocket, plus a poll in case progress is lost) and its
     * problems. Opened by the Run actions of TestCaseActions.js.
     */

    var errorText = Actions.errorText;

    /** How often the run dialog reads the run while it waits (in case live progress is lost or the run aborts). */
    var POLL_MS = 5000;
    /** Problems shown in the run dialog - the rest are in the results app. */
    var MAX_PROBLEMS = 50;

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
      /** the broker list of the dialog - taken from its own events (updateFinished comes first), not looked up by id */
      var brokers;

      function selectedBrokers() {
        return brokers ? brokers.getSelectedContexts() : [];
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
        var rows = selectedBrokers()
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
        var brokerCount = selectedBrokers().length;
        var reps = Math.max(1, Number(state.getProperty("/repetitions")) || 1);
        var delay = Math.max(0, Number(state.getProperty("/delayMs")) || 0);
        var perBroker = testCaseIds.length * reps;
        var text = "";
        if (brokerCount && (reps > 1 || delay > 0)) {
          text = perBroker * brokerCount + " or more messages (" + testCaseIds.length + " × " + brokerCount + (brokerCount === 1 ? " broker" : " brokers") + " × " + reps + "; folders send everything below them)";
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
        onBrokerSelection: function (event) {
          brokers = event.getSource();
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
          brokers = list;
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
          var brokerIds = selectedBrokers()
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
              state.setProperty("/total", result.total);
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

    return {
      /**
       * Opens the dialog for the given test cases / folders.
       * @param {sap.fe.core.ExtensionAPI} api the FE ExtensionAPI (this of a custom action handler)
       * @param {string[]} testCaseIds saved test cases and folders
       * @param {string} label what the dialog title names ("Run <label>")
       */
      open: openRunDialog
    };
  }
);
