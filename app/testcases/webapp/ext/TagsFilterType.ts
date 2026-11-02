import SimpleType from "sap/ui/model/SimpleType";

/**
 * Type of the tags filter (TagsFilter.fragment.xml): the tags of the field <-> the values of the filter field,
 * "*#smoke#*" = contains #smoke# on TestCases.tagKey ("#eu#smoke#") - whole tags, "eu" does not find "europe".
 * sap.fe.macros.filter.type.MultiValue does not parse a list with the operator Contains.
 *
 * @namespace com.aem.suite.testcases.ext
 */
export default class TagsFilterType extends SimpleType {
  formatValue(value: unknown): string[] {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return values.map((v) => String(v).replace(/^\*?#?|#?\*?$/g, ""));
  }

  parseValue(value: unknown): string[] {
    return (Array.isArray(value) ? value : []).map((tag) => `*#${String(tag)}#*`);
  }

  validateValue(): void {
    // the field only makes valid tags
  }
}
