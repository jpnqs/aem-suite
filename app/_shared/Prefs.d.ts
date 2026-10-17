/** Per-browser preferences in localStorage ("aem-suite.<key>", JSON) - see Prefs.js. Never throws. */
declare const Prefs: {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
};
export default Prefs;
