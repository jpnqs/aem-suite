sap.ui.define(
  [
    "sap/m/Button",
    "sap/m/Dialog",
    "sap/m/Input",
    "sap/m/Label",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/Text",
    "sap/m/VBox",
    "com/aem/suite/brokers/shared/Actions"
  ],
  function (Button, Dialog, Input, Label, MessageBox, MessageToast, Text, VBox, Actions) {
    "use strict";

    /**
     * "Test Connection" on the list report (selected brokers) and the object page header (manifest.json),
     * called by Fiori elements with `this` = its ExtensionAPI. A custom action instead of the annotated one
     * (the action dialog of Fiori elements shows the password in clear text and is shown for destination
     * brokers too): destination brokers are tested right away, direct brokers ask for the password - and the
     * username if none is maintained - in a dialog with a masked password field.
     */

    // what the connection test writes on the broker (srv/admin-service.ts), refreshed afterwards
    var STATUS_PROPERTIES = ["lastConnectionStatus", "lastConnectionAt", "lastConnectionMessage", "connectionCriticality"];

    function textsOf(api) {
      var bundle = api.getModel("i18n").getResourceBundle();
      return function (key, args) {
        return bundle.getText(key, args) || key;
      };
    }

    /**
     * Asks for the credentials of a direct broker; resolves { username, password }, or null if cancelled.
     * The username field is only shown if the broker has no username.
     */
    function askCredentials(broker, t) {
      return new Promise(function (resolve) {
        var result = null;
        var username = new Input({ visible: !broker.username, placeholder: t("connection.username") });
        var password = new Input({ type: "Password", placeholder: t("connection.password") });

        function submit() {
          if (!password.getValue() || (!broker.username && !username.getValue())) {
            password.setValueState(password.getValue() ? "None" : "Error");
            username.setValueState(broker.username || username.getValue() ? "None" : "Error");
            return;
          }
          // no username parameter if the broker has one (an undefined parameter is refused by the model)
          result = { password: password.getValue() };
          if (!broker.username) result.username = username.getValue();
          dialog.close();
        }
        username.attachSubmit(submit);
        password.attachSubmit(submit);

        var dialog = new Dialog({
          title: t("connection.title", [broker.name]),
          contentWidth: "22rem",
          content: new VBox({
            items: [
              new Text({ text: t("connection.info") }).addStyleClass("sapUiSmallMarginBottom"),
              new Label({ text: t("connection.username"), labelFor: username, required: true, visible: !broker.username }),
              username,
              new Label({ text: t("connection.password"), labelFor: password, required: true }),
              password
            ]
          }).addStyleClass("sapUiSmallMargin"),
          beginButton: new Button({ text: t("connection.test"), type: "Emphasized", press: submit }),
          endButton: new Button({
            text: t("connection.cancel"),
            press: function () {
              dialog.close();
            }
          }),
          initialFocus: broker.username ? password : username,
          afterClose: function () {
            dialog.destroy();
            resolve(result);
          }
        });
        dialog.open();
      });
    }

    /** Tests one broker; resolves when done or cancelled (errors are shown, not passed on). */
    function testBroker(api, context, t) {
      return context
        .requestProperty(["name", "credentialMode", "username", "IsActiveEntity"])
        .then(function (values) {
          var broker = { name: values[0], credentialMode: values[1], username: values[2] };
          if (values[3] === false) {
            MessageToast.show(t("connection.draft", [broker.name]));
            return undefined;
          }
          var credentials =
            broker.credentialMode === "DESTINATION" ? Promise.resolve({}) : askCredentials(broker, t);
          return credentials.then(function (params) {
            if (!params) return undefined;
            return Actions.invokeAction(api.getModel(), "AdminService.testConnection(...)", params, context).then(
              function (check) {
                context.requestSideEffects(STATUS_PROPERTIES);
                if (check.ok) MessageToast.show(t("connection.ok", [broker.name, check.latencyMs]));
                else MessageBox.error(t("connection.failed", [broker.name, check.message]));
              }
            );
          });
        })
        .catch(Actions.showError);
    }

    return {
      /** Tests the selected brokers (list report) or the broker of the page (object page), one after another. */
      test: function (context, selectedContexts) {
        var api = this;
        var t = textsOf(api);
        var contexts = selectedContexts && selectedContexts.length ? selectedContexts : context ? [context] : [];
        return contexts.reduce(function (done, c) {
          return done.then(function () {
            return testBroker(api, c, t);
          });
        }, Promise.resolve());
      }
    };
  }
);
