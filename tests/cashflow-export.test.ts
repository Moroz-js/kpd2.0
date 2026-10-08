import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildCashflowWorkbook } from "../lib/services/excel-export";
import {
  buildCashflowYear,
  listCashflowExportYears,
  type CashflowTables,
  type CashflowYearData,
} from "../lib/services/cashflow";

function emptyTables(overrides: Partial<CashflowTables> = {}): CashflowTables {
  return {
    charges: [],
    works: [],
    otherExpenses: [],
    planLines: [],
    openingBalances: [],
    manualBalances: [],
    activeProjects: [],
    reconciliations: [],
    ...overrides,
  };
}

function zeros(length: number) {
  return Array.from({ length }, () => 0);
}

function fakeYear(year: number, weeks = 4): CashflowYearData {
  const empty = zeros(weeks);
  return {
    year,
    weeksInYear: weeks,
    weeks: Array.from({ length: weeks }, (_, index) => ({
      week: index + 1,
      month: 1,
      monthName: "янв.",
    })),
    openingBalance: 1000,
    summary: {
      balanceStart: empty,
      incomeFact: empty,
      incomePlanOnly: empty,
      incomePlanFact: empty,
      expensePlanDP: empty,
      balanceEndDP: [1200, -300, 800, 0],
      manualBalance: Array.from({ length: weeks }, () => null),
      paidFromBudget: empty,
      unpaidFromBudget: empty,
      totalExpenseBudget: empty,
      deltaDP: empty,
      balanceEndBudget: empty,
    },
    projects: [],
    externalProjects: [],
    internalProjects: [],
    aggregates: {
      projectExpenses: empty,
      nonProjectExpenses: empty,
      taxes: empty,
      motivation: empty,
    },
    balanceInAccounts: Array.from({ length: weeks }, () => null),
    discrepancy: Array.from({ length: weeks }, () => null),
    discrepancyDPFact: empty,
    currentWeek: 2,
    currentWeekYear: year,
  };
}

describe("listCashflowExportYears", () => {
  it("берёт текущий и прошлые годы, без будущих", () => {
    const years = listCashflowExportYears(
      emptyTables({
        openingBalances: [{ year: 2020, amount: 1 }],
        planLines: [{ year: 2022, projectId: "p", week: 1, amount: 10 }],
      }),
      new Date("2026-03-10")
    );
    expect(years).toContain(2026);
    expect(years).toContain(2024);
    expect(years).not.toContain(2027);
    expect(years).toContain(2020);
    expect(years).toContain(2022);
    expect(years[0]).toBeGreaterThan(years[years.length - 1]);
  });
});

describe("buildCashflowYear", () => {
  it("кладёт оплаченные начисления и работы в нужную неделю", () => {
    const data = buildCashflowYear(
      emptyTables({
        charges: [
          {
            amount: 100,
            status: "paid",
            paidAt: new Date(2026, 0, 7),
            paidPlanAt: null,
            order: { projectId: "p1" },
          },
        ],
        works: [
          {
            projectId: "p1",
            amount: 40,
            workStatus: "paid",
            plannedPayAt: null,
            paidAt: new Date(2026, 0, 7),
          },
        ],
        openingBalances: [{ year: 2026, amount: 1000 }],
        activeProjects: [{ id: "p1", name: "Проект", type: "client" }],
      }),
      2026,
      new Date(2026, 5, 1)
    );
    expect(data.openingBalance).toBe(1000);
    expect(data.summary.incomeFact.reduce((a, b) => a + b, 0)).toBe(100);
    expect(data.summary.paidFromBudget.reduce((a, b) => a + b, 0)).toBe(40);
    expect(data.externalProjects).toHaveLength(1);
  });
});

describe("buildCashflowWorkbook", () => {
  it("пишет лист года числами без формул", async () => {
    const buffer = await buildCashflowWorkbook([fakeYear(2026)]);
    const zip = await JSZip.loadAsync(buffer);
    const workbook = await zip.file("xl/workbook.xml")!.async("string");
    expect(workbook).toContain('name="2026"');
    expect(workbook).not.toContain('name="График 2026"');

    const shared = await zip.file("xl/sharedStrings.xml")!.async("string");
    expect(shared).toContain("Баланс (сметы/ДП)");

    const yearSheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(yearSheet).not.toContain("<drawing ");
    expect(yearSheet).not.toContain("SUMIFS");
    expect(yearSheet).toContain("<v>1200</v>");
  });
});
