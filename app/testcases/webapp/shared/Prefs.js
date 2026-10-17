// GENERATED from app/_shared by scripts/sync-shared-ui.js - edit the original there, then run npm run sync:ui
sap.ui.define([], function () {
  "use strict";

  /**
   * Per-browser preferences (last used brokers, run settings, the subscriber's form ...), as JSON in localStorage
   * under "aem-suite.<key>". Never throws - storage may be unavailable.
   */
  var PREFIX = "aem-suite.";

  return {
    get: function (key, fallback) {
      try {
        var v = window.localStorage.getItem(PREFIX + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set: function (key, value) {
      try {
        window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch (e) {
        /* ignore */
      }
    }
  };
});
