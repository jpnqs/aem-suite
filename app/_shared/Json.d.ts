/** Formatting of JSON for read-only code editors - see Json.js. */
declare const Json: {
  pretty(text?: string | null): string;
  editorType(text?: string | null): "json" | "text";
};
export default Json;
