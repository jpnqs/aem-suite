import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";
import Context from "sap/ui/model/odata/v4/Context";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import DateFormat from "sap/ui/core/format/DateFormat";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import Dialog from "sap/m/Dialog";
import Button from "sap/m/Button";
import Input from "sap/m/Input";
import Label from "sap/m/Label";
import Text from "sap/m/Text";
import VBox from "sap/m/VBox";
import List from "sap/m/List";
import StandardListItem from "sap/m/StandardListItem";
import Select from "sap/m/Select";
import Table from "sap/m/Table";
import Event from "sap/ui/base/Event";
import Actions from "com/aem/suite/cleanup/shared/Actions";
import Help from "com/aem/suite/cleanup/shared/Help";
import { CleanupRequest, defaultSelection, fromRequest, hasSelection, Selection, toRequest } from "../util/CleanupRequest";

const { errorText, invokeAction } = Actions;
/** above this many rows the user types the number to confirm */
const TYPE_TO_CONFIRM = 1000;

interface Sample {
  ID: string;
  title: string | null;
  info: string | null;
  date: string | null;
}

interface CategoryResult {
  category: string;
  count: number;
  cutoff: string | null;
  samples: Sample[];
}

/** The model "state" of the page. */
interface CleanupState {
  tab: "cleanup" | "history";
  selection: Selection;
  hasSelection: boolean;
  users: { name: string }[];
  ruleId: string;
  preview: { categories: CategoryResult[]; total: number } | null;
  /** the request the preview was made for (JSON) - the delete button needs the selection unchanged */
  previewKey: string;
  previewCurrent: boolean;
  busy: boolean;
  /** latest date of "before" */
  yesterday: Date;
}

const dateTime = DateFormat.getDateTimeInstance({ style: "medium" });

/**
 * @namespace com.aem.suite.cleanup.controller
 */
export default class Main extends Controller {
  private state: JSONModel;

  public onInit(): void {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const initial: CleanupState = {
      tab: "cleanup",
      selection: defaultSelection(),
      hasSelection: false,
      users: [],
      ruleId: "",
      preview: null,
      previewKey: "",
      previewCurrent: false,
      busy: false,
      yesterday
    };
    this.state = new JSONModel(initial);
    // every change of the form (two-way bindings) may make the preview outdated
    this.state.attachPropertyChange(() => this.updateFlags());
    this.getView()!.setModel(this.state, "state");
    this.loadUsers();
  }

  // ------------------------------------------------------------------------------------------------ helpers

  private odata(): ODataModel {
    // from the component: in onInit the view does not have it yet
    return this.getOwnerComponent()!.getModel() as ODataModel;
  }

  private text(key: string, args?: unknown[]): string {
    const bundle = (this.getOwnerComponent()!.getModel("i18n") as ResourceModel).getResourceBundle() as ResourceBundle;
    return bundle.getText(key, args as string[]) ?? key;
  }

  private selection(): Selection {
    return this.state.getProperty("/selection") as Selection;
  }

  private request(): CleanupRequest {
    return toRequest(this.selection());
  }

  /** hasSelection and previewCurrent after a change of the selection */
  private updateFlags(): void {
    this.state.setProperty("/hasSelection", hasSelection(this.selection()));
    this.state.setProperty("/previewCurrent", !!this.state.getProperty("/preview") && this.state.getProperty("/previewKey") === JSON.stringify(this.request()));
  }

  private setSelection(selection: Selection): void {
    this.state.setProperty("/selection", selection);
    this.clearPreview();
  }

  private clearPreview(): void {
    this.state.setProperty("/preview", null);
    this.state.setProperty("/previewKey", "");
    this.updateFlags();
  }

  private loadUsers(): void {
    invokeAction<{ value?: string[] }>(this.odata(), "/users(...)")
      .then((r) => this.state.setProperty("/users", (r.value ?? []).map((name) => ({ name }))))
      .catch(() => undefined); // only a value help
  }

  private async busy<T>(fn: () => Promise<T>): Promise<T> {
    this.state.setProperty("/busy", true);
    try {
      return await fn();
    } finally {
      this.state.setProperty("/busy", false);
    }
  }

