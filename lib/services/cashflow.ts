import { getISOWeek, getISOWeeksInYear, isoWeekStart } from "@/lib/iso-weeks";
import { calculateCashflowBalances } from "@/lib/cashflow-balance";

export type CashflowWeekHeader = { week: number; month: number; monthName: string };

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

type CashflowQueryDb = {
  charge: { findMany: (args?: object) => Promise<ChargeRow[]> };
  work: { findMany: (args?: object) => Promise<IssuedRow[]> };
  otherExpense: { findMany: (args?: object) => Promise<IssuedRow[]> };
  spendingPlanLine: { findMany: (args?: object) => Promise<PlanRow[]> };
  cashflowOpeningBalance: { findMany: (args?: object) => Promise<OpeningRow[]> };
  cashflowManualBalance: { findMany: (args?: object) => Promise<ManualRow[]> };
  project: { findMany: (args?: object) => Promise<ProjectRow[]> };
  bankAccountReconciliation: { findMany: (args?: object) => Promise<ReconciliationRow[]> };
};

/**
 * Неделя/год кэшфлоу по календарному году.
 * 31 дек (ISO 1 следующего) → последняя неделя этого года.
 * 1–3 янв (ISO 52/53 прошлого) → неделя 1 этого года.
 */
export function cashflowWeekYear(value: Date): { week: number; year: number } {
  const year = value.getFullYear();
  const isoWeek = getISOWeek(value);
  let week = isoWeek;
  if (isoWeek === 1 && value.getMonth() === 11) {
    week = getISOWeeksInYear(year);
  } else if (isoWeek >= 52 && value.getMonth() === 0) {
    week = 1;
  }
  return { week, year };
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function chargeWeekPF(row: { paidAt: Date | string | null; paidPlanAt: Date | string | null }) {
  const date = toDate(row.paidAt) ?? toDate(row.paidPlanAt);
  return date ? cashflowWeekYear(date) : null;
}

function issuedWeekPF(row: { paidAt: Date | string | null; plannedPayAt: Date | string | null }) {
  const date = toDate(row.paidAt) ?? toDate(row.plannedPayAt);
  return date ? cashflowWeekYear(date) : null;
}

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
    db.charge.findMany({ include: { order: { select: { projectId: true } } } }),
    db.work.findMany({
      select: { projectId: true, amount: true, workStatus: true, plannedPayAt: true, paidAt: true },
    }),
    db.otherExpense.findMany({
      select: { projectId: true, amount: true, workStatus: true, plannedPayAt: true, paidAt: true },
    }),
    db.spendingPlanLine.findMany({
      select: { year: true, projectId: true, week: true, amount: true },
    }),
    db.cashflowOpeningBalance.findMany(),
    db.cashflowManualBalance.findMany({ select: { year: true, week: true, amount: true } }),
    db.project.findMany({ where: { status: "active" }, select: { id: true, name: true, type: true } }),
    db.bankAccountReconciliation.findMany({
      include: { results: { select: { amount: true } } },
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
    const point = chargeWeekPF(row);
    if (point) years.add(point.year);
  }
  for (const row of [...tables.works, ...tables.otherExpenses]) {
    const point = issuedWeekPF(row);
    if (point) years.add(point.year);
  }
  return [...years].filter((year) => year >= 2000 && year <= currentYear).sort((a, b) => b - a);
}

export function buildCashflowYear(
  tables: CashflowTables,
  year: number,
  now = new Date()
): CashflowYearData {
  const weeksInYear = getISOWeeksInYear(year);
  const weeks = Array.from({ length: weeksInYear }, (_, index) => index + 1);
  const { week: currentWeek, year: currentWeekYear } = cashflowWeekYear(now);

  function isWeekPast(weekNum: number): boolean {
    if (year < currentWeekYear) return true;
    if (year > currentWeekYear) return false;
    return weekNum < currentWeek;
  }

  const activeProjectIds = new Set(tables.activeProjects.map((project) => project.id));
  const chargeTotal = new Array(weeksInYear).fill(0);
  const chargePaid = new Array(weeksInYear).fill(0);
  const chargeByProject = new Map<string, number[]>();

  for (const charge of tables.charges) {
    if (!charge.order) continue;
    if (!activeProjectIds.has(charge.order.projectId)) continue;
    const point = chargeWeekPF(charge);
    if (!point || point.year !== year) continue;
    const index = point.week - 1;
    chargeTotal[index] += charge.amount;
    if (charge.status === "paid") chargePaid[index] += charge.amount;
    const projectId = charge.order.projectId;
    if (!chargeByProject.has(projectId)) chargeByProject.set(projectId, new Array(weeksInYear).fill(0));
    chargeByProject.get(projectId)![index] += charge.amount;
  }

  const iwTotal = new Array(weeksInYear).fill(0);
  const iwPaid = new Array(weeksInYear).fill(0);
  const iwByProject = new Map<string, number[]>();
  const iwPaidByProject = new Map<string, number[]>();

  for (const row of [...tables.works, ...tables.otherExpenses]) {
    const point = issuedWeekPF(row);
    if (!point || point.year !== year) continue;
    const index = point.week - 1;
    iwTotal[index] += row.amount;
    if (row.workStatus === "paid") {
      iwPaid[index] += row.amount;
      if (!iwPaidByProject.has(row.projectId)) {
        iwPaidByProject.set(row.projectId, new Array(weeksInYear).fill(0));
      }
      iwPaidByProject.get(row.projectId)![index] += row.amount;
    }
    if (!iwByProject.has(row.projectId)) iwByProject.set(row.projectId, new Array(weeksInYear).fill(0));
    iwByProject.get(row.projectId)![index] += row.amount;
  }

  const planTotal = new Array(weeksInYear).fill(0);
  const planByProject = new Map<string, number[]>();
  for (const line of tables.planLines) {
    if (line.year !== year || !activeProjectIds.has(line.projectId)) continue;
    const index = line.week - 1;
    if (index < 0 || index >= weeksInYear) continue;
    planTotal[index] += line.amount;
    if (!planByProject.has(line.projectId)) {
      planByProject.set(line.projectId, new Array(weeksInYear).fill(0));
    }
    planByProject.get(line.projectId)![index] += line.amount;
  }

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

  const openingBalance = tables.openingBalances.find((row) => row.year === year)?.amount ?? 0;
  const manualBalance: (number | null)[] = new Array(weeksInYear).fill(null);
  for (const row of tables.manualBalances) {
    if (row.year !== year) continue;
    const index = row.week - 1;
    if (index >= 0 && index < weeksInYear) manualBalance[index] = row.amount;
  }

  const expensePlanDP = Array.from({ length: weeksInYear }, (_, index) =>
    isWeekPast(index + 1) ? iwPaid[index] : planTotal[index]
  );
  const balanceChains = calculateCashflowBalances({
    openingBalance,
    income: chargeTotal,
    expenseDP: expensePlanDP,
    expenseBudget: iwTotal,
    manualBalance,
  });

  const summary: CashflowSummary = {
    balanceStart: [],
    incomeFact: [],
    incomePlanOnly: [],
    incomePlanFact: [],
    expensePlanDP: [],
    balanceEndDP: [],
    manualBalance,
    paidFromBudget: [],
    unpaidFromBudget: [],
    totalExpenseBudget: [],
    deltaDP: [],
    balanceEndBudget: [],
  };
  const discrepancyDPFact = new Array(weeksInYear).fill(0);

  for (let index = 0; index < weeksInYear; index += 1) {
    const incomePlanFact = chargeTotal[index];
    const incomeFact = chargePaid[index];
    summary.balanceStart.push(balanceChains.balanceStartDP[index]);
    summary.incomeFact.push(incomeFact);
    summary.incomePlanOnly.push(incomePlanFact - incomeFact);
    summary.incomePlanFact.push(incomePlanFact);
    summary.expensePlanDP.push(expensePlanDP[index]);
    summary.balanceEndDP.push(balanceChains.balanceEndDP[index]);
    summary.paidFromBudget.push(iwPaid[index]);
    summary.unpaidFromBudget.push(iwTotal[index] - iwPaid[index]);
    summary.totalExpenseBudget.push(iwTotal[index]);
    summary.deltaDP.push(iwTotal[index] - expensePlanDP[index]);
    summary.balanceEndBudget.push(balanceChains.balanceEndBudget[index]);
    discrepancyDPFact[index] = iwPaid[index] - planTotal[index];
  }

  const discrepancy = summary.balanceEndDP.map((balance, index) => {
    const accounts = balanceInAccounts[index];
    return accounts === null ? null : balance - accounts;
  });

  const projectIds = new Set<string>([
    ...planByProject.keys(),
    ...iwByProject.keys(),
    ...chargeByProject.keys(),
  ]);
  const projects = tables.activeProjects
    .filter((project) => projectIds.has(project.id))
    .map((project) => {
      const plan = planByProject.get(project.id) ?? new Array(weeksInYear).fill(0);
      const iw = iwByProject.get(project.id) ?? new Array(weeksInYear).fill(0);
      const projectIwPaid = iwPaidByProject.get(project.id) ?? new Array(weeksInYear).fill(0);
      const charges = chargeByProject.get(project.id) ?? new Array(weeksInYear).fill(0);
      const cashflow = new Array(weeksInYear).fill(0);
      let rolling = 0;
      for (let index = 0; index < weeksInYear; index += 1) {
        rolling += charges[index] - plan[index];
        cashflow[index] = rolling;
      }
      return {
        id: project.id,
        name: project.name,
        type: project.type,
        plan,
        iw,
        iwPaid: projectIwPaid,
        charges,
        cashflow,
      };
    });

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
    openingBalance,
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
