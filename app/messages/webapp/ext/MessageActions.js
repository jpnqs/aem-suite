sap.ui.define(
  ["sap/m/MessageBox", "com/aem/suite/messages/shared/Actions", "com/aem/suite/messages/shared/Navigation"],
  function (MessageBox, Actions, Navigation) {
    "use strict";

    /**
     * Creates a test case from every message of the contexts, one after the other, and offers to open the result:
     * the test case itself for one message, the Test Cases app for several.
     */
    function createTestCases(api, contexts) {
      var model = api.getModel();
      var texts = api.getModel("i18n").getResourceBundle();
      var created = [];
      var work = contexts.reduce(function (chain, context) {
        return chain.then(function () {
          return Actions.invokeAction(model, "SubscribeService.createTestCase(...)", {}, context).then(function (result) {
            created.push({ ID: result.ID, topic: context.getProperty("topic") });
          });
        });
      }, Promise.resolve());
      return Actions.busy(work)
        .then(function () {
          if (!created.length) {
            return;
          }
          var one = created.length === 1;
          var open = texts.getText(one ? "created.openOne" : "created.openMany");
          MessageBox.success(one ? texts.getText("created.one", [created[0].topic]) : texts.getText("created.many", [created.length]), {
            actions: [open, MessageBox.Action.CLOSE],
            emphasizedAction: open,
            onClose: function (action) {
              if (action === open) {
                Navigation.toApp({ app: "testcases", path: one ? "TestCases(ID=" + created[0].ID + ",IsActiveEntity=true)" : "" });
              }
            }
          });
        })
        .catch(Actions.showError);
    }

    return {
      /** List report toolbar action: a test case from each selected message. `this` is the extension API. */
      createFromSelection: function (_context, selectedContexts) {
        return createTestCases(this, selectedContexts || []);
      },

      /** Object page header action: a test case from this message. */
      createFromPage: function (context) {
        return createTestCases(this, [context]);
      }
    };
  }
);
