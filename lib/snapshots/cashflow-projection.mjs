import { buildCashflowLedgers } from "../cashflow-ledger.mjs";

export const CASHFLOW_FORMULA_VERSION = "cashflow-v3";
const monthName = new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" });

function projectionWeeks(year, count) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86400000;
  return Array.from({ length: count }, (_, i) => {
    const monday = new Date(firstMonday + i * 7 * 86400000);
    return { week: i + 1, month: monday.getUTCMonth() + 1, monthName: monthName.format(monday) };
  });
}

/** Adapt raw snapshot tables to exactly the same inputs as the live ledger. */
function ledgerTables(tables) {
  const orders = new Map((tables.Order ?? []).map((order) => [order.id, order]));
  return {
    activeProjects: (tables.Project ?? []).filter((project) => project.status === "active"),
    charges: (tables.Charge ?? []).map((charge) => ({ ...charge, order: orders.get(charge.orderId) ?? null })),
    works: tables.Work ?? [], otherExpenses: tables.OtherExpense ?? [], planLines: tables.SpendingPlanLine ?? [],
    openingBalances: tables.CashflowOpeningBalance ?? [], manualBalances: tables.CashflowManualBalance ?? [],
    reconciliations: [],
  };
}

/** @param {Record<string, object[]>} tables @param {number[]|undefined} years */
export function projectCashflowYears(tables, years, now = new Date()) {
  return new Map(Array.from(buildCashflowLedgers(ledgerTables(tables), years, now), ([year, data]) => [year, {
    formulaVersion: CASHFLOW_FORMULA_VERSION, year, weeks: projectionWeeks(year, data.income.length),
    manualBalance: data.manualBalance, balanceEndDP: data.balanceEndDP, balanceEndBudget: data.balanceEndBudget,
    projects: data.projects.map(({ id, name, type, charges, plan, iw, cashflow, budgetCashflow }) =>
      ({ id, name, type, charges, plan, iw, cashflow, budgetCashflow })),
  }]));
}

export function projectCashflow(tables, year, now = new Date()) {
  const data = projectCashflowYears(tables, [year], now).get(year);
  if (!data) throw new RangeError(`Некорректный год кэшфлоу: ${year}`);
  return data;
}

export function projectAllCashflowYears(tables, now = new Date()) {
  return Object.fromEntries(projectCashflowYears(tables, undefined, now));
}
