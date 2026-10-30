import MessageToast from "sap/m/MessageToast";
import Event from "sap/ui/base/Event";
import Control from "sap/ui/core/Control";
import Context from "sap/ui/model/odata/v4/Context";
import RichTextEditor from "sap/ui/richtexteditor/RichTextEditor";
import Files from "com/aem/suite/testcases/shared/Files";
import { textsOf } from "./i18n";

/**
 * Documentation section: the description of a test case or folder. It is stored as Markdown (that is what the
 * export files hold), the rich text editor works on HTML: the server renders the Markdown (descriptionHtml) and
 * turns the HTML the editor sends back into Markdown (srv/lib/testcases/documentation.ts).
 */

/**
 * Only what Markdown can hold: no underline, fonts, colors, alignment or images. Headings, quotes and code come
 * with the styles menu, tables with the table group (both can only be added once the editor is loaded).
 */
const BUTTON_GROUPS = [
  { name: "font-style", visible: true, priority: 10, buttons: ["bold", "italic", "strikethrough"] },
  { name: "structure", visible: true, priority: 20, buttons: ["bullist", "numlist", "outdent", "indent"] },
  { name: "link", visible: true, priority: 30, buttons: ["link", "unlink"] },
  { name: "undo", visible: true, priority: 40, buttons: ["undo", "redo"] }
];

const MARK = "aemDocumentationEditor";

/** File name from a node name: ASCII letters and digits, hyphen separated (like the JSON export, srv/lib/testcases/export-import.ts). */
function fileNameOf(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "documentation"}.md`;
}

/** The file: the documentation under the name of the node as title, unless it starts with a title of its own. */
function markdownOf(name: string, documentation: string): string {
  const text = documentation.trim();
  return (/^#\s/.test(text) ? text : `# ${name}\n\n${text}`) + "\n";
}

// formatters: expression bindings on descriptionHtml do not survive the templating of Fiori elements
export default {
  hasText(text?: string | null): boolean {
    return !!text;
  },

  /** display mode with documentation */
  showsDocumentation(editable?: boolean, html?: string | null): boolean {
    return !editable && !!html;
  },

  /** display mode without documentation */
  showsEmpty(editable?: boolean, html?: string | null): boolean {
    return !editable && !html;
  },

  /** sap.ui.core.HTML needs one root element; the class gives the rendered Markdown the fonts of the theme. */
  asHtml(html?: string | null): string {
    return html ? `<div class="aemDocumentation">${html}</div>` : "";
  },

  /** Once, before the editor is loaded: setButtonGroups reinitializes it (so not in its own init events). */
  onEditorContext(event: Event): void {
    const editor = event.getSource() as RichTextEditor;
    if (!editor.data(MARK)) {
      editor.data(MARK, true);
      editor.setButtonGroups(BUTTON_GROUPS);
    }
  },

  /** Every time the editor is (re)initialized. */
  onReady(event: Event): void {
    const editor = event.getSource() as RichTextEditor;
    const has = new Set((editor.getButtonGroups() as { name: string }[]).map((g) => g.name));
    if (!has.has("styleselect")) {
      editor.addButtonGroup({ name: "styleselect", visible: true, priority: 5, buttons: ["styleselect"] });
    }
    if (!has.has("table")) {
      editor.addButtonGroup({ name: "table", visible: true, priority: 35, buttons: ["table"] });
    }
  },

  /** Saves the documentation as a Markdown file named after the test case or folder. */
  onExport(event: Event): void {
    const source = event.getSource() as Control;
    const ctx = source.getBindingContext() as Context | undefined;
    const documentation = ctx?.getProperty("description") as string | null | undefined;
    if (!ctx || !documentation) {
      return;
    }
    const name = (ctx.getProperty("name") as string | null) || (ctx.getProperty("topic") as string | null) || "";
    const filename = fileNameOf(name);
    Files.download(filename, markdownOf(name, documentation), "text/markdown");
    MessageToast.show(textsOf(source)("documentation.exported", [filename]));
  }
};