  // ------------------------------------------------------------------------------------------------ formatters

  public categoryText(category: string): string {
    return category ? this.text(`category.${category}`) : "";
  }

  public cutoffText(cutoff: string | null): string {
    return cutoff ? this.text("preview.before", [dateTime.format(new Date(cutoff))]) : this.text("preview.noAge");
  }

  public statusText(status: string): string {
    return status ? this.text(`status.${status}`) : "";
  }

  // ------------------------------------------------------------------------------------------------ page

  public onHelp(): void {
    Help.open();
  }

  public onTabSelect(): void {
    if (this.state.getProperty("/tab") !== "history") return;
    const binding = (this.byId("historyTable") as Table).getBinding("items") as ODataListBinding;
    if (binding.isSuspended()) binding.resume();
    else binding.refresh();
  }

  public onReset(): void {
    this.state.setProperty("/ruleId", "");
    this.setSelection(defaultSelection());
  }

  // ------------------------------------------------------------------------------------------------ preview and delete

  public async onPreview(): Promise<void> {
    const request = this.request();
    try {
      const result = await this.busy(() => invokeAction<{ value?: CategoryResult[] }>(this.odata(), "/preview(...)", { request }));
      const categories = result.value ?? [];
      this.state.setProperty("/preview", { categories, total: categories.reduce((n, c) => n + c.count, 0) });
      this.state.setProperty("/previewKey", JSON.stringify(request));
      this.updateFlags();
    } catch (e) {
      this.clearPreview();
      MessageBox.error(errorText(e));
    }
  }

  public onShowSamples(event: Event): void {
    const row = (event.getSource() as Button).getBindingContext("state")!.getObject() as CategoryResult;
    const list = new List({
      items: row.samples.map(
        (s) =>
          new StandardListItem({
            title: s.title || s.ID,
            description: s.info ?? "",
            info: s.date ? dateTime.format(new Date(s.date)) : ""
          })
      )
    });
    const dialog: Dialog = new Dialog({
      title: this.text("samples.title", [this.categoryText(row.category)]),
      contentWidth: "40rem",
      content: [
        new Text({ text: this.text("samples.info", [row.samples.length, row.count]) }).addStyleClass("sapUiSmallMargin"),
        list
      ],
      endButton: new Button({ text: this.text("dialog.close"), press: () => dialog.close() }),
      afterClose: () => dialog.destroy()
    });
    this.getView()!.addDependent(dialog);
    dialog.open();
  }

  public onDelete(): void {
    const preview = this.state.getProperty("/preview") as CleanupState["preview"];
    if (!preview || !this.state.getProperty("/previewCurrent")) return;
    const lines = preview.categories.filter((c) => c.count > 0).map((c) => `${this.categoryText(c.category)}: ${c.count}`);
    const mustType = preview.total > TYPE_TO_CONFIRM;
    const input = new Input({ placeholder: String(preview.total), width: "10rem", type: "Number" });
    const confirm: Button = new Button({
      text: this.text("confirm.delete"),
      type: "Reject",
      enabled: !mustType,
      press: () => {
        dialog.close();
        void this.execute(preview.categories);
      }
    });
    if (mustType) input.attachLiveChange(() => confirm.setEnabled(input.getValue().trim() === String(preview.total)));
    const dialog: Dialog = new Dialog({
      title: this.text("confirm.title"),
      type: "Message",
      state: "Warning",
      content: new VBox({
        items: [
          new Text({ text: this.text("confirm.text", [preview.total]) }),
          new Text({ text: lines.join("\n") }).addStyleClass("sapUiSmallMarginTop sapUiSmallMarginBottom"),
          new Text({ text: this.text("confirm.irreversible") }),
          ...(mustType ? [new Label({ text: this.text("confirm.type", [preview.total]), labelFor: input }).addStyleClass("sapUiSmallMarginTop"), input] : [])
        ]
      }),
      beginButton: confirm,
      endButton: new Button({ text: this.text("dialog.cancel"), press: () => dialog.close() }),
      afterClose: () => dialog.destroy()
    });
    this.getView()!.addDependent(dialog);
    dialog.open();
  }

