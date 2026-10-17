import MessageToast from "sap/m/MessageToast";
import ResponsivePopover from "sap/m/ResponsivePopover";
import List from "sap/m/List";
import { ListBase$ItemPressEvent } from "sap/m/ListBase";
import StandardListItem from "sap/m/StandardListItem";
import Text from "sap/m/Text";
import Event from "sap/ui/base/Event";
import Control from "sap/ui/core/Control";
import Element from "sap/ui/core/Element";
import View from "sap/ui/core/mvc/View";
import JSONModel from "sap/ui/model/json/JSONModel";
import Context from "sap/ui/model/odata/v4/Context";
import { ValueState } from "sap/ui/core/library";
import JsonTemplate from "./JsonTemplate";

const HELP = [
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
  ["{{faker.number.int(1,100)}}", 'faker.js with arguments; add "as name" to keep the value as {{name}}'],
  ["{{broker.name}}", "Name of the broker the message is sent to"],
  ["{{broker.msgVpn}}", "Message VPN of that broker"],
  ["{{broker.id}}", "ID of that broker"]
];
/** One popover per view: it is a dependent of the view and is destroyed with it (e.g. when the app is closed in the launchpad). */
const POPOVER = "aemPayloadHelp";

function viewOf(control: Element): View | undefined {
  let parent: Element | null = control;
  while (parent && !(parent instanceof View)) {
    parent = parent.getParent() as Element | null;
  }
  return parent ?? undefined;
}

function getHelpPopover(source: Element): ResponsivePopover {
  const view = viewOf(source);
  const existing = view?.getDependents().find((d) => (d as Element).data(POPOVER) === true);
  if (existing) {
    return existing as ResponsivePopover;
  }
  const list = new List({
    // setters: values like {{uuid}} must not be parsed as bindings
    items: HELP.map((h) => new StandardListItem({ type: "Active" }).setTitle(h[0]).setDescription(h[1])),
    itemPress: (e: ListBase$ItemPressEvent) => {
      const expr = (e.getParameter("listItem") as StandardListItem).getTitle();
      navigator.clipboard.writeText(expr).then(
        () => MessageToast.show(expr + " copied"),
        () => MessageToast.show(expr)
      );
    }
  });
  const helpPopover = new ResponsivePopover({
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
  view?.addDependent(helpPopover);
  return helpPopover;
}

/** What the status line says about a payload - decided once, for the bindings and while typing. */
function status(text: string | null | undefined): { text: string; state: ValueState; icon: string } {
  const err = JsonTemplate.validate(text);
  return {
    text: err ? "Invalid JSON: " + err : text && text.trim() ? "Valid JSON" : "Empty payload",
    state: err ? ValueState.Error : ValueState.Success,
    icon: err ? "sap-icon://error" : "sap-icon://sys-enter-2"
  };
}

/**
 * The payload the status is about: what is being typed (aem>/typedPayload, set while typing - the payload binding
 * is only updated when the editor loses the focus), else the bound payload.
 */
function current(bound?: string | null, typed?: string | null): string | null | undefined {
  return typed !== null && typed !== undefined ? typed : bound;
}

export default {
  // formatters of the status line: parts [payload, aem>/typedPayload]
  statusText(bound?: string | null, typed?: string | null): string {
    return status(current(bound, typed)).text;
  },

  statusState(bound?: string | null, typed?: string | null): ValueState {
    return status(current(bound, typed)).state;
  },

  statusIcon(bound?: string | null, typed?: string | null): string {
    return status(current(bound, typed)).icon;
  },

  onLiveChange(event: Event<{ value: string }>): void {
    ((event.getSource() as Control).getModel("aem") as JSONModel).setProperty("/typedPayload", event.getParameter("value"));
  },

  onHelp(event: Event): void {
    const source = event.getSource() as Control;
    getHelpPopover(source).openBy(source);
  },

  /** Formats the payload in the binding context of the page (the editor follows the binding). */
  onFormat(event: Event): void {
    const button = event.getSource() as Control;
    const ctx = button.getBindingContext() as Context | undefined;
    const aem = button.getModel("aem") as JSONModel;
    try {
      const formatted = JsonTemplate.format(current(ctx?.getProperty("payload") as string | undefined, aem.getProperty("/typedPayload") as string | null) || "");
      if (ctx) {
        void ctx.setProperty("payload", formatted);
      }
      aem.setProperty("/typedPayload", formatted);
    } catch (e) {
      MessageToast.show("Cannot format - invalid JSON: " + (e as Error).message);
    }
  }
};
