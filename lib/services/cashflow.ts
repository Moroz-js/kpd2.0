import type { PrismaClient } from "@prisma/client";
import { isoWeekStart } from "@/lib/iso-weeks";
import { buildCashflowLedgers, cashflowPaymentWeek, cashflowWeekYear } from "@/lib/cashflow-ledger.mjs";
import type { CashflowLedgerYear } from "@/lib/cashflow-balance";
import { isWeekInRange, rangeYears, type CashflowRange } from "@/lib/cashflow-range";

export type CashflowWeekHeader = { week: number; month: number; monthName: string; year?: number };

export type CashflowSummary = {
  balanceStart: number[];
  incomeFact: number[];
  incomePlanOnly: number[];
  incomePlanFact: number[];
  expensePlanDP: number[];
  balanceEndDP: number[];
  manualBalance: (number | null)[];
  paidFromBudget: number[];
  unpaidFromBudget: number[];
  totalExpenseBudget: number[];
  deltaDP: number[];
  balanceEndBudget: number[];
};

export type CashflowProjectRow = {
  id: string;
  name: string;
  type: string;
  plan: number[];
  iw: number[];
  iwPaid: number[];
  charges: number[];
  cashflow: number[];
  budgetCashflow: number[];
};

export type CashflowYearData = {
  year: number;
  weeksInYear: number;
  weeks: CashflowWeekHeader[];
  openingBalance: number;
  summary: CashflowSummary;
  projects: CashflowProjectRow[];
  externalProjects: CashflowProjectRow[];
  internalProjects: CashflowProjectRow[];
  aggregates: {
    projectExpenses: number[];
    nonProjectExpenses: number[];
    taxes: number[];
    motivation: number[];
  };
  balanceInAccounts: (number | null)[];
  discrepancy: (number | null)[];
  discrepancyDPFact: number[];
  currentWeek: number;
  currentWeekYear: number;
};

type ChargeRow = {
  amount: number;
  status: string;
  paidAt: Date | string | null;
  paidPlanAt: Date | string | null;
  order: { projectId: string } | null;
};

type IssuedRow = {
  projectId: string;
  amount: number;
  workStatus: string;
  plannedPayAt: Date | string | null;
  paidAt: Date | string | null;
};

type PlanRow = { year: number; projectId: string; week: number; amount: number };
type OpeningRow = { year: number; amount: number };
type ManualRow = { year: number; week: number; amount: number | null };
type ProjectRow = { id: string; name: string; type: string };
type ReconciliationRow = {
  isoWeekYear: number;
  isoWeek: number;
  results: { amount: number | null }[];
};

export type CashflowTables = {
  charges: ChargeRow[];
  works: IssuedRow[];
  otherExpenses: IssuedRow[];
  planLines: PlanRow[];
  openingBalances: OpeningRow[];
  manualBalances: ManualRow[];
  activeProjects: ProjectRow[];
  reconciliations: ReconciliationRow[];
};

type CashflowQueryDb = Pick<PrismaClient,
  "charge" | "work" | "otherExpense" | "spendingPlanLine" | "cashflowOpeningBalance" |
  "cashflowManualBalance" | "project" | "bankAccountReconciliation">;

export { cashflowWeekYear };

export async function loadCashflowTables(db: CashflowQueryDb): Promise<CashflowTables> {
  const [
    charges,
    works,
    otherExpenses,
    planLines,
    openingBalances,
    manualBalances,
    activeProjects,
    reconciliations,
  ] = await Promise.all([
    db.charge.findMany({ select: {
      amount: true, status: true, paidAt: true, paidPlanAt: true, order: { select: { projectId: true } },
    } }),
    db.work.findMany({
      select: { projectId: true, amount: true, workStatus: true, plannedPayAt: true, paidAt: true },
    }),
    db.otherExpense.findMany({
      select: { projectId: true, amount: true, workStatus: true, plannedPayAt: true, paidAt: true },
    }),
    db.spendingPlanLine.findMany({
      select: { year: true, projectId: true, week: true, amount: true },
    }),
    db.cashflowOpeningBalance.findMany({ select: { year: true, amount: true } }),
    db.cashflowManualBalance.findMany({ select: { year: true, week: true, amount: true } }),
    db.project.findMany({ where: { status: "active" }, select: { id: true, name: true, type: true } }),
    db.bankAccountReconciliation.findMany({
      select: { isoWeekYear: true, isoWeek: true, results: { select: { amount: true } } },
    }),
  ]);

  return {
    charges,
    works,
    otherExpenses,
    planLines,
    openingBalances,
    manualBalances,
    activeProjects,
    reconciliations,
  };
}

