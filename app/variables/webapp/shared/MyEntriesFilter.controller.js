// GENERATED from app/_shared by scripts/sync-shared-ui.js - edit the original there, then run npm run sync:ui
sap.ui.define(["module", "sap/ui/core/mvc/ControllerExtension"], function (module, ControllerExtension) {
  "use strict";

  /**
   * Prefills a "... By" filter of a list report with the logged-in user (from the CAP backend - the
   * launchpad user may differ). Remove or change the filter to see entries of others.
   * The filter field is configured in the manifest: sap.ui5/config/myEntriesFilter, e.g. "createdBy".
   */
  return ControllerExtension.extend(module.id.replace(/\.controller$/, "").replace(/\//g, "."), {
    override: {
      // after rendering: the filter bar exists then (it is created with the view content)
      onAfterRendering: function () {
        var component = this.base.getView().getController().getAppComponent();
        // once per app start: afterwards the user's own filter choice is kept (e.g. after navigating back)
        if (component._aemMyEntriesPrefilled) {
          return;
        }
        component._aemMyEntriesPrefilled = true;
        var field = component.getManifestEntry("/sap.ui5/config/myEntriesFilter");
        var api = this.base.getExtensionAPI();
        var filterBar = this.base.getView().findAggregatedObjects(true, function (c) {
          return c.isA("sap.ui.mdc.FilterBar");
        })[0];
        if (!field || !filterBar) {
          return;
        }
        var user = component.getModel().bindContext("/currentUser()").requestObject();
        Promise.all([user, filterBar.initialized()])
          .then(function (results) {
            var id = results[0] && results[0].value;
            var existing = filterBar.getFilterConditions()[field];
            if (!id || (existing && existing.length)) {
              return undefined;
            }
            return api.setFilterValues(field, "EQ", id).then(function () {
              return filterBar.triggerSearch();
            });
          })
          .catch(function (e) {
            // eslint-disable-next-line no-console
            console.warn("[aem-suite] could not prefill user filter", e);
          });
      }
    }
  });
});
