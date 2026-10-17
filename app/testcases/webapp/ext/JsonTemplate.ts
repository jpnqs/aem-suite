/**
 * Helpers for JSON payloads containing {{template}} expressions.
 * Expressions outside of JSON strings (e.g. "qty": {{qty}}) are swapped with
 * string tokens so the payload can be parsed and pretty-printed.
 */
function protect(text: string): { text: string; tokens: string[] } {
  let out = "";
  const tokens: string[] = [];
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") {
        out += text[++i] || "";
      } else if (c === '"') {
        inString = false;
      }
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "{" && text[i + 1] === "{") {
      const end = text.indexOf("}}", i + 2);
      if (end < 0) {
        out += text.slice(i);
        break;
      }
      tokens.push(text.slice(i, end + 2));
      out += '"__AEM_TPL_' + (tokens.length - 1) + '__"';
      i = end + 1;
    } else {
      out += c;
    }
  }
  return { text: out, tokens };
}

function restore(text: string, tokens: string[]): string {
  return text.replace(/"__AEM_TPL_(\d+)__"/g, (_m, n: string) => tokens[Number(n)]);
}

export default {
  /** The error message, or null if valid (empty counts as valid). */
  validate(text: string | null | undefined): string | null {
    if (!text || !text.trim()) {
      return null;
    }
    try {
      JSON.parse(protect(text).text);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  },

  /** Pretty-prints, keeping template expressions. Throws on invalid JSON. */
  format(text: string | null | undefined, indent = 2): string {
    const p = protect(text || "");
    return restore(JSON.stringify(JSON.parse(p.text), null, indent), p.tokens);
  }
};
