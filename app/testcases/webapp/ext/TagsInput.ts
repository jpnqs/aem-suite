import MultiInput from "sap/m/MultiInput";
import type { MultiInput$TokenUpdateEvent } from "sap/m/MultiInput";
import Token from "sap/m/Token";
import type { MetadataOptions } from "sap/ui/core/Element";
import { ValueState } from "sap/ui/core/library";

/**
 * Tags as pills: a MultiInput bound to the tags text ("regression, smoke") instead of tokens. Typing a word and
 * Enter, a comma or a blank makes it a pill; the x or backspace removes one. Each tag keeps its color (one of the
 * theme's indication colors, css/style.css). Read only (editable=false) it just shows the pills - table and display.
 * The rules are the server's (srv/lib/testcases/tags.ts).
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

  init(): void {
    super.init();
    this.setShowValueHelp(false);
    this.addStyleClass("aemTags");
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

  setTags(value: string | null): this {
    this.setProperty("tags", value ?? "", true);
    this.showTags(tagsOf(value));
    return this;
  }

  private currentTags(): string[] {
    return this.getTokens().map((t) => t.getKey());
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
