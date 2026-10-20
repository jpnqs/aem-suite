import CodeEditor from "sap/ui/codeeditor/CodeEditor";
import Context from "sap/ui/model/odata/v4/Context";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import Actions from "com/aem/suite/testcases/shared/Actions";
import { textsOf, Texts } from "./i18n";

/**
 * Suggestions for template expressions in the topic and payload editors: typing {{ (or {{te...) opens the suggestion
 * popup with the variables of the test case (where each comes from and its value), the built-ins, the number ranges,
 * temporary variables defined in the payload ({{... as name}}) and the faker.js expressions. Choosing one inserts
 * it with the closing }}.
 *
 * The data comes from the action templateHints of the test case (srv/lib/runs/template-hints.ts) - for a draft
 * with the variables being edited - and is kept for a few seconds while typing.
 */

interface Hint {
  expression: string;
  kind: "VARIABLE" | "NUMBER_RANGE" | "FAKER";
  source: string;
  value?: string | null;
  details?: string | null;
}

/** An entry of the Ace suggestion popup */
interface Completion {
  caption: string;
  value: string;
  meta: string;
  score: number;
  docText?: string;
}

interface Position {
  row: number;
  column: number;
}

interface AceSession {
  getLine(row: number): string;
  getValue(): string;
}

/** The parts of the Ace editor (CodeEditor.getAceEditor) this module uses */
interface AceEditor {
  completers: unknown[];
}

/** The built-ins with the texts of the help popover that explain them (PayloadSection.ts) */
const BUILT_INS: [expression: string, text: string][] = [
  ["uuid", "payload.help.2"],
  ["newUuid", "payload.help.3"],
  ["now", "payload.help.4"],
  ["timestamp", "payload.help.5"],
  ["date", "payload.help.6"],
  ["randomInt(1,100)", "payload.help.7"],
  ["broker.name", "payload.help.12"],
  ["broker.msgVpn", "payload.help.13"],
  ["broker.id", "payload.help.14"]
];

/** Order in the popup: what the test case defines first, the long faker list last */
const SCORE = { VARIABLE: 1000, TEMPORARY: 950, NUMBER_RANGE: 900, BUILT_IN: 800, FAKER: 100 };

/** Hints are loaded again after this long - variables may have been added meanwhile */
const CACHE_MS = 5000;

/** {{ and what was typed of the expression so far, right before the cursor */
const OPEN = /\{\{\s*([\w.]*)$/;
/** temporary variables of the payload: {{numberRange.ORDERS as orderNo}} */
const ALIAS = /\{\{[^{}]*?\sas\s+([A-Za-z_]\w*)\s*\}\}/g;
const MARK = "aemTemplateCompleter";

let cache: { path: string; at: number; hints: Promise<Hint[]> } | undefined;

function loadHints(editor: CodeEditor): Promise<Hint[]> {
  const context = editor.getBindingContext() as Context | null | undefined;
  if (!context) {
    return Promise.resolve([]);
  }
  const path = context.getPath();
  if (!cache || cache.path !== path || Date.now() - cache.at > CACHE_MS) {
    const hints = Actions.invokeAction<{ value?: Hint[] }>(editor.getModel() as ODataModel, "TestService.templateHints(...)", {}, context)
      .then((result) => result.value || [])
      // without the hints, the built-ins are still offered
      .catch(() => [] as Hint[]);
    cache = { path, at: Date.now(), hints };
  }
  return cache.hints;
}

/** "value" or "value - details" for the tooltip of an entry */
function docOf(...parts: (string | null | undefined)[]): string | undefined {
  const text = parts.filter((p) => p).join("\n\n");
  return text || undefined;
}

function completions(hints: Hint[], document: string, closing: string, t: Texts): Completion[] {
  const entry = (expression: string, meta: string, score: number, docText?: string): Completion => ({
    caption: expression,
    value: expression + closing,
    meta,
    score,
    docText
  });
  const list = hints.map((h) =>
    entry(h.expression, h.source, SCORE[h.kind], h.kind === "VARIABLE" ? docOf(h.details) : docOf(h.value && t("completion.example", [h.value]), h.details))
  );
  const aliases = new Set([...document.matchAll(ALIAS)].map((m) => m[1]));
  for (const alias of aliases) {
    list.push(entry(alias, t("completion.temporary"), SCORE.TEMPORARY, t("completion.temporaryDoc")));
  }
  for (const [expression, text] of BUILT_INS) {
    list.push(entry(expression, t("completion.builtIn"), SCORE.BUILT_IN, t(text)));
  }
  return list;
}

export default {
  /** Gives a code editor (topic, payload) the suggestions (once per editor). */
  attach(editor: CodeEditor): void {
    if (editor.data(MARK)) {
      return;
    }
    editor.data(MARK, true);
    // Enter belongs to the editor (a new line, or taking a suggestion). The Fiori elements object page has an Enter
    // shortcut of its own; it ends the key event with preventDefault, so the editor never got its new line. A UI5 event
    // that is marked is left alone by that shortcut (as with the text areas of the page).
    editor.addEventDelegate({
      onkeydown: (event: { key?: string; setMarked(): void }) => {
        if (event.key === "Enter") {
          event.setMarked();
        }
      }
    });
    const completer = {
      // the expression typed so far, dots included: faker.person.fu
      identifierRegexps: [/[\w.]/],
      // {{ opens the popup before anything else is typed
      triggerCharacters: ["{"],
      getCompletions(_ace: unknown, session: AceSession, pos: Position, _prefix: string, callback: (error: null, list: Completion[]) => void): void {
        const line = session.getLine(pos.row);
        const before = line.slice(0, pos.column);
        if (!OPEN.test(before)) {
          callback(null, []);
          return;
        }
        const closing = line.slice(pos.column).trimStart().startsWith("}}") ? "" : "}}";
        // the texts only now: when the editor gets its context, the i18n model may not have reached it yet
        void loadHints(editor).then((hints) => callback(null, completions(hints, session.getValue(), closing, textsOf(editor))));
      }
    };
    // only these suggestions: the editor's own ones (words of the text, JavaScript snippets) do not help in a payload
    (editor.getAceEditor() as AceEditor).completers = [completer];
  }
};
