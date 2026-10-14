sap.ui.define([], function () {
  "use strict";

  /**
   * Helpers for JSON payloads containing {{template}} expressions.
   * Expressions outside of JSON strings (e.g. "qty": {{qty}}) are swapped with
   * string tokens so the payload can be parsed and pretty-printed.
   */
  function protect(text) {
    var out = "";
    var tokens = [];
    var inString = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inString) {
        out += c;
        if (c === "\\") {
          out += text[++i] || "";
        } else if (c === '"') {
          inString = false;
        }
      } else if (c === '"') {
        inString = true;
        out += c;
      } else if (c === "{" && text[i + 1] === "{") {
        var end = text.indexOf("}}", i + 2);
        if (end < 0) {
          out += text.slice(i);
          break;
        }
        tokens.push(text.slice(i, end + 2));
        out += '"__AEM_TPL_' + (tokens.length - 1) + '__"';
        i = end + 1;
      } else {
        out += c;
      }
    }
    return { text: out, tokens: tokens };
  }

  function restore(text, tokens) {
    return text.replace(/"__AEM_TPL_(\d+)__"/g, function (m, n) {
      return tokens[Number(n)];
    });
  }

  return {
    /** @returns {string|null} error message or null if valid (empty counts as valid) */
    validate: function (text) {
      if (!text || !text.trim()) {
        return null;
      }
      try {
        JSON.parse(protect(text).text);
        return null;
      } catch (e) {
        return e.message;
      }
    },

    /** Pretty-prints, keeping template expressions. Throws on invalid JSON. */
    format: function (text, indent) {
      var p = protect(text || "");
      return restore(JSON.stringify(JSON.parse(p.text), null, indent || 2), p.tokens);
    },

    /** Lists variable names referenced in the text. */
    variables: function (text) {
      var names = {};
      (text || "").replace(/\{\{\s*([A-Za-z_][\w.-]*)/g, function (m, n) {
        names[n] = true;
      });
      return Object.keys(names);
    }
  };
});