  private async execute(categories: CategoryResult[]): Promise<void> {
    const request = this.request();
    const ruleName = this.selectedRule()?.getProperty("name") as string | undefined;
    try {
      const result = await this.busy(() =>
        invokeAction<{ totalCount: number }>(this.odata(), "/execute(...)", {
          request,
          expected: categories.map((c) => ({ category: c.category, count: c.count })),
          ruleName: ruleName ?? null
        })
      );
      MessageToast.show(this.text("done", [result.totalCount]));
    } catch (e) {
      MessageBox.error(errorText(e));
    } finally {
      // after a cleanup (or a refusal because the data changed) the old preview is no longer true
      this.clearPreview();
      this.loadUsers();
      const history = (this.byId("historyTable") as Table).getBinding("items") as ODataListBinding;
      if (!history.isSuspended()) history.refresh();
    }
  }

  // ------------------------------------------------------------------------------------------------ saved rules

  private rules(): ODataListBinding {
    return (this.byId("ruleSelect") as Select).getBinding("items") as ODataListBinding;
  }

  private selectedRule(): Context | undefined {
    const id = this.state.getProperty("/ruleId") as string;
    return id ? (this.rules().getCurrentContexts() as Context[]).find((c) => c.getProperty("ID") === id) : undefined;
  }

  public onRuleChange(): void {
    const rule = this.selectedRule();
    if (!rule) return;
    let request: CleanupRequest | null = null;
    try {
      request = JSON.parse(rule.getProperty("request") as string) as CleanupRequest;
    } catch {
      MessageBox.error(this.text("rule.broken"));
    }
    this.setSelection(fromRequest(request));
  }

  public onSaveRule(): void {
    const current = this.selectedRule();
    const name = new Input({ value: (current?.getProperty("name") as string) ?? "", maxLength: 100 });
    const description = new Input({ value: (current?.getProperty("description") as string) ?? "", maxLength: 500 });
    const save: Button = new Button({
      text: this.text("rule.save"),
      type: "Emphasized",
      press: () => {
        const n = name.getValue().trim();
        if (!n) return name.setValueState("Error");
        dialog.close();
        void this.saveRule(n, description.getValue().trim());
      }
    });
    const dialog: Dialog = new Dialog({
      title: this.text("rule.saveAs"),
      content: new VBox({
        items: [new Label({ text: this.text("rule.name"), labelFor: name, required: true }), name, new Label({ text: this.text("rule.description"), labelFor: description }), description]
      }).addStyleClass("sapUiSmallMargin"),
      beginButton: save,
      endButton: new Button({ text: this.text("dialog.cancel"), press: () => dialog.close() }),
      afterClose: () => dialog.destroy()
    });
    this.getView()!.addDependent(dialog);
    dialog.open();
  }

  /** same name as a saved rule: that one is updated */
  private async saveRule(name: string, description: string): Promise<void> {
    const request = JSON.stringify(this.request());
    const existing = (this.rules().getCurrentContexts() as Context[]).find((c) => (c.getProperty("name") as string).toLowerCase() === name.toLowerCase());
    try {
      if (existing) {
        await Promise.all([existing.setProperty("request", request), existing.setProperty("description", description)]);
        this.state.setProperty("/ruleId", existing.getProperty("ID"));
      } else {
        const created = this.rules().create({ name, description, request });
        await created.created();
        this.state.setProperty("/ruleId", created.getProperty("ID"));
      }
      MessageToast.show(this.text("rule.saved", [name]));
    } catch (e) {
      this.odata().resetChanges();
      MessageBox.error(errorText(e));
    }
  }

  public onDeleteRule(): void {
    const rule = this.selectedRule();
    if (!rule) return;
    const name = rule.getProperty("name") as string;
    MessageBox.confirm(this.text("rule.deleteConfirm", [name]), {
      onClose: (action: string | null) => {
        if (action !== MessageBox.Action.OK) return;
        rule
          .delete()
          .then(() => {
            this.state.setProperty("/ruleId", "");
            MessageToast.show(this.text("rule.deleted", [name]));
          })
          .catch((e: unknown) => MessageBox.error(errorText(e)));
      }
    });
  }
}
