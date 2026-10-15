sap.ui.define(
  [
    "sap/m/MessageToast",
    "sap/m/ResponsivePopover",
    "sap/m/List",
    "sap/m/StandardListItem",
    "sap/m/Text",
    "com/aem/suite/testcases/ext/JsonTemplate"
  ],
  function (MessageToast, ResponsivePopover, List, StandardListItem, Text, JsonTemplate) {
  "use strict";

  var HELP = [
    ["{{name}}", "Your variable: test case > broker > folder > global variables"],
    ["{{uuid}}", "UUID, same value in topic, payload and correlation ID"],
    ["{{newUuid}}", "New UUID for every occurrence"],
    ["{{now}}", "Current time, ISO 8601"],
    ["{{timestamp}}", "Current time, epoch milliseconds"],
    ["{{date}}", "Current date, YYYY-MM-DD"],
    ["{{randomInt(1,100)}}", "Random integer between min and max (inclusive)"],
    ["{{broker.name}}", "Name of the broker the message is sent to"],
    ["{{broker.msgVpn}}", "Message VPN of that broker"],
    ["{{broker.id}}", "ID of that broker"]
  ];
  var helpPopover;

  function getHelpPopover() {
    if (helpPopover) {
      return helpPopover;
    }
    var list = new List({
      items: HELP.map(function (h) {
        // setters: values like {{uuid}} must not be parsed as bindings
        return new StandardListItem({ type: "Active" }).setTitle(h[0]).setDescription(h[1]);
      }),
      itemPress: function (e) {
        var expr = e.getParameter("listItem").getTitle();
        navigator.clipboard.writeText(expr).then(
          function () {
            MessageToast.show(expr + " copied");
          },
          function () {
            MessageToast.show(expr);
          }
        );
      }
    });
    helpPopover = new ResponsivePopover({
      title: "Template expressions",
      placement: "Bottom",
      contentWidth: "28rem",
      content: [
        new Text()
          .setText('Use in topic, payload, correlation ID and user property values - also outside JSON strings, e.g. "qty": {{qty}}. Click an entry to copy it.')
          .addStyleClass("sapUiSmallMargin"),
        list
      ]
    });
    return helpPopover;
  }

  function partsOf(control) {
    // control is the editor or the format button; both live in the section's VBox
    var vbox = control.getParent();
    while (vbox && !vbox.isA("sap.m.VBox")) {
      vbox = vbox.getParent();
    }
    var toolbar = vbox.getItems()[0];
    return {
      editor: vbox.getItems()[1],
      status: toolbar.getContent()[0]
    };
  }

  function show(status, text) {
    var err = JsonTemplate.validate(text);
    status.setText(err ? "Invalid JSON: " + err : text && text.trim() ? "Valid JSON" : "Empty payload");
    status.setState(err ? "Error" : "Success");
    status.setIcon(err ? "sap-icon://error" : "sap-icon://sys-enter-2");
  }

  return {
    statusText: function (text) {
      var err = JsonTemplate.validate(text);
      return err ? "Invalid JSON: " + err : text && text.trim() ? "Valid JSON" : "Empty payload";
    },

    statusState: function (text) {
      return JsonTemplate.validate(text) ? "Error" : "Success";
    },

    statusIcon: function (text) {
      return JsonTemplate.validate(text) ? "sap-icon://error" : "sap-icon://sys-enter-2";
    },

    onLiveChange: function (event) {
      show(partsOf(event.getSource()).status, event.getParameter("value"));
    },

    onHelp: function (event) {
      getHelpPopover().openBy(event.getSource());
    },

    onFormat: function (event) {
      var parts = partsOf(event.getSource());
      var ctx = parts.editor.getBindingContext();
      try {
        var formatted = JsonTemplate.format(parts.editor.getValue());
        parts.editor.setValue(formatted);
        if (ctx) {
          ctx.setProperty("payload", formatted);
        }
        show(parts.status, formatted);
      } catch (e) {
        MessageToast.show("Cannot format - invalid JSON: " + e.message);
      }
    }
  };
});
