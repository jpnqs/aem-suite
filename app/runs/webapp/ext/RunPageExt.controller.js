sap.ui.define(["sap/ui/core/mvc/ControllerExtension"], function (ControllerExtension) {
  "use strict";

  /** how often a run in progress is read again */
  var POLL_MS = 3000;
  /** the stable id Fiori elements gives the custom header action "Stop" of the manifest */
  var STOP_ID = "fe::CustomAction::stop";

  function stopPolling(extension) {
    clearInterval(extension._timer);
    extension._timer = undefined;
  }

  function showStop(extension, visible) {
    var button = extension.base.getView().byId(STOP_ID);
    if (button) {
      button.setVisible(visible);
    }
  }

  /**
   * Page of a run: while the run is RUNNING the page reads it again every few seconds (results, totals, status)
   * and offers Stop; the Run dialog is not needed to follow or end a run. Manifest "visible" expressions are
   * evaluated before there is data, so the action is toggled here (like the test case page, ext/ObjectPageExt).
   */
  return ControllerExtension.extend("com.aem.suite.runs.ext.RunPageExt", {
    override: {
      onExit: function () {
        stopPolling(this);
      },
      routing: {
        onBeforeBinding: function () {
          stopPolling(this);
          showStop(this, false);
        },
        onAfterBinding: function (context) {
          var extension = this;
          if (!context) {
            return;
          }
          context.requestProperty("status").then(function (status) {
            var running = status === "RUNNING";
            showStop(extension, running);
            stopPolling(extension);
            if (!running) {
              return;
            }
            extension._timer = setInterval(function () {
              extension.base
                .getExtensionAPI()
                .refresh()
                .then(function () {
                  // the page's current context: refresh() may have replaced the one this started with
                  var current = extension.base.getView().getBindingContext();
                  return current ? current.requestProperty("status") : "RUNNING";
                })
                .then(function (status) {
                  var stillRunning = status === "RUNNING";
                  showStop(extension, stillRunning);
                  if (!stillRunning) {
                    stopPolling(extension);
                  }
                });
            }, POLL_MS);
          });
        }
      }
    }
  });
});
