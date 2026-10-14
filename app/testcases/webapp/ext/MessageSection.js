sap.ui.define([], function () {
  "use strict";

  /**
   * Topic / name section. The name follows the topic until the user enters an own name
   * (the server applies the same rule, this keeps the UI in sync immediately).
   */
  return {
    onTopicLiveChange: function (event) {
      var area = event.getSource();
      // remember the topic before this edit (model is updated only on change)
      if (area.data("topicBefore") === null || area.data("topicBefore") === undefined) {
        var ctx = area.getBindingContext();
        area.data("topicBefore", (ctx && ctx.getProperty("topic")) || "");
      }
    },

    onTopicChange: function (event) {
      var area = event.getSource();
      var ctx = area.getBindingContext();
      var before = area.data("topicBefore");
      area.data("topicBefore", null);
      if (!ctx) {
        return;
      }
      var topic = (event.getParameter("value") || "").slice(0, 200);
      var name = ctx.getProperty("name");
      if (!name || name === before) {
        ctx.setProperty("name", topic);
      }
    }
  };
});
