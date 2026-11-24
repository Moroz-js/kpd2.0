import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildCashflowWorkbook } from "../lib/services/excel-export";
import { buildCashflowRange, buildCashflowYear, type CashflowTables } from "../lib/services/cashflow";
import { projectCashflow, projectAllCashflowYears } from "../lib/snapshots/cashflow-projection.mjs";

const now = new Date("2027-02-11T09:00:00Z");
const project = { id: "p", name: "Проект", type: "client" };
function fixture(year = 2026): CashflowTables {
  const date = `${year}-12-30T09:00:00Z`;
  return {
    activeProjects: [project], openingBalances: [{ year, amount: 10_000 }], manualBalances: [], reconciliations: [], planLines: [],
    charges: [{ order: { projectId: "p" }, status: "paid", amount: 2_500, paidAt: date, paidPlanAt: null }],
    works: [{ projectId: "p", workStatus: "submitted", amount: 500, plannedPayAt: date, paidAt: null }], otherExpenses: [],
  };
}
function snapshot(t: CashflowTables) {
  return {
    Project: [{ ...project, status: "active" }], Order: [{ id: "o", projectId: "p" }],
    Charge: t.charges.map((charge) => ({ ...charge, orderId: "o" })), Work: t.works, OtherExpense: t.otherExpenses,
    SpendingPlanLine: t.planLines, CashflowManualBalance: t.manualBalances, CashflowOpeningBalance: t.openingBalances,
  };
}

describe("непрерывность кэшфлоу на границе календарных лет", () => {
  it.each([[2025, 52], [2026, 53]])("закрытие %i года (%i недель) доступно и без декабря на экране", (year, count) => {
    const t = fixture(year);
    const previous = buildCashflowYear(t, year, now);
    expect(previous.weeksInYear).toBe(count);
    expect(previous.summary.balanceEndDP.at(-1)).toBe(12_500);
    const january = { fromYear: year + 1, fromMonth: 1, toYear: year + 1, toMonth: 1 };
    for (const range of [january, { ...january, fromYear: year, fromMonth: 12 }]) {
      const result = buildCashflowRange(t, range, now);
      const i = result.weeks.findIndex((w) => w.year === year + 1 && w.week === 1);
      expect(result.openingBalances[year + 1]).toBe(12_500);
      expect(result.openingBalanceOverrides).not.toHaveProperty(String(year + 1));
      expect(result.summary.balanceStart[i]).toBe(12_500);
      expect(result.summary.balanceEndBudget[i]).toBe(12_000);
    }
    const next = projectCashflow(snapshot(t), year + 1, now);
    expect(next.balanceEndDP[0]).toBe(12_500);
    expect(next.balanceEndBudget[0]).toBe(12_000);
    expect(next.projects[0].cashflow[0]).toBe(2_500);
    expect(next.projects[0].budgetCashflow[0]).toBe(2_000);
  });

  it("не путает ручной ноль недели с отсутствием значения и не переносит его в линию смет", () => {
    const t = fixture();
    t.manualBalances.push({ year: 2026, week: 53, amount: 0 });
    const later = buildCashflowYear(t, 2029, now);
    expect(later.openingBalance).toBe(0);
    expect(later.summary.balanceEndBudget[0]).toBe(12_000);
    expect(projectCashflow(snapshot(t), 2029, now).balanceEndBudget).toEqual(later.summary.balanceEndBudget);
    t.manualBalances[0].amount = null;
    expect(buildCashflowYear(t, 2029, now).openingBalance).toBe(12_500);
  });

  it("сохраняет явное открытие в том числе ноль; удаление восстанавливает перенос", () => {
    const t = fixture();
    t.manualBalances.push({ year: 2026, week: 53, amount: 400 });
    t.openingBalances.push({ year: 2027, amount: 0 });
    const range = { fromYear: 2027, fromMonth: 5, toYear: 2027, toMonth: 5 };
    const fixed = buildCashflowRange(t, range, now);
    expect(fixed.openingBalanceOverrides[2027]).toBe(0);
    expect(fixed.summary.balanceStart[0]).toBe(0);
    expect(fixed.summary.balanceEndBudget[0]).toBe(0);
    t.openingBalances.pop();
    const automatic = buildCashflowRange(t, range, now);
    expect(automatic.summary.balanceStart[0]).toBe(400);
    expect(automatic.summary.balanceEndBudget[0]).toBe(12_000);
  });

  it("пересчитывает от первых движений без начального остатка; новые снимки используют тот же расчёт", () => {
    const t = fixture();
    t.openingBalances = [];
    t.charges[0].amount = 3_000;
    const data = buildCashflowYear(t, 2027, now);
    expect(data.openingBalance).toBe(3_000);
    const archived = projectAllCashflowYears(snapshot(t), now);
    expect(archived["2027"].balanceEndDP).toEqual(data.summary.balanceEndDP);
    expect(archived["2027"].balanceEndBudget).toEqual(data.summary.balanceEndBudget);
    expect(t.openingBalances).toEqual([]);
  });

  it("относит платёж после полуночи Москвы к январю, а не к декабрьскому переносу", () => {
    const t = fixture();
    t.charges[0].paidAt = "2026-12-31T21:01:00Z";
    const next = buildCashflowYear(t, 2027, now);
    expect(next.openingBalance).toBe(10_000);
    expect(next.summary.incomeFact[0]).toBe(2_500);
    expect(projectCashflow(snapshot(t), 2027, now).balanceEndDP).toEqual(next.summary.balanceEndDP);
  });

  it("экспортирует рассчитанное открытие числами в итог и неделю 1 годового листа", async () => {
    const workbook = await buildCashflowWorkbook([buildCashflowYear(fixture(), 2027, now)]);
    const zip = await JSZip.loadAsync(workbook);
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    for (const cell of ["B4", "C4"]) {
      expect(sheet).toMatch(new RegExp(`<c r="${cell}"[^>]*><v>12500</v></c>`));
    }
  });
});