export function listCashflowExportYears(tables: CashflowTables, now = new Date()): number[] {
  const years = new Set<number>();
  const currentYear = cashflowWeekYear(now).year;
  for (let year = currentYear - 2; year <= currentYear; year += 1) years.add(year);
  for (const row of tables.openingBalances) years.add(row.year);
  for (const row of tables.manualBalances) years.add(row.year);
  for (const row of tables.planLines) years.add(row.year);
  for (const row of tables.reconciliations) years.add(row.isoWeekYear);
  for (const row of tables.charges) {
    const point = cashflowPaymentWeek(row.paidAt, row.paidPlanAt);
    if (point) years.add(point.year);
  }
  for (const row of [...tables.works, ...tables.otherExpenses]) {
    const point = cashflowPaymentWeek(row.paidAt, row.plannedPayAt);
    if (point) years.add(point.year);
  }
  return [...years].filter((year) => year >= 2000 && year <= currentYear).sort((a, b) => b - a);
}

export function buildCashflowYears(tables: CashflowTables, years: number[], now = new Date()) {
  const ledgers = buildCashflowLedgers(tables, years, now);
  return new Map(Array.from(ledgers, ([year, ledger]) =>
    [year, formatCashflowYear(tables, year, ledger, now)] as const));
}

export function buildCashflowYear(tables: CashflowTables, year: number, now = new Date()): CashflowYearData {
  return buildCashflowYears(tables, [year], now).get(year)!;
}

function formatCashflowYear(tables: CashflowTables, year: number, ledger: CashflowLedgerYear, now: Date): CashflowYearData {
  const weeksInYear = ledger.income.length;
  const weeks = Array.from({ length: weeksInYear }, (_, index) => index + 1);
  const { week: currentWeek, year: currentWeekYear } = cashflowWeekYear(now);

  const balanceInAccounts: (number | null)[] = new Array(weeksInYear).fill(null);
  for (const reconciliation of tables.reconciliations) {
    if (reconciliation.isoWeekYear !== year) continue;
    const index = reconciliation.isoWeek - 1;
    if (index >= 0 && index < weeksInYear) {
      balanceInAccounts[index] = reconciliation.results.reduce(
        (sum, result) => sum + (result.amount ?? 0),
        0
      );
    }
  }

  const summary: CashflowSummary = {
    balanceStart: ledger.balanceStartDP,
    incomeFact: ledger.incomeFact,
    incomePlanOnly: ledger.income.map((n, i) => n - ledger.incomeFact[i]),
    incomePlanFact: ledger.income,
    expensePlanDP: ledger.expenseDP,
    balanceEndDP: ledger.balanceEndDP,
    manualBalance: ledger.manualBalance,
    paidFromBudget: ledger.paid,
    unpaidFromBudget: ledger.issued.map((n, i) => n - ledger.paid[i]),
    totalExpenseBudget: ledger.issued,
    deltaDP: ledger.issued.map((n, i) => n - ledger.expenseDP[i]),
    balanceEndBudget: ledger.balanceEndBudget,
  };
  const discrepancyDPFact = ledger.paid.map((n, i) => n - ledger.plan[i]);

  const discrepancy = summary.balanceEndDP.map((balance, index) => {
    const accounts = balanceInAccounts[index];
    return accounts === null ? null : balance - accounts;
  });

  const projects = ledger.projects.filter((project) => project.visible);

  const externalProjects = projects.filter((project) => project.type === "client");
  const internalProjects = projects.filter((project) => project.type !== "client");
  const taxesId = tables.activeProjects.find((project) => project.name === "Налоги")?.id;
  const motivationId = tables.activeProjects.find((project) => project.name === "Мотивация")?.id;
  const zero = () => new Array(weeksInYear).fill(0);
  const projectExpenses = zero();
  const nonProjectExpenses = zero();
  const taxes = zero();
  const motivation = zero();

  for (let index = 0; index < weeksInYear; index += 1) {
    for (const project of externalProjects) projectExpenses[index] += project.plan[index];
    for (const project of internalProjects) {
      if (project.id === taxesId) taxes[index] += project.plan[index];
      else if (project.id === motivationId) motivation[index] += project.plan[index];
      else nonProjectExpenses[index] += project.plan[index];
    }
  }

  return {
    year,
    weeksInYear,
    weeks: weeks.map((week) => {
      const start = isoWeekStart(year, week);
      return {
        week,
        month: start.getMonth() + 1,
        monthName: start.toLocaleDateString("ru-RU", { month: "short" }),
      };
    }),
    openingBalance: ledger.openingBalance,
    summary,
    projects,
    externalProjects,
    internalProjects,
    aggregates: { projectExpenses, nonProjectExpenses, taxes, motivation },
    balanceInAccounts,
    discrepancy,
    discrepancyDPFact,
    currentWeek,
    currentWeekYear,
  };
}

