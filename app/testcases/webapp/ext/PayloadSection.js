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

  /** What the status line says about a payload: { text, state, icon } - decided once, for the bindings and while typing. */
  function status(text) {
    var err = JsonTemplate.validate(text);
    return {
      text: err ? "Invalid JSON: " + err : text && text.trim() ? "Valid JSON" : "Empty payload",
      state: err ? "Error" : "Success",
      icon: err ? "sap-icon://error" : "sap-icon://sys-enter-2"
    };
  }

  /**
   * The payload the status is about: what is being typed (aem>/typedPayload, set while typing - the payload binding
   * is only updated when the editor loses the focus), else the bound payload.
   */
  function current(bound, typed) {
    return typed !== null && typed !== undefined ? typed : bound;
  }

  return {
    // formatters of the status line: parts [payload, aem>/typedPayload]
    statusText: function (bound, typed) {
      return status(current(bound, typed)).text;
    },

    statusState: function (bound, typed) {
      return status(current(bound, typed)).state;
    },

    statusIcon: function (bound, typed) {
      return status(current(bound, typed)).icon;
    },

    onLiveChange: function (event) {
      event.getSource().getModel("aem").setProperty("/typedPayload", event.getParameter("value"));
    },

    onHelp: function (event) {
      getHelpPopover(event.getSource()).openBy(event.getSource());
    },

    /** Formats the payload in the binding context of the page (the editor follows the binding). */
    onFormat: function (event) {
      var button = event.getSource();
      var ctx = button.getBindingContext();
      var aem = button.getModel("aem");
      try {
        var formatted = JsonTemplate.format(current(ctx && ctx.getProperty("payload"), aem.getProperty("/typedPayload")) || "");
        if (ctx) {
          ctx.setProperty("payload", formatted);
        }
        aem.setProperty("/typedPayload", formatted);
      } catch (e) {
        MessageToast.show("Cannot format - invalid JSON: " + e.message);
      }
    }
  };
});
