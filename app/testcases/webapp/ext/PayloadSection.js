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
    ["{{numberRange.ORDERS}}", "Next number of the number range ORDERS (e.g. SO-4500000001), same value everywhere in the message"],
    ["{{numberRange.ORDERS as orderNo}}", "Takes a number and keeps it as {{orderNo}} - reuse it anywhere in the message; each alias gets its own number"],
    ["{{faker.person.fullName}}", "Test data from faker.js: faker.<module>.<method> - names, emails, addresses, companies, dates ... (see the user guide)"],
    ["{{faker.number.int(1,100)}}", "faker.js with arguments; add \"as name\" to keep the value as {{name}}"],
    ["{{broker.name}}", "Name of the broker the message is sent to"],
    ["{{broker.msgVpn}}", "Message VPN of that broker"],
    ["{{broker.id}}", "ID of that broker"]
  ];
  /** One popover per view: it is a dependent of the view and is destroyed with it (e.g. when the app is closed in the launchpad). */
  var POPOVER = "aemPayloadHelp";

  function viewOf(control) {
    var view = control;
    while (view && !view.isA("sap.ui.core.mvc.View")) {
      view = view.getParent();
    }
    return view;
  }

  function getHelpPopover(source) {
    var view = viewOf(source);
    var existing = view && view.getDependents().filter(function (d) {
      return d.data(POPOVER) === true;
    })[0];
    if (existing) {
      return existing;
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
    var helpPopover = new ResponsivePopover({
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
    helpPopover.data(POPOVER, true);
    if (view) {
      view.addDependent(helpPopover);
    }
    return helpPopover;
  }

  function partsOf(control) {
    // control is the editor or the format button; both live in the section's VBox
    var vbox = control.getParent();
    while (vbox && !vbox.isA("sap.m.VBox")) {
      vbox = vbox.getParent();
    }
    var find = function (type) {
      return vbox.findAggregatedObjects(true, function (c) {
        return c.isA(type);
      })[0];
    };
    return {
      editor: find("sap.ui.codeeditor.CodeEditor"),
      status: find("sap.m.ObjectStatus")
    };
  }

  /** What the status line says about a payload: { text, state, icon } - decided once, for the bindings and while typing. */
  function status(text) {
    var err = JsonTemplate.validate(text);
    return {
      text: err ? "Invalid JSON: " + err : text && text.trim() ? "Valid JSON" : "Empty payload",
      state: err ? "Error" : "Success",
      icon: err ? "sap-icon://error" : "sap-icon://sys-enter-2"
    };
  }

  /** While typing the payload binding is not updated yet, so the status control is set directly. */
  function show(control, text) {
    var s = status(text);
    control.setText(s.text);
    control.setState(s.state);
    control.setIcon(s.icon);
  }

  return {
    statusText: function (text) {
      return status(text).text;
    },

    statusState: function (text) {
      return status(text).state;
    },

    statusIcon: function (text) {
      return status(text).icon;
    },

    onLiveChange: function (event) {
      show(partsOf(event.getSource()).status, event.getParameter("value"));
    },

    onHelp: function (event) {
      getHelpPopover(event.getSource()).openBy(event.getSource());
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
