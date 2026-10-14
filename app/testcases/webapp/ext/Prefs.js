sap.ui.define([], function () {
  "use strict";

  /** Per-browser preferences (last used brokers etc.). Never throws - storage may be unavailable. */
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
