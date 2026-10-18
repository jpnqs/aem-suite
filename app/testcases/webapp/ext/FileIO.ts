import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ExtensionAPI from "sap/fe/core/ExtensionAPI";
import ListReportExtensionAPI from "sap/fe/templates/ListReport/ExtensionAPI";
import Actions from "com/aem/suite/testcases/shared/Actions";
import Files from "com/aem/suite/testcases/shared/Files";
import { textsOf, Texts } from "./i18n";

/**
 * Export and import of test cases and folders as a JSON file: the browser saves / reads the file, the content
 * travels in the actions exportNodes / importNodes of the service (srv/lib/testcases/export-import.ts).
 */

interface Counts {
  folders?: number;
  testCases?: number;
}

/** "2 folders and 5 test cases" */
function describeCounts(r: Counts, t: Texts): string {
  const parts: string[] = [];
  if (r.folders) {
    parts.push(t(r.folders === 1 ? "file.folderOne" : "file.folderMany", [r.folders]));
  }
  if (r.testCases) {
    parts.push(t(r.testCases === 1 ? "file.testCaseOne" : "file.testCaseMany", [r.testCases]));
  }
  return parts.join(t("file.and")) || t("file.nothing");
}

/** Asks whether the checked file should be imported; resolves true or false. */
function confirmImport(fileName: string, check: Counts & { target?: string | null }, t: Texts): Promise<boolean> {
  const importAction = t("action.import");
  return new Promise((resolve) => {
    MessageBox.confirm(
      t("file.confirmImport", [describeCounts(check, t), fileName, check.target ? t("file.intoFolder", [check.target]) : t("file.intoTop")]),
      {
        title: importAction,
        actions: [importAction, MessageBox.Action.CANCEL],
        emphasizedAction: importAction,
        onClose: (action: string | null) => resolve(action === importAction)
      }
    );
  });
}

export default {
  /** Saves the given nodes (no ids: everything) as a JSON file. */
  exportNodes(api: ExtensionAPI, ids: string[]): Promise<void> {
    const t = textsOf(api);
    return Actions.invokeAction<Counts & { filename: string; content: string }>(api.getModel() as ODataModel, "/exportNodes(...)", { ids }).then((result) => {
      Files.download(result.filename, result.content);
      MessageToast.show(t("file.exported", [describeCounts(result, t), result.filename]));
    });
  },

  /**
   * Lets the user pick a file, checks it on the server (dry run), asks, then imports it below parentId
   * (null = top level) and refreshes the list. Resolves when done or cancelled.
   */
  async importNodes(api: ListReportExtensionAPI, parentId: string | null): Promise<void> {
    const model = api.getModel() as ODataModel;
    const t = textsOf(api);
    const file = await Files.pickJsonFile();
    if (!file) {
      return;
    }
    const importCall = (dryRun: boolean) =>
      Actions.invokeAction<Counts & { target?: string | null }>(model, "/importNodes(...)", { content: file.text, parentId, dryRun });
    const check = await importCall(true);
    if (!(await confirmImport(file.name, check, t))) {
      return;
    }
    const result = await importCall(false);
    MessageToast.show(t("file.imported", [describeCounts(result, t)]));
    await api.refresh();
  }
};
