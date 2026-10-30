sap.ui.define([], function () {
  "use strict";

  // the download has started by then; the object URL only keeps the text in memory
  var REVOKE_URL_MS = 1000;

  return {
    /** Lets the browser save text as a file - a JSON file unless another media type is given. */
    download: function (filename, text, type) {
      var url = URL.createObjectURL(new window.Blob([text], { type: type || "application/json" }));
      var link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, REVOKE_URL_MS);
    },

    /** Opens the file chooser; resolves with { name, text } or null if nothing was chosen. */
    pickJsonFile: function () {
      return new Promise(function (resolve) {
        var input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener("change", function () {
          var file = input.files && input.files[0];
          if (!file) {
            resolve(null);
            return;
          }
          file.text().then(function (text) {
            resolve({ name: file.name, text: text });
          });
        });
        input.addEventListener("cancel", function () {
          resolve(null);
        });
        input.click();
      });
    }
  };
});
