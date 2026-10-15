sap.ui.define(["sap/ui/core/mvc/ControllerExtension"], function (ControllerExtension) {
  "use strict";

  // once per app start: afterwards the user's own filter choice is kept (e.g. after navigating back)
  var prefilled = false;

  /**
   * Prefills the "Started By" filter with the logged-in user (from the CAP backend - the
   * launchpad user may differ). Remove or change the filter to see entries of others.
   */
  return ControllerExtension.extend("com.aem.suite.runs.ext.MyEntriesFilter", {
    override: {
      onInit: function () {
        if (prefilled) {
          return;
        }
        prefilled = true;
        var view = this.base.getView();
        var api = this.base.getExtensionAPI();
        var userPromise = view
          .getController()
          .getAppComponent()
          .getModel()
          .bindContext("/currentUser()")
          .requestObject();
        // the filter bar is created with the view - wait until it has applied variant / app state
        setTimeout(function () {
          var filterBar = view.findAggregatedObjects(true, function (c) {
            return c.isA("sap.ui.mdc.FilterBar");
          })[0];
          if (!filterBar) {
            return;
          }
          Promise.all([userPromise, filterBar.initialized()])
            .then(function (results) {
              var user = results[0] && results[0].value;
              var existing = filterBar.getFilterConditions().runStartedBy;
              if (!user || (existing && existing.length)) {
                return undefined;
              }
              return api.setFilterValues("runStartedBy", "EQ", user).then(function () {
                return filterBar.triggerSearch();
              });
            })
            .catch(function (e) {
              // eslint-disable-next-line no-console
              console.warn("[aem-suite] could not prefill user filter", e);
            });
        }, 0);
      }
    }
  });
});
