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
import { textsOf } from "./i18n";

/** The template expressions of the help popover; the explanations are texts of the bundle (payload.help.<n>). */
const HELP = [
  "{{name}}",
  "{{uuid}}",
  "{{newUuid}}",
  "{{now}}",
  "{{timestamp}}",
  "{{date}}",
  "{{randomInt(1,100)}}",
  "{{numberRange.ORDERS}}",
  "{{numberRange.ORDERS as orderNo}}",
  "{{faker.person.fullName}}",
  "{{faker.number.int(1,100)}}",
  "{{broker.name}}",
  "{{broker.msgVpn}}",
  "{{broker.id}}"
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
  const t = textsOf(source);
  const list = new List({
    // setters: values like {{uuid}} must not be parsed as bindings
    items: HELP.map((expr, i) => new StandardListItem({ type: "Active" }).setTitle(expr).setDescription(t(`payload.help.${i + 1}`))),
    itemPress: (e: ListBase$ItemPressEvent) => {
      const expr = (e.getParameter("listItem") as StandardListItem).getTitle();
      navigator.clipboard.writeText(expr).then(
        () => MessageToast.show(t("payload.copied", [expr])),
        () => MessageToast.show(expr)
      );
    }
  });
  const helpPopover = new ResponsivePopover({
    title: t("payload.helpTitle"),
    placement: "Bottom",
    contentWidth: "28rem",
    content: [
      new Text()
        .setText(t("payload.helpIntro"))
        .addStyleClass("sapUiSmallMargin"),
      list
    ]
  });
  helpPopover.data(POPOVER, true);
  view?.addDependent(helpPopover);
  return helpPopover;
}

/** The texts of the status line - from the bundle, or passed in by the binding (the formatters have no models). */
interface StatusTexts {
  valid: string;
  empty: string;
  /** with {0} = the parser's message */
  invalid: string;
}

/** What the status line says about a payload - decided once, for the bindings and while typing. */
function status(text: string | null | undefined, texts?: StatusTexts): { text: string; state: ValueState; icon: string } {
  const err = JsonTemplate.validate(text);
  return {
    text: !texts ? "" : err ? texts.invalid.replace("{0}", err) : text && text.trim() ? texts.valid : texts.empty,
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
  // formatters of the status line: parts [payload, aem>/typedPayload] (+ the three texts for statusText)
  statusText(bound?: string | null, typed?: string | null, valid = "", empty = "", invalid = ""): string {
    return status(current(bound, typed), { valid, empty, invalid }).text;
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
      MessageToast.show(textsOf(button)("payload.cannotFormat", [(e as Error).message]));
    }
  }
};
