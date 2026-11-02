sap.ui.define(
  ["sap/m/MessageBox", "sap/m/MessageToast", "sap/ui/model/Filter", "sap/ui/model/Sorter", "sap/ui/model/json/JSONModel", "com/aem/suite/runs/shared/Actions"],
  function (MessageBox, MessageToast, Filter, Sorter, JSONModel, Actions) {
    "use strict";

    /** how many earlier runs the compare dialog offers */
    var COMPARE_CHOICES = 30;
    var STATES = { BROKEN: "Error", FIXED: "Success", NEW: "Information", GONE: "Warning", NOT_RUN: "None", STILL_FAILING: "Error", STILL_PASSING: "None" };

    return {
      /**
       * Header action of a run in progress: stops it (messages not sent yet are skipped). The page reads the run
       * again meanwhile (ext/RunPageExt.controller.js). `this` is the extension API of the object page.
       */
      stop: function (context) {
        var api = this;
        var texts = api.getModel("i18n").getResourceBundle();
        var stopText = texts.getText("action.stop");
        MessageBox.confirm(texts.getText("stop.confirm"), {
          title: stopText,
          actions: [stopText, MessageBox.Action.CANCEL],
          emphasizedAction: stopText,
          onClose: function (action) {
            if (action !== stopText) {
              return;
            }
            Actions.invokeAction(api.getModel(), "/cancelRun(...)", { runId: context.getProperty("ID") })
              .then(function () {
                MessageToast.show(texts.getText("stop.done"));
                return api.refresh();
              })
              .catch(Actions.showError);
          }
        });
      },

      /**
       * Header action of a run: compares it with an earlier run (the one before it preselected) per test case and
       * broker - what broke, what was fixed, what is new or gone. `this` is the extension API of the object page.
       */
      compare: function (context) {
        var model = this.getModel();
        var texts = this.getModel("i18n").getResourceBundle();
        var runId = context.getProperty("ID");
        var createdAt = context.getProperty("createdAt");
        var summaryOfThis = context.getProperty("summary");
        var createdByThis = context.getProperty("createdBy");
        // a run in progress has results that are not sent yet: they are "not run" here, and the summary is not final
        var inProgress = context.getProperty("status") === "RUNNING";
        var state = new JSONModel({ baseRunId: null, runs: [], rows: [], summary: "", hint: inProgress ? texts.getText("compare.inProgress") : "", broken: 0, busy: false });
        var statusText = function (status) {
          return status ? texts.getText("compare.status." + status) : "–";
        };
        var dialog;

        var handler = {
          onCompare: function () {
            var baseRunId = state.getProperty("/baseRunId");
            if (!baseRunId) {
              return;
            }
            state.setProperty("/busy", true);
            Actions.invokeAction(model, "/compareRuns(...)", { baseRunId: baseRunId, otherRunId: runId })
              .then(function (result) {
                var rows = (result.value || []).map(function (r) {
                  return Object.assign({}, r, {
                    changeText: texts.getText("compare.change." + r.change),
                    baseStatusText: statusText(r.baseStatus),
                    otherStatusText: statusText(r.otherStatus),
                    state: STATES[r.change] || "None",
                    latency:
                      r.baseAckLatencyMs == null && r.otherAckLatencyMs == null
                        ? ""
                        : (r.baseAckLatencyMs == null ? "–" : r.baseAckLatencyMs) + " → " + (r.otherAckLatencyMs == null ? "–" : r.otherAckLatencyMs) + " ms"
                  });
                });
                var count = function (change) {
                  return rows.filter(function (r) {
                    return r.change === change;
                  }).length;
                };
                state.setProperty("/rows", rows);
                state.setProperty("/broken", count("BROKEN"));
                state.setProperty("/summary", texts.getText("compare.summary", [count("BROKEN"), count("FIXED"), count("NEW"), count("GONE"), count("NOT_RUN")]));
              })
              .catch(Actions.showError)
              .finally(function () {
                state.setProperty("/busy", false);
              });
          },
          onClose: function () {
            dialog.close();
          }
        };

        // the earlier runs to choose from, newest first
        var runs = model.bindList("/TestRuns", null, [new Sorter("createdAt", true)], [new Filter("createdAt", "LT", createdAt)], {
          $select: "ID,summary,createdAt,createdBy"
        });
        var runsLoaded = runs.requestContexts(0, COMPARE_CHOICES).then(function (contexts) {
          var list = contexts.map(function (c) {
            var run = c.getObject();
            // the earlier run of the same test cases and brokers (the summary names them), else of the same person,
            // else the one before: a run of someone else about something else only shows "new" and "no longer run"
            var score = (run.summary === summaryOfThis ? 2 : 0) + (run.createdBy === createdByThis ? 1 : 0);
            return { ID: run.ID, score: score, label: new Date(run.createdAt).toLocaleString() + " – " + (run.summary || "") };
          });
          var best = list.reduce(function (found, run) {
            return !found || run.score > found.score ? run : found;
          }, null);
          state.setProperty("/runs", list);
          state.setProperty("/baseRunId", best ? best.ID : null);
          if (!list.length) {
            state.setProperty("/summary", texts.getText("compare.noEarlierRun"));
          }
        });

        return Promise.all([this.loadFragment({ id: "compareDialog" + Date.now(), name: "com.aem.suite.runs.ext.CompareDialog", controller: handler }), runsLoaded]).then(
          function (loaded) {
            dialog = loaded[0];
            dialog.setModel(state, "compare");
            dialog.attachAfterClose(function () {
              dialog.destroy();
            });
            dialog.open();
            handler.onCompare();
          },
          Actions.showError
        );
      }
    };
  }
);
