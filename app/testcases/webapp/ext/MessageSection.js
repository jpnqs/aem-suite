sap.ui.define([], function () {
  "use strict";

  /**
   * Topic / name section. The name follows the topic until the user enters an own name - the server applies
   * that rule (srv/test-service.ts). The topic field is a plain control in a custom section, so Fiori elements
   * does not run the side effect topic -> name for it (annotations.cds, #topicName): request it here.
   */
  return {
    onTopicChange: function (event) {
      var ctx = event.getSource().getBindingContext();
      if (ctx) {
        ctx.requestSideEffects(["name"]).catch(function () {
          // the PATCH failed - Fiori elements shows that message
        });
      }
    }
  };
});
