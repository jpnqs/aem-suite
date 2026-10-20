sap.ui.define([], function () {
  "use strict";

  /**
   * Read-only code editors for JSON that was sent or received (resolved payload of a result, saved messages):
   * a payload that is JSON is shown formatted - what went over the wire is often one line -, anything else as it is.
   */
  function parse(text) {
    try {
      return { json: JSON.parse(text) };
    } catch (e) {
      return null;
    }
  }

  return {
    /** The text, formatted if it is JSON. */
    pretty: function (text) {
      if (!text) {
        return "";
      }
      var parsed = parse(text);
      return parsed ? JSON.stringify(parsed.json, null, 2) : text;
    },

    /** The mode of the editor: JSON highlighting for JSON, plain text otherwise. */
    editorType: function (text) {
      return text && !parse(text) ? "text" : "json";
    }
  };
});
