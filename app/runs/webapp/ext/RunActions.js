sap.ui.define(
  ["sap/m/MessageBox", "sap/m/MessageToast", "sap/ui/model/Filter", "sap/ui/model/Sorter", "sap/ui/model/json/JSONModel", "com/aem/suite/runs/shared/Actions"],
  function (MessageBox, MessageToast, Filter, Sorter, JSONModel, Actions) {
    "use strict";

    /** how many earlier runs the compare dialog offers */
    var COMPARE_CHOICES = 30;
    var STATES = { BROKEN: "Error", FIXED: "Success", NEW: "Information", GONE: "Warning", STILL_FAILING: "Error", STILL_PASSING: "None" };

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
        var state = new JSONModel({ baseRunId: null, runs: [], rows: [], summary: "", broken: 0, busy: false });
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
                state.setProperty("/summary", texts.getText("compare.summary", [count("BROKEN"), count("FIXED"), count("NEW"), count("GONE")]));
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
          $select: "ID,summary,createdAt"
        });
        var runsLoaded = runs.requestContexts(0, COMPARE_CHOICES).then(function (contexts) {
          var list = contexts.map(function (c) {
            var run = c.getObject();
            return { ID: run.ID, label: new Date(run.createdAt).toLocaleString() + " – " + (run.summary || "") };
          });
          state.setProperty("/runs", list);
          state.setProperty("/baseRunId", list.length ? list[0].ID : null);
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
