import MultiInput from "sap/m/MultiInput";
import type { MultiInput$TokenUpdateEvent } from "sap/m/MultiInput";
import SelectDialog from "sap/m/SelectDialog";
import type { SelectDialog$SearchEvent } from "sap/m/SelectDialog";
import StandardListItem from "sap/m/StandardListItem";
import Token from "sap/m/Token";
import type { MetadataOptions } from "sap/ui/core/Element";
import ListItem from "sap/ui/core/ListItem";
import { ValueState } from "sap/ui/core/library";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import type ListBinding from "sap/ui/model/ListBinding";
import JSONModel from "sap/ui/model/json/JSONModel";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";

/**
 * Tags as pills: a MultiInput bound to the tags text ("regression, smoke") instead of tokens. Typing a word and
 * Enter, a comma or a blank makes it a pill; the x or backspace removes one. Each tag keeps its color (one of the
 * theme's indication colors, css/style.css). Read only (editable=false) it just shows the pills - table and display.
 * The rules are the server's (srv/lib/testcases/tags.ts).
 *
 * Value help: the tags in use (TestService.knownTags) are suggested while typing, and the value help icon opens a
 * list of them to tick.
 */

const TAG = /^[a-z0-9][a-z0-9._-]*$/;
const SEPARATOR = /[,;\s]/;
const COLORS = 8;

