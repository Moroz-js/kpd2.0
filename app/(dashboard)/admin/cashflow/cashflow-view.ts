import {
  defaultCashflowRange,
  formatMonthKey,
  MAX_CASHFLOW_RANGE_MONTHS,
  parseCashflowRange,
  rangeMonths,
  rangeToQuery,
  type CashflowRange,
} from "@/lib/cashflow-range";

export const ALL_PROJECTS = "_all";
const INVALID_SOURCE = "!invalid";
const KEYS = {
  from: "from", to: "to", activeTab: "tab", showOldWeeks: "oldWeeks", projectId: "project",
  mode: "cfMode", sourceA: "cfSourceA", sourceB: "cfSourceB",
  showDP: "cfDP", showBudget: "cfBudget", showFromStart: "cfFromStart",
} as const;

type Params = Pick<URLSearchParams, "has" | "get">;
export type CashflowView = {
  range: CashflowRange;
  activeTab: "table" | "chart";
  showOldWeeks: boolean;
  projectId: string;
  mode: "single" | "compare";
  sourceA: string;
  sourceB: string;
  showDP: boolean;
  showBudget: boolean;
  showFromStart: boolean;
};

export function defaultCashflowView(now = new Date()): CashflowView {
  return {
    range: defaultCashflowRange(now), activeTab: "table", showOldWeeks: false,
    projectId: ALL_PROJECTS, mode: "single", sourceA: "live", sourceB: "live",
    showDP: true, showBudget: true, showFromStart: false,
  };
}

export function hasCashflowParams(params: Params) {
  return Object.values(KEYS).some((key) => params.has(key));
}

export function isCashflowId(value: string | null): value is string {
  return value !== null && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function readSource(value: string | null) {
  // Missing means live. An explicitly malformed snapshot must never select live.
  return value === null ? "live" : isCashflowId(value) ? value : INVALID_SOURCE;
}

function readFlag(value: string | null, fallback: boolean) {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return fallback;
}

function readRange(from: string | null, to: string | null, now: Date) {
  const range = parseCashflowRange(from, to, now);
  return rangeMonths(range) <= MAX_CASHFLOW_RANGE_MONTHS ? range : defaultCashflowRange(now);
}

// Only these three fields were persisted before cashflow had shareable views.
export function localCashflowFields({ range, activeTab, showOldWeeks }: CashflowView) {
  return { range, activeTab, showOldWeeks };
}

export function readCashflowView(params: Params, stored?: unknown, now = new Date()): CashflowView {
  const defaults = defaultCashflowView(now);
  if (!hasCashflowParams(params)) {
    if (!stored || typeof stored !== "object") return defaults;
    const saved = stored as Partial<Record<keyof ReturnType<typeof localCashflowFields>, unknown>>;
    const range = saved.range as Partial<CashflowRange> | null;
    const monthKey = (year?: number, month?: number) =>
      typeof year === "number" && Number.isInteger(year) && typeof month === "number" && Number.isInteger(month)
        ? formatMonthKey(year, month) : null;
    return {
      ...defaults,
      range: readRange(monthKey(range?.fromYear, range?.fromMonth), monthKey(range?.toYear, range?.toMonth), now),
      activeTab: saved.activeTab === "chart" ? "chart" : "table",
      showOldWeeks: saved.showOldWeeks === true,
    };
  }
  const project = params.get(KEYS.projectId);
  return {
    range: readRange(params.get(KEYS.from), params.get(KEYS.to), now),
    activeTab: params.get(KEYS.activeTab) === "chart" ? "chart" : "table",
    showOldWeeks: readFlag(params.get(KEYS.showOldWeeks), defaults.showOldWeeks),
    projectId: isCashflowId(project) ? project : ALL_PROJECTS,
    mode: params.get(KEYS.mode) === "compare" ? "compare" : "single",
    sourceA: readSource(params.get(KEYS.sourceA)), sourceB: readSource(params.get(KEYS.sourceB)),
    showDP: readFlag(params.get(KEYS.showDP), defaults.showDP),
    showBudget: readFlag(params.get(KEYS.showBudget), defaults.showBudget),
    showFromStart: readFlag(params.get(KEYS.showFromStart), defaults.showFromStart),
  };
}

/** Pin both months (even across New Year); omit constant defaults, not explicit false series. */
export function cashflowHref(current: URL, view: CashflowView) {
  const params = new URLSearchParams(current.search);
  for (const key of Object.values(KEYS)) params.delete(key);
  params.set(KEYS.from, formatMonthKey(view.range.fromYear, view.range.fromMonth));
  params.set(KEYS.to, formatMonthKey(view.range.toYear, view.range.toMonth));
  if (view.activeTab !== "table") params.set(KEYS.activeTab, view.activeTab);
  if (view.showOldWeeks) params.set(KEYS.showOldWeeks, "1");
  if (view.projectId !== ALL_PROJECTS) params.set(KEYS.projectId, view.projectId);
  if (view.mode !== "single") params.set(KEYS.mode, view.mode);
  if (view.sourceA !== "live") params.set(KEYS.sourceA, view.sourceA);
  if (view.sourceB !== "live") params.set(KEYS.sourceB, view.sourceB);
  if (!view.showDP) params.set(KEYS.showDP, "0");
  if (!view.showBudget) params.set(KEYS.showBudget, "0");
  if (view.showFromStart) params.set(KEYS.showFromStart, "1");
  return `${current.pathname}?${params}${current.hash}`;
}

export function cashflowChartRequest(view: CashflowView, panelSource: string | null, snapshots?: readonly { id: string }[]) {
  const sourceA = panelSource ?? view.sourceA;
  const sourceB = panelSource === null && view.mode === "compare" ? view.sourceB : null;
  let error: string | null = null;
  let waiting = false;
  for (const [side, id] of [["A", sourceA], ["B", sourceB]] as const) {
    if (id === null || id === "live") continue;
    if (!isCashflowId(id) || (snapshots && !snapshots.some((s) => s.id === id))) {
      error = `Снимок ${side} недоступен. Выберите другой источник.`;
      break;
    }
    if (!snapshots) waiting = true;
  }
  if (!error && sourceA === sourceB) error = "Для сравнения выберите разные даты";
  const params = new URLSearchParams(rangeToQuery(view.range));
  params.set("sourceA", sourceA);
  if (sourceB !== null) params.set("sourceB", sourceB);
  return { sourceA, sourceB, error, url: error || waiting ? null : `/api/cashflow/chart?${params}` };
}
