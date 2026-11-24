import { describe, expect, it } from "vitest";
import {
  ALL_PROJECTS, cashflowChartRequest, cashflowHref, defaultCashflowView, hasCashflowParams, readCashflowView,
  type CashflowView,
} from "@/app/(dashboard)/admin/cashflow/cashflow-view";

const now = new Date(2026, 5, 1);
const defaults = defaultCashflowView(now);
const custom = { fromYear: 2024, fromMonth: 9, toYear: 2026, toMonth: 3 };
const local = { range: custom, activeTab: "chart", showOldWeeks: true };
const base = new URL("https://example.test/admin/cashflow");
const read = (query: string) => readCashflowView(new URLSearchParams(query), local, now);

it("round-trips the complete view without altering global comparison, repeated foreign keys or hash", () => {
  const original = new URL("?compare=1&snapshotA=s1&snapshotB=s2&comparePanel=B&source=s2&snapshot=s2&onlyChanges=1&syncScroll=0&tag=one&tag=two&tab=table&tab=old#week-1", base);
  const view: CashflowView = {
    range: custom, activeTab: "chart", showOldWeeks: true, projectId: "prj-1", mode: "compare",
    sourceA: "snap_A", sourceB: "snap_B", showDP: false, showBudget: false, showFromStart: true,
  };
  const link = new URL(cashflowHref(original, view), base);
  expect(link.pathname + link.hash).toBe("/admin/cashflow#week-1");
  expect(link.searchParams.getAll("tab")).toEqual(["chart"]);
  for (const key of ["compare", "snapshotA", "snapshotB", "comparePanel", "source", "snapshot", "onlyChanges", "syncScroll", "tag"]) {
    expect(link.searchParams.getAll(key)).toEqual(original.searchParams.getAll(key));
  }
  expect(link.searchParams.get("from")).toBe("2024-09");
  expect(link.searchParams.get("to")).toBe("2026-03");
  expect(read(link.search)).toEqual(view);
  expect(cashflowHref(link, read(link.search))).toBe(link.pathname + link.search + link.hash);
});

it("a reset pins the two calendar months but omits every constant default, even if local differs next year", () => {
  const url = new URL(cashflowHref(new URL("?tab=chart&cfBudget=0&cfSourceA=missing", base), defaults), base);
  expect(url.search).toBe("?from=2025-12&to=2026-12");
  expect(readCashflowView(url.searchParams, local, new Date(2027, 0, 1))).toEqual(defaults);
});

it("only an unconfigured URL restores the legacy per-user fields, not chart state", () => {
  const foreign = new URLSearchParams("compare=1&comparePanel=A&snapshotA=global&source=global&mode=compare");
  expect(hasCashflowParams(foreign)).toBe(false);
  expect(readCashflowView(foreign, { ...local, sourceA: "other", showDP: false }, now)).toEqual({ ...defaults, ...local });
  expect(read("cfBudget=0")).toEqual({ ...defaults, showBudget: false });
  expect(read("cfBudget=")).toEqual(defaults);
  expect(read("tab=")).toEqual(defaults);
});

it("validates stale or corrupted storage independently of URL validation", () => {
  const bare = new URLSearchParams();
  for (const range of [null, { ...custom, fromMonth: "9" }, { ...custom, toYear: 2100 }]) {
    expect(readCashflowView(bare, { range, activeTab: [], showOldWeeks: "1" }, now)).toEqual(defaults);
  }
});

it.each([
  "from=2026-01", "to=2026-08", "from=2026-6&to=2026-07", "from=2026-01&to=2026-13",
  "from=2027-01&to=2026-12", "from=2020-01&to=2025-01", "from=1999-12&to=2000-01", "from=2200-12&to=2201-01",
])("rejects a partial, malformed, reversed or oversized range: %s", (query) => {
  expect(read(`${query}&tab=chart`)).toEqual({ ...defaults, activeTab: "chart" });
});

it("accepts the inclusive 60-month limit and validates flags, tab, mode and project", () => {
  expect(read("from=2020-01&to=2024-12").range).toEqual({ fromYear: 2020, fromMonth: 1, toYear: 2024, toMonth: 12 });
  expect(read("tab=bad&project=a%2Fb&cfMode=no&oldWeeks=yes&cfBudget=on&cfDP=no")).toEqual(defaults);
  expect(read(`project=${"x".repeat(129)}`).projectId).toBe(ALL_PROJECTS);
});

it.each([[false, false], [false, true], [true, false], [true, true]])("DP=%s / budget=%s survive Back and refresh independently", (showDP, showBudget) => {
  const a = { ...defaults, activeTab: "chart" as const, projectId: "snapshot-only", sourceA: "old", sourceB: "older", showDP, showBudget };
  const first = new URL(cashflowHref(base, a), base);
  const second = new URL(cashflowHref(first, { ...a, mode: "compare", showFromStart: true }), base);
  // Each history entry stands alone, including the dormant B selection in single mode.
  expect(read(second.search)).toEqual({ ...a, mode: "compare", showFromStart: true });
  expect(read(first.search)).toEqual(a);
  expect(first.searchParams.get("cfDP")).toBe(showDP ? null : "0");
  expect(first.searchParams.get("cfBudget")).toBe(showBudget ? null : "0");
});

describe("chart request", () => {
  const snapshots = [{ id: "old" }, { id: "older" }];
  const view = read("cfMode=compare&cfSourceA=old&cfSourceB=older&project=snapshot-only");
  it("waits for snapshot options, never requests live in their place or drops a pending project", () => {
    expect(cashflowChartRequest(view, null)).toMatchObject({ sourceA: "old", sourceB: "older", url: null, error: null });
    const request = cashflowChartRequest(view, null, snapshots);
    expect(request.url).toBe("/api/cashflow/chart?from=2025-12&to=2026-12&sourceA=old&sourceB=older");
    expect(view.projectId).toBe("snapshot-only");
  });
  it("global panels use only their own source; single mode does not require an available B", () => {
    expect(cashflowChartRequest(view, "live").url).toMatch(/&sourceA=live$/);
    expect(cashflowChartRequest(view, "older", snapshots).url).toMatch(/&sourceA=older$/);
    expect(cashflowChartRequest({ ...view, mode: "single", sourceB: "gone" }, null, snapshots).url).toMatch(/&sourceA=old$/);
  });
  it.each([
    ["cfSourceA=deleted", "A"], ["cfSourceA=..%2Fother", "A"], ["cfSourceA=", "A"],
    ["cfMode=compare&cfSourceB=deleted", "B"], ["cfMode=compare&cfSourceB=%20", "B"],
  ])("reports unavailable snapshots without falling back to live: %s", (query, side) => {
    expect(cashflowChartRequest(read(query), null, snapshots)).toMatchObject({ url: null, error: expect.stringContaining(`Снимок ${side} недоступен`) });
  });
  it("does not silently select a different source for a linked duplicate pair", () => {
    const same = { ...view, sourceB: view.sourceA };
    expect(cashflowChartRequest(same, null, snapshots)).toMatchObject({ url: null, error: expect.stringContaining("разные даты") });
  });
});
