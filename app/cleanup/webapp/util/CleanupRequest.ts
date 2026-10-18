/**
 * The selection of the page (model "state") and the CleanupService.CleanupRequest it stands for.
 * Plain functions - the controller keeps the selection in its model, saved rules keep the request as JSON.
 */

export type AgeUnit = "DAYS" | "WEEKS" | "MONTHS" | "YEARS";

export interface AgeSelection {
  /** OLDER: older than value + unit, BEFORE: before the date */
  mode: "OLDER" | "BEFORE";
  value: number;
  unit: AgeUnit;
  /** YYYY-MM-DD */
  before: string;
}

export interface RunSelection {
  enabled: boolean;
  age: AgeSelection;
  outcomes: string[];
  startedBy: string[];
  brokerIds: string[];
  summaryContains: string;
  keepNewest: number;
}

export interface MessageSelection {
  enabled: boolean;
  age: AgeSelection;
  brokerIds: string[];
  savedBy: string[];
  sourceTypes: string[];
  topicContains: string;
}

export interface PresetSelection {
  enabled: boolean;
  age: AgeSelection;
  users: string[];
  brokerIds: string[];
  inactiveBroker: boolean;
}

export interface OrphanSelection {
  messages: boolean;
  presets: boolean;
  stats: boolean;
  variables: boolean;
}

export interface Selection {
  runs: RunSelection;
  runPayloads: RunSelection;
  messages: MessageSelection;
  presets: PresetSelection;
  orphans: OrphanSelection;
}

type Age = { value: number; unit: AgeUnit } | { before: string };

/** CleanupService.CleanupRequest - only the selected categories, without empty criteria */
export interface CleanupRequest {
  runs?: Record<string, unknown>;
  runPayloads?: Record<string, unknown>;
  messages?: Record<string, unknown>;
  presets?: Record<string, unknown>;
  orphans?: Partial<OrphanSelection>;
}

const age = (value: number, unit: AgeUnit): AgeSelection => ({ mode: "OLDER", value, unit, before: "" });

const runs = (enabled: boolean, a: AgeSelection): RunSelection => ({
  enabled,
  age: a,
  outcomes: [],
  startedBy: [],
  brokerIds: [],
  summaryContains: "",
  keepNewest: 0
});

/** The page as it opens: nothing selected, sensible ages ready for when a category is switched on. */
export function defaultSelection(): Selection {
  return {
    runs: runs(false, age(3, "MONTHS")),
    runPayloads: runs(false, age(30, "DAYS")),
    messages: { enabled: false, age: age(6, "MONTHS"), brokerIds: [], savedBy: [], sourceTypes: [], topicContains: "" },
    presets: { enabled: false, age: age(1, "YEARS"), users: [], brokerIds: [], inactiveBroker: false },
    orphans: { messages: false, presets: false, stats: false, variables: false }
  };
}

function toAge(a: AgeSelection): Age {
  return a.mode === "BEFORE" ? { before: a.before } : { value: Number(a.value), unit: a.unit };
}

/** the criteria that are filled: no empty lists, no blank texts, no zeros */
function filled(criteria: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(criteria)) {
    if (Array.isArray(v) ? v.length : typeof v === "string" ? v.trim() : v) out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

/** The request for the service; an empty object if nothing is selected. */
export function toRequest(s: Selection): CleanupRequest {
  const r: CleanupRequest = {};
  for (const key of ["runs", "runPayloads"] as const) {
    const { enabled, age: a, ...rest } = s[key];
    if (enabled) r[key] = { age: toAge(a), ...filled({ ...rest, keepNewest: Number(rest.keepNewest) || 0 }) };
  }
  if (s.messages.enabled) {
    const { enabled: _enabled, age: a, ...rest } = s.messages;
    r.messages = { age: toAge(a), ...filled(rest) };
  }
  if (s.presets.enabled) {
    const { enabled: _enabled, age: a, ...rest } = s.presets;
    r.presets = { age: toAge(a), ...filled(rest) };
  }
  const orphans = filled({ ...s.orphans }) as Partial<OrphanSelection>;
  if (Object.keys(orphans).length) r.orphans = orphans;
  return r;
}

/** True if at least one category is selected. */
export function hasSelection(s: Selection): boolean {
  return Object.keys(toRequest(s)).length > 0;
}

function fromAge(a: unknown, fallback: AgeSelection): AgeSelection {
  const x = (a ?? {}) as { value?: number; unit?: AgeUnit; before?: string };
  if (x.before) return { ...fallback, mode: "BEFORE", before: x.before };
  if (x.value && x.unit) return { mode: "OLDER", value: x.value, unit: x.unit, before: "" };
  return fallback;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** The selection of a request (a saved rule); unknown or missing parts get the defaults. */
export function fromRequest(r: CleanupRequest | null | undefined): Selection {
  const d = defaultSelection();
  const run = (x: Record<string, unknown> | undefined, def: RunSelection): RunSelection =>
    x
      ? {
          enabled: true,
          age: fromAge(x.age, def.age),
          outcomes: list(x.outcomes),
          startedBy: list(x.startedBy),
          brokerIds: list(x.brokerIds),
          summaryContains: text(x.summaryContains),
          keepNewest: Number(x.keepNewest) || 0
        }
      : def;
  const m = r?.messages;
  const p = r?.presets;
  return {
    runs: run(r?.runs, d.runs),
    runPayloads: run(r?.runPayloads, d.runPayloads),
    messages: m
      ? {
          enabled: true,
          age: fromAge(m.age, d.messages.age),
          brokerIds: list(m.brokerIds),
          savedBy: list(m.savedBy),
          sourceTypes: list(m.sourceTypes),
          topicContains: text(m.topicContains)
        }
      : d.messages,
    presets: p ? { enabled: true, age: fromAge(p.age, d.presets.age), users: list(p.users), brokerIds: list(p.brokerIds), inactiveBroker: !!p.inactiveBroker } : d.presets,
    orphans: { ...d.orphans, ...Object.fromEntries(Object.entries(r?.orphans ?? {}).map(([k, v]) => [k, !!v])) }
  };
}