export type CashflowRangeData = Omit<CashflowYearData, "year" | "weeksInYear" | "weeks"> & {
  weeks: (CashflowWeekHeader & { year: number })[];
  /** Входящие остатки по календарным годам (редактируются на первой неделе года). */
  openingBalances: Record<number, number>;
  /** Только ручные значения: отсутствие ключа означает автоматический перенос. */
  openingBalanceOverrides: Record<number, number>;
};

function pick<T>(array: T[], indices: number[]): T[] {
  return indices.map((index) => array[index]);
}

/**
 * Кэшфлоу за произвольный период (месяцы включительно).
 * Сначала строим непрерывный баланс с начала истории, затем отбираем видимые недели.
 */
export function buildCashflowRange(
  tables: CashflowTables,
  range: CashflowRange,
  now = new Date()
): CashflowRangeData {
  const years = rangeYears(range);
  const yearData = buildCashflowYears(tables, years, now);
  const parts = years
    .map((year) => {
      const data = yearData.get(year)!;
      const indices = data.weeks
        .map((week, index) => (isWeekInRange(year, week.week, range) ? index : -1))
        .filter((index) => index >= 0);
      return { year, data, indices };
    })
    .filter((part) => part.indices.length > 0);

  const concat = <T,>(select: (data: CashflowYearData) => T[]): T[] =>
    parts.flatMap((part) => pick(select(part.data), part.indices));

  const mergeProjects = (
    select: (data: CashflowYearData) => CashflowProjectRow[]
  ): CashflowProjectRow[] => {
    const merged = new Map<string, CashflowProjectRow>();
    const total = parts.reduce((sum, part) => sum + part.indices.length, 0);
    let offset = 0;
    for (const part of parts) {
      for (const row of select(part.data)) {
        let target = merged.get(row.id);
        if (!target) {
          target = {
            id: row.id,
            name: row.name,
            type: row.type,
            plan: new Array(total).fill(0),
            iw: new Array(total).fill(0),
            iwPaid: new Array(total).fill(0),
            charges: new Array(total).fill(0),
            cashflow: new Array(total).fill(0),
            budgetCashflow: new Array(total).fill(0),
          };
          merged.set(row.id, target);
        }
        part.indices.forEach((source, i) => {
          target!.plan[offset + i] = row.plan[source];
          target!.iw[offset + i] = row.iw[source];
          target!.iwPaid[offset + i] = row.iwPaid[source];
          target!.charges[offset + i] = row.charges[source];
          target!.cashflow[offset + i] = row.cashflow[source];
          target!.budgetCashflow[offset + i] = row.budgetCashflow[source];
        });
      }
      offset += part.indices.length;
    }
    return [...merged.values()];
  };

  const summaryKeys = [
    "balanceStart", "incomeFact", "incomePlanOnly", "incomePlanFact", "expensePlanDP",
    "balanceEndDP", "manualBalance", "paidFromBudget", "unpaidFromBudget",
    "totalExpenseBudget", "deltaDP", "balanceEndBudget",
  ] as const;
  const summary = Object.fromEntries(
    summaryKeys.map((key) => [key, concat((data) => data.summary[key] as unknown[])])
  ) as unknown as CashflowSummary;

  const aggregateKeys = ["projectExpenses", "nonProjectExpenses", "taxes", "motivation"] as const;
  const aggregates = Object.fromEntries(
    aggregateKeys.map((key) => [key, concat((data) => data.aggregates[key])])
  ) as CashflowYearData["aggregates"];

  const { week: currentWeek, year: currentWeekYear } = cashflowWeekYear(now);

  return {
    weeks: parts.flatMap((part) =>
      pick(part.data.weeks, part.indices).map((week) => ({ ...week, year: part.year }))
    ),
    openingBalance: parts[0]?.data.openingBalance ?? 0,
    openingBalances: Object.fromEntries(parts.map((part) => [part.year, part.data.openingBalance])),
    openingBalanceOverrides: Object.fromEntries(tables.openingBalances
      .filter((row) => parts.some((part) => part.year === row.year)).map((row) => [row.year, row.amount])),
    summary,
    projects: mergeProjects((data) => data.projects),
    externalProjects: mergeProjects((data) => data.externalProjects),
    internalProjects: mergeProjects((data) => data.internalProjects),
    aggregates,
    balanceInAccounts: concat((data) => data.balanceInAccounts),
    discrepancy: concat((data) => data.discrepancy),
    discrepancyDPFact: concat((data) => data.discrepancyDPFact),
    currentWeek,
    currentWeekYear,
  };
}
