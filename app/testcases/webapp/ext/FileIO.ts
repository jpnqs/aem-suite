import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ExtensionAPI from "sap/fe/core/ExtensionAPI";
import ListReportExtensionAPI from "sap/fe/templates/ListReport/ExtensionAPI";
import Actions from "com/aem/suite/testcases/shared/Actions";

/**
 * Export and import of test cases and folders as a JSON file: the browser saves / reads the file, the content
 * travels in the actions exportNodes / importNodes of the service (srv/lib/export-import.ts).
 */

const REVOKE_URL_MS = 1000;

interface Counts {
  folders?: number;
  testCases?: number;
}

/** "2 folders and 5 test cases" */
function describeCounts(r: Counts): string {
  const parts: string[] = [];
  if (r.folders) {
    parts.push(r.folders + (r.folders === 1 ? " folder" : " folders"));
  }
  if (r.testCases) {
    parts.push(r.testCases + (r.testCases === 1 ? " test case" : " test cases"));
  }
  return parts.join(" and ") || "nothing";
}

/** Lets the browser save text as a file. */
function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new window.Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // the download has started by then; the object URL only keeps the text in memory
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_URL_MS);
}

/** Opens the file chooser; resolves with { name, text } or null if nothing was chosen. */
function pickJsonFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file.text().then((text) => resolve({ name: file.name, text }));
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** Asks whether the checked file should be imported; resolves true or false. */
function confirmImport(fileName: string, check: Counts & { target?: string | null }): Promise<boolean> {
  return new Promise((resolve) => {
    MessageBox.confirm(
      "Import " + describeCounts(check) + ' from "' + fileName + '" into ' +
        (check.target ? 'the folder "' + check.target + '"' : "the top level") + "?\n\n" +
        "They are added as new items. Existing test cases and folders are not changed.",
      {
        title: "Import",
        actions: ["Import", MessageBox.Action.CANCEL],
        emphasizedAction: "Import",
        onClose: (action: string | null) => resolve(action === "Import")
      }
    );
  });
}

export default {
  /** Saves the given nodes (no ids: everything) as a JSON file. */
  exportNodes(api: ExtensionAPI, ids: string[]): Promise<void> {
    return Actions.invokeAction<Counts & { filename: string; content: string }>(api.getModel() as ODataModel, "/exportNodes(...)", { ids }).then((result) => {
      download(result.filename, result.content);
      MessageToast.show("Exported " + describeCounts(result) + " to " + result.filename);
    });
  },

  /**
   * Lets the user pick a file, checks it on the server (dry run), asks, then imports it below parentId
   * (null = top level) and refreshes the list. Resolves when done or cancelled.
   */
  async importNodes(api: ListReportExtensionAPI, parentId: string | null): Promise<void> {
    const model = api.getModel() as ODataModel;
    const file = await pickJsonFile();
    if (!file) {
      return;
    }
    const importCall = (dryRun: boolean) =>
      Actions.invokeAction<Counts & { target?: string | null }>(model, "/importNodes(...)", { content: file.text, parentId, dryRun });
    const check = await importCall(true);
    if (!(await confirmImport(file.name, check))) {
      return;
    }
    const result = await importCall(false);
    MessageToast.show("Imported " + describeCounts(result));
    await api.refresh();
  }
};
