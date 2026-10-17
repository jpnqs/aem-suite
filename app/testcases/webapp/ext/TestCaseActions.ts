import MessageToast from "sap/m/MessageToast";
import Dialog from "sap/m/Dialog";
import JSONModel from "sap/ui/model/json/JSONModel";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import Context from "sap/ui/model/odata/v4/Context";
import ExtensionAPI from "sap/fe/core/ExtensionAPI";
import ListReportExtensionAPI from "sap/fe/templates/ListReport/ExtensionAPI";
import Prefs from "com/aem/suite/testcases/shared/Prefs";
import Actions from "com/aem/suite/testcases/shared/Actions";
import RunDialog from "./RunDialog";
import FileIO from "./FileIO";

/**
 * The handlers of the custom actions in manifest.json (list report toolbar, object page header).
 * Fiori elements calls them with `this` = its ExtensionAPI.
 */

const { showError, errorText } = Actions;

/** Brokers offered in the preview (the run dialog lists all of them). */
const MAX_BROKERS = 200;

type Copy = { ID: string; name: string };

/**
 * Copies test cases / folders (folders with everything below them) on the server.
 * Resolves with the copies; the copy is placed right after its original.
 */
function copyNodes(api: ExtensionAPI, ids: string[]): Promise<Copy[]> {
  return Actions.invokeAction<{ value?: Copy[] }>(api.getModel() as ODataModel, "/copyNodes(...)", { ids }).then((result) => result.value || []);
}

function copiedMessage(copies: Copy[]): string {
  return copies.length === 1 ? 'Copied as "' + copies[0].name + '"' : copies.length + " copies created";
}

/** The selected nodes that are saved; tells the user if unsaved drafts were left out. */
function activeContexts(contexts?: Context[]): Context[] {
  const all = contexts || [];
  const active = all.filter((c) => c.getProperty("IsActiveEntity") !== false);
  if (active.length !== all.length) {
    MessageToast.show("Unsaved drafts are skipped");
  }
  return active;
}

function idsOf(contexts: Context[]): string[] {
  return contexts.map((c) => c.getProperty("ID") as string);
}

export default {
  /** List report toolbar action: saves the selected test cases / folders (everything if nothing is selected) as a JSON file. */
  exportSelected(this: ListReportExtensionAPI, _context: Context, selectedContexts?: Context[]): Promise<void> | undefined {
    const ids = idsOf(activeContexts(selectedContexts));
    // only unsaved drafts selected: nothing to export (no ids would mean "everything")
    if ((selectedContexts || []).length && !ids.length) {
      return undefined;
    }
    return FileIO.exportNodes(this, ids).catch(showError);
  },

  /** Object page header action: saves this test case or folder (with everything below) as a JSON file. */
  exportFromObjectPage(this: ExtensionAPI, context: Context): Promise<void> {
    return FileIO.exportNodes(this, [context.getProperty("ID") as string]).catch(showError);
  },

  /**
   * List report toolbar action: imports a JSON file as new test cases and folders. They go into the selected
   * folder (if exactly one folder is selected), otherwise to the top level. The file is checked first, then
   * the user confirms.
   */
  importFile(this: ListReportExtensionAPI, _context: Context, selectedContexts?: Context[]): Promise<void> {
    const selected = selectedContexts || [];
    const target = selected.length === 1 && selected[0].getProperty("kind") === "FOLDER" ? (selected[0].getProperty("ID") as string) : null;
    return FileIO.importNodes(this, target).catch(showError);
  },

  /** List report toolbar action (multi selection): copies the selected test cases and folders. */
  copySelected(this: ListReportExtensionAPI, _context: Context, selectedContexts?: Context[]): Promise<void> | undefined {
    const ids = idsOf(activeContexts(selectedContexts));
    if (!ids.length) {
      return undefined;
    }
    return copyNodes(this, ids)
      .then((copies) => {
        MessageToast.show(copiedMessage(copies));
        return this.refresh();
      })
      .catch(showError);
  },

  /** Object page header action: copies this test case or folder. */
  copyFromObjectPage(this: ExtensionAPI, context: Context): Promise<void> {
    return copyNodes(this, [context.getProperty("ID") as string])
      .then((copies) => MessageToast.show(copiedMessage(copies) + " - find it next to the original in the list"))
      .catch(showError);
  },

  /** List report toolbar action (multi selection). */
  runSelected(this: ListReportExtensionAPI, _context: Context, selectedContexts?: Context[]): Promise<void> | undefined {
    const active = activeContexts(selectedContexts);
    if (!active.length) {
      return undefined;
    }
    const ids = idsOf(active);
    const label = ids.length === 1 ? (active[0].getProperty("name") as string) : ids.length + " test cases";
    return RunDialog.open(this, ids, label).catch(showError);
  },

  /** Object page header action. */
  runFromObjectPage(this: ExtensionAPI, context: Context): Promise<void> {
    return RunDialog.open(this, [context.getProperty("ID") as string], context.getProperty("name") as string).catch(showError);
  },

  /** Object page header action: resolves templates without sending. */
  preview(this: ExtensionAPI, context: Context): Promise<void> {
    const model = this.getModel() as ODataModel;
    const state = new JSONModel({ brokerId: null, valid: false, message: "" });
    let dialog: Dialog;

    const handler = {
      onResolve(): void {
        const brokerId = (state.getProperty("/brokerId") as string | null) || null;
        if (brokerId) {
          Prefs.set("lastPreviewBroker", brokerId);
        }
        Actions.invokeAction(model, "TestService.preview(...)", { brokerId }, context)
          .then((result) => state.setData({ brokerId: state.getProperty("/brokerId"), ...result }))
          .catch((e) => {
            state.setProperty("/valid", false);
            state.setProperty("/message", errorText(e));
          });
      },
      onClose(): void {
        dialog.close();
      }
    };

    // preselect: last previewed broker, else broker of the last run, else the first broker
    const brokersLoaded = model
      .bindList("/Brokers", undefined, [], [], { $select: "ID", $orderby: "name" })
      .requestContexts(0, MAX_BROKERS)
      .then((contexts) => {
        const ids = contexts.map((c) => c.getProperty("ID") as string);
        const preferred = [Prefs.get<string | undefined>("lastPreviewBroker", undefined), ...Prefs.get<string[]>("lastBrokers", []), ids[0]];
        state.setProperty("/brokerId", preferred.find((id) => id && ids.includes(id)) || null);
      })
      .catch(() => {
        /* resolve with global variables only */
      });

    return Promise.all([this.loadFragment({ id: "previewDialog" + Date.now(), name: "com.aem.suite.testcases.ext.PreviewDialog", controller: handler }), brokersLoaded]).then(
      ([d]) => {
        dialog = d as Dialog;
        dialog.setModel(state, "preview");
        dialog.attachAfterClose(() => dialog.destroy());
        dialog.open();
        handler.onResolve();
      }
    );
  }
};
