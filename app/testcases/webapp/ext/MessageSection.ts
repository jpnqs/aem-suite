import Event from "sap/ui/base/Event";
import Control from "sap/ui/core/Control";
import Context from "sap/ui/model/odata/v4/Context";

/**
 * Topic / name section. The name follows the topic until the user enters an own name - the server applies
 * that rule (srv/test-service.ts). The topic field is a plain control in a custom section, so Fiori elements
 * does not run the side effect topic -> name for it (annotations.cds, #topicName): request it here.
 */
export default {
  onTopicChange(event: Event): void {
    const ctx = (event.getSource() as Control).getBindingContext() as Context | undefined;
    if (ctx) {
      ctx.requestSideEffects(["name"]).catch(() => {
        // the PATCH failed - Fiori elements shows that message
      });
    }
  }
};
