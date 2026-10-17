// GENERATED from app/_shared by scripts/sync-shared-ui.js - edit the original there, then run npm run sync:ui
/** Per-browser preferences in localStorage ("aem-suite.<key>", JSON) - see Prefs.js. Never throws. */
declare const Prefs: {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
};
export default Prefs;
