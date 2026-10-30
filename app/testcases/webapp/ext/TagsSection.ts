/** Formatters of the tags section (TagsSection.fragment.xml): expression bindings do not survive the templating of Fiori elements. */
export default {
  /** display mode without tags */
  showsNone(editable?: boolean, tags?: string | null): boolean {
    return !editable && !tags;
  },

  placeholder(editable: boolean | undefined, text: string): string {
    return editable ? text : "";
  }
};