/** "Smoke,  regression smoke" -> ["regression", "smoke"] */
export function tagsOf(text: string | null | undefined): string[] {
  return [
    ...new Set(
      (text ?? "")
        .split(/[,;\s]+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    )
  ].sort();
}

/** The stored form: "regression, smoke"; "" without tags (the binding makes that null). */
export const joinTags = (tags: string[]): string => [...new Set(tags)].sort().join(", ");

export const isValidTag = (tag: string): boolean => TAG.test(tag) && tag.length <= 50;

interface TagCount {
  tag: string;
  count: number;
}

/** The tags in use, per model; asked again after a while (others add tags too). */
const known = new WeakMap<object, { at: number; tags: Promise<TagCount[]> }>();
const KNOWN_FOR_MS = 30_000;

function knownTags(model: ODataModel): Promise<TagCount[]> {
  const cached = known.get(model);
  if (cached && Date.now() - cached.at < KNOWN_FOR_MS) {
    return cached.tags;
  }
  const binding = model.bindContext("/knownTags()");
  const tags = (binding.requestObject("value") as Promise<TagCount[]>)
    .catch(() => [] as TagCount[])
    .finally(() => binding.destroy());
  known.set(model, { at: Date.now(), tags });
  return tags;
}

/** The same color for the same tag, everywhere: 1..COLORS */
export function colorOf(tag: string): number {
  let hash = 0;
  for (const c of tag) {
    hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  }
  return (hash % COLORS) + 1;
}

/**
 * @namespace com.aem.suite.testcases.ext
 */
export default class TagsInput extends MultiInput {
  static readonly metadata: MetadataOptions = {
    properties: {
      /** the tags as text, two-way bound */
      tags: { type: "string", defaultValue: "" },
      /** the message when a typed word is no tag */
      invalidText: { type: "string", defaultValue: "" }
    }
  };

  // the inherited one (sap.m.MultiInputRenderer has no type declarations)
  static renderer = "sap.m.MultiInputRenderer";

  declare getTags: () => string;
  declare getInvalidText: () => string;

  private dialog?: SelectDialog;

  init(): void {
    super.init();
    this.addStyleClass("aemTags");
    this.setShowSuggestion(true);
    this.setStartSuggestion(0);
    this.setMaxSuggestionWidth("20rem");
    // a picked suggestion becomes a pill here (with its color), not by the MultiInput
    this.addValidator(() => undefined as unknown as Token);
    this.attachSuggestionItemSelected((event) => {
      const item = event.getParameter("selectedItem") as ListItem | null;
      if (item) {
        this.store([...this.currentTags(), item.getKey()]);
        this.setValue("");
        this.setValueState(ValueState.None);
      }
    });
    this.attachSuggest(() => void this.loadSuggestions());
    this.attachValueHelpRequest(() => void this.openValueHelp());
    this.attachLiveChange(() => {
      // a separator typed or pasted: the words before it become pills
      if (SEPARATOR.test(this.getValue())) {
        this.commit(true);
      } else if (tagsOf(this.getValue()).every(isValidTag)) {
        this.setValueState(ValueState.None);
      }
    });
    this.attachSubmit(() => this.commit(false));
    this.attachChange(() => this.commit(false));
    this.attachTokenUpdate((event: MultiInput$TokenUpdateEvent) => {
      const removed = new Set((event.getParameter("removedTokens") ?? []).map((t) => t.getKey()));
      this.store(this.currentTags().filter((t) => !removed.has(t)));
    });
  }

  exit(): void {
    this.dialog?.destroy();
    super.exit?.();
  }

  /** the value help icon only where tags are typed */
  setEditable(editable: boolean): this {
    super.setEditable(editable);
    this.setShowValueHelp(editable);
    return this;
  }

  setTags(value: string | null): this {
    this.setProperty("tags", value ?? "", true);
    this.showTags(tagsOf(value));
    return this;
  }

  private currentTags(): string[] {
    return this.getTokens().map((t) => t.getKey());
  }

  private text(key: string): string {
    const bundle = (this.getModel("i18n") as ResourceModel | undefined)?.getResourceBundle() as ResourceBundle | undefined;
    return bundle?.getText(key) ?? key;
  }

  private known(): Promise<TagCount[]> {
    const model = this.getModel() as ODataModel | undefined;
    return model?.isA("sap.ui.model.odata.v4.ODataModel") ? knownTags(model) : Promise.resolve([]);
  }

  /** The tags in use as suggestions, without the ones already there; the typed text filters them. */
  private async loadSuggestions(): Promise<void> {
    const current = new Set(this.currentTags());
    const tags = (await this.known()).filter((t) => !current.has(t.tag));
    if (tags.map((t) => t.tag).join() !== this.getSuggestionItems().map((i) => i.getKey()).join()) {
      this.destroySuggestionItems();
      for (const t of tags) {
        this.addSuggestionItem(new ListItem({ key: t.tag, text: t.tag, additionalText: String(t.count) }));
      }
    }
    this.setFilterFunction((term, item) => !!item?.getText().includes((term ?? "").trim().toLowerCase()));
  }

  /** All tags in use (and the ones of this field) to tick; the ticked ones are the new tags. */
  private async openValueHelp(): Promise<void> {
    const current = this.currentTags();
    const tags = await this.known();
    const counts = new Map(tags.map((t) => [t.tag, t.count]));
    const rows = [...new Set([...tags.map((t) => t.tag), ...current])].map((tag) => ({
      tag,
      count: counts.get(tag) ?? 0,
      selected: current.includes(tag)
    }));
    if (!this.dialog) {
      this.dialog = new SelectDialog({
        title: this.text("tags.valueHelpTitle"),
        noDataText: this.text("tags.valueHelpNone"),
        multiSelect: true,
        rememberSelections: false,
        items: {
          path: "tags>/rows",
          template: new StandardListItem({ title: "{tags>tag}", info: "{tags>count}", selected: "{tags>selected}" })
        },
        search: (event: SelectDialog$SearchEvent) => {
          const value = (event.getParameter("value") ?? "").trim().toLowerCase();
          this.filterDialog(value ? [new Filter("tag", FilterOperator.Contains, value)] : []);
        },
        // the ticks are in the model (two-way): also the ones a search hides
        confirm: () => {
          const rows = (this.dialog!.getModel("tags") as JSONModel).getProperty("/rows") as { tag: string; selected: boolean }[];
          this.store(rows.filter((r) => r.selected).map((r) => r.tag));
          this.setValueState(ValueState.None);
        }
      });
      this.addDependent(this.dialog);
    }
    this.dialog.setModel(new JSONModel({ rows }), "tags");
    this.filterDialog([]);
    this.dialog.open("");
  }

  private filterDialog(filters: Filter[]): void {
    (this.dialog?.getBinding("items") as ListBinding | undefined)?.filter(filters);
  }

  /** Typed words to pills. `keepLast`: the text after the last separator is still being typed. */
  private commit(keepLast: boolean): void {
    const text = this.getValue();
    const cut = keepLast ? Math.max(...[",", ";", " ", "\t", "\n"].map((s) => text.lastIndexOf(s))) + 1 : text.length;
    const words = tagsOf(text.slice(0, cut));
    if (!words.length && !keepLast) {
      this.setValueState(ValueState.None);
      return;
    }
    const invalid = words.filter((w) => !isValidTag(w));
    const valid = words.filter(isValidTag);
    if (valid.length) {
      this.store([...this.currentTags(), ...valid]);
      // typing again suggests again
      this.closeSuggestions();
    }
    // the words that are no tags stay to be corrected
    this.setValue([...invalid, text.slice(cut)].filter(Boolean).join(" "));
    this.setValueState(invalid.length ? ValueState.Error : ValueState.None);
    this.setValueStateText(invalid.length ? this.getInvalidText() : "");
  }

  /** New tags: shown and written to the model (the property binding is two-way). */
  private store(tags: string[]): void {
    const text = joinTags(tags);
    this.showTags(tagsOf(text));
    this.setProperty("tags", text);
  }

  private showTags(tags: string[]): void {
    if (tags.join() === this.currentTags().join()) {
      return;
    }
    this.destroyTokens();
    for (const tag of tags) {
      this.addToken(new Token({ key: tag, text: tag }).addStyleClass(`aemTag aemTag${colorOf(tag)}`));
    }
  }
}
