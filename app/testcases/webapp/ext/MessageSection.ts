import Event from "sap/ui/base/Event";
import Control from "sap/ui/core/Control";
import CodeEditor from "sap/ui/codeeditor/CodeEditor";
import Context from "sap/ui/model/odata/v4/Context";
import TemplateCompleter from "./TemplateCompleter";
import { textsOf } from "./i18n";

/**
 * Topic / name section. The topic is a one-line code editor, so it gets the suggestions of the payload editor
 * ({{ -> variables, built-ins, number ranges, faker.js; ext/TemplateCompleter.ts).
 *
 * The name follows the topic until the user enters an own name - the server applies that rule
 * (srv/test-service.ts). The topic field is a plain control in a custom section, so Fiori elements does not run
 * the side effect topic -> name for it (annotations.cds, #topicName): request it here.
 */

/** The parts of the Ace editor (CodeEditor.getAceEditor) used here */
interface AceEditor {
  commands: {
    addCommand(command: { name: string; bindKey: string; exec: () => void }): void;
    bindKeys(keys: Record<string, null>): void;
  };
  on(event: "paste", handler: (e: { text: string }) => void): void;
  setOption(name: string, value: unknown): void;
}

const MARK = "aemTopicEditor";

/** A topic is one line: Enter adds nothing, pasted line breaks are dropped, Tab moves on to the next field. */
function makeSingleLine(editor: CodeEditor): void {
  const ace = editor.getAceEditor() as AceEditor;
  // the suggestion popup handles Enter before this
  ace.commands.addCommand({ name: "aemNoNewline", bindKey: "Enter|Shift-Enter", exec: () => undefined });
  // without a command the browser moves the focus, as in an input field
  ace.commands.bindKeys({ Tab: null, "Shift-Tab": null });
  // no code editor decoration in an input field
  ace.setOption("showPrintMargin", false);
  ace.setOption("highlightActiveLine", false);
  ace.on("paste", (e) => {
    e.text = e.text.replace(/\s*[\r\n]+\s*/g, "");
  });
  // the texts of the app reach the editor with the models: set when rendered
  editor.addEventDelegate({
    onAfterRendering: () => ace.setOption("placeholder", textsOf(editor)("message.eGAcmeOrdersRegionCreated"))
  });
}

export default {
  /** The editor got its test case: one line, with suggestions. */
  onTopicContext(event: Event): void {
    const editor = event.getSource() as CodeEditor;
    if (!editor.data(MARK)) {
      editor.data(MARK, true);
      makeSingleLine(editor);
    }
    TemplateCompleter.attach(editor);
  },

  onTopicChange(event: Event): void {
    const ctx = (event.getSource() as Control).getBindingContext() as Context | undefined;
    if (ctx) {
      ctx.requestSideEffects(["name"]).catch(() => {
        // the PATCH failed - Fiori elements shows that message
      });
    }
  }
};
