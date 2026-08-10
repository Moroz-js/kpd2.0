import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { getISOWeek, getISOWeeksInYear, isoWeekStart } from "@/lib/iso-weeks";
import { calculateCashflowBalances } from "@/lib/cashflow-balance";
import {
  dataSourcePrismaAdapter,
  resolveDataSource,
  SnapshotSourceError,
} from "@/lib/snapshots/data-source";

/**
 * Определяет неделю/год для кэшфлоу по календарному году.
 * Граничные случаи:
 *   31 дек — ISO-неделя 1 следующего года → зажимаем на последнюю неделю этого года
 *   1-3 янв  — ISO-неделя 52/53 прошлого года → зажимаем на неделю 1 этого года
 */
function cashflowWeekYear(d: Date): { week: number; year: number } {
  const year = d.getFullYear();
  const isoWeek = getISOWeek(d);
  let week = isoWeek;
  if (isoWeek === 1 && d.getMonth() === 11) {
    week = getISOWeeksInYear(year);
  } else if (isoWeek >= 52 && d.getMonth() === 0) {
    week = 1;
  }
  return { week, year };
}

function chargeWeekPF(c: { paidAt: Date | null; paidPlanAt: Date | null }) {
  const d = c.paidAt ?? c.paidPlanAt;
  if (!d) return null;
  return cashflowWeekYear(d);
}

function issuedWeekPF(r: { paidAt: Date | null; plannedPayAt: Date | null }) {
  const d = r.paidAt ?? r.plannedPayAt;
  if (!d) return null;
  return cashflowWeekYear(d);
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam) : new Date().getFullYear();
  let source;
  try {
    source = await resolveDataSource(req.nextUrl.searchParams.get("source"));
  } catch (error) {
    if (error instanceof SnapshotSourceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
  const db = dataSourcePrismaAdapter(source);
  const weeksInYear = getISOWeeksInYear(year);
  const weeks = Array.from({ length: weeksInYear }, (_, i) => i + 1);

  // Current week for past/future determination
  const now = new Date();
  const { week: currentWeek, year: currentWeekYear } = cashflowWeekYear(now);

  function isWeekPast(weekNum: number): boolean {
    if (year < currentWeekYear) return true;
    if (year > currentWeekYear) return false;
    return weekNum < currentWeek;
  }

  const [charges, works, otherExpenses, planLines, openingBalance, manualBalances, activeProjects, reconciliations] = await Promise.all([
    db.charge.findMany({ include: { order: { select: { projectId: true } } } }),
    db.work.findMany({ select: { projectId: true, amount: true, workStatus: true, plannedPayAt: true, paidAt: true } }),
    db.otherExpense.findMany({ select: { projectId: true, amount: true, workStatus: true, plannedPayAt: true, paidAt: true } }),
    db.spendingPlanLine.findMany({ where: { year }, select: { projectId: true, week: true, amount: true } }),
    db.cashflowOpeningBalance.findUnique({ where: { year } }),
    db.cashflowManualBalance.findMany({ where: { year }, select: { week: true, amount: true } }),
    db.project.findMany({ where: { status: "active" }, select: { id: true, name: true, type: true } }),
    db.bankAccountReconciliation.findMany({
      where: { isoWeekYear: year },
      include: { results: { select: { amount: true } } },
    }),
  ]);

  const activeProjectIds = new Set(activeProjects.map(p => p.id));

  // ─── Aggregate per week ───────────────────────────────────────
  // Charge: total (plan+fact) и paid per week
  const chargeTotal = new Array(weeksInYear).fill(0);
  const chargePaid = new Array(weeksInYear).fill(0);
  // by project: total
  const chargeByProject = new Map<string, number[]>();

  for (const c of charges) {
    if (!c.order) continue;
    if (!activeProjectIds.has(c.order.projectId)) continue;
    const pf = chargeWeekPF(c);
    if (!pf || pf.year !== year) continue;
    const wi = pf.week - 1;
    chargeTotal[wi] += c.amount;
    if (c.status === "paid") chargePaid[wi] += c.amount;
    // per project
    const pid = c.order.projectId;
    if (!chargeByProject.has(pid)) chargeByProject.set(pid, new Array(weeksInYear).fill(0));
    chargeByProject.get(pid)![wi] += c.amount;
  }

  // IssuedWork: total and paid per week
  const iwTotal = new Array(weeksInYear).fill(0);
  const iwPaid = new Array(weeksInYear).fill(0);
  const iwByProject = new Map<string, number[]>();
  const iwPaidByProject = new Map<string, number[]>();

  const allSources = [
    ...works.map(w => ({ ...w })),
    ...otherExpenses.map(o => ({ ...o })),
  ];
  // Агрегаты по работам считаем по всем проектам независимо от статуса —
  // построчные данные в таблице всё равно строятся только по активным.
  for (const r of allSources) {
    const pf = issuedWeekPF(r);
    if (!pf || pf.year !== year) continue;
    const wi = pf.week - 1;
    iwTotal[wi] += r.amount;
    if (r.workStatus === "paid") {
      iwPaid[wi] += r.amount;
      if (!iwPaidByProject.has(r.projectId)) iwPaidByProject.set(r.projectId, new Array(weeksInYear).fill(0));
      iwPaidByProject.get(r.projectId)![wi] += r.amount;
    }
    // per project (total)
    if (!iwByProject.has(r.projectId)) iwByProject.set(r.projectId, new Array(weeksInYear).fill(0));
    iwByProject.get(r.projectId)![wi] += r.amount;
  }

  // SpendingPlan per week and per project
  const planTotal = new Array(weeksInYear).fill(0);
  const planByProject = new Map<string, number[]>();

  for (const pl of planLines) {
    if (!activeProjectIds.has(pl.projectId)) continue;
    const wi = pl.week - 1;
    if (wi < 0 || wi >= weeksInYear) continue;
    planTotal[wi] += pl.amount;
    if (!planByProject.has(pl.projectId)) planByProject.set(pl.projectId, new Array(weeksInYear).fill(0));
    planByProject.get(pl.projectId)![wi] += pl.amount;
  }

  // ─── Balance in accounts from bank reconciliations ────────────
  const balanceInAccountsArr: (number | null)[] = new Array(weeksInYear).fill(null);
  for (const rec of reconciliations) {
    const wi = rec.isoWeek - 1;
    if (wi >= 0 && wi < weeksInYear) {
      const total = rec.results.reduce((sum, r) => sum + (r.amount ?? 0), 0);
      balanceInAccountsArr[wi] = total;
    }
  }

  // ─── Block 1: Summary (строки × недели) ───────────────────────
  const startBalance = openingBalance?.amount ?? 0;
  const manualBalanceArr: (number | null)[] = new Array(weeksInYear).fill(null);
  for (const row of manualBalances) {
    const wi = row.week - 1;
    if (wi >= 0 && wi < weeksInYear) manualBalanceArr[wi] = row.amount;
  }
  const summaryRows = {
    balanceStart: [] as number[],      // Входящий баланс ДП
    incomeFact: [] as number[],        // Приход (факт)
    incomePlanOnly: [] as number[],    // Приход (план)
    incomePlanFact: [] as number[],    // Приход (план+факт)
    expensePlanDP: [] as number[],     // Расход (план-факт) из ДП — прошлые: paid works; текущие/будущие: plan
    balanceEndDP: [] as number[],      // Баланс (смета/ДП)
    manualBalance: manualBalanceArr,   // Ручной входящий баланс для следующей недели
    paidFromBudget: [] as number[],    // Оплачено из смет
    unpaidFromBudget: [] as number[],  // Неплачено из смет
    totalExpenseBudget: [] as number[],// (не показывается, сохранено для обратной совместимости)
    deltaDP: [] as number[],           // (внутренний, не отображается)
    balanceEndBudget: [] as number[],  // (внутренний, для графика)
  };

  // Discrepancy plan/fact in DP per week = iwPaid - planTotal
  const discrepancyDPFact: number[] = new Array(weeksInYear).fill(0);
  const expensePlanDPArr = Array.from({ length: weeksInYear }, (_, index) =>
    isWeekPast(index + 1) ? iwPaid[index] : planTotal[index]
  );
  const balanceChains = calculateCashflowBalances({
    openingBalance: startBalance,
    income: chargeTotal,
    expenseDP: expensePlanDPArr,
    expenseBudget: iwTotal,
    manualBalance: manualBalanceArr,
  });

  for (let i = 0; i < weeksInYear; i++) {
    const balanceStartDP = balanceChains.balanceStartDP[i];
    const incomePF = chargeTotal[i];
    const incomeFact = chargePaid[i];
    const incPlanOnly = incomePF - incomeFact;

    // Расход (план-факт) из ДП:
    // прошлые недели → факт оплаченных работ; текущая/будущие → план из ДП
    const expDP = expensePlanDPArr[i];

    const expBudget = iwTotal[i];
    const paidBudget = iwPaid[i];
    const unpaidBudget = expBudget - paidBudget;
    const balanceEndDP = balanceChains.balanceEndDP[i];
    const balanceEndBudget = balanceChains.balanceEndBudget[i];
    const delta = expBudget - expDP;

    summaryRows.balanceStart.push(balanceStartDP);
    summaryRows.incomeFact.push(incomeFact);
    summaryRows.incomePlanOnly.push(incPlanOnly);
    summaryRows.incomePlanFact.push(incomePF);
    summaryRows.expensePlanDP.push(expDP);
    summaryRows.balanceEndDP.push(balanceEndDP);
    summaryRows.paidFromBudget.push(paidBudget);
    summaryRows.unpaidFromBudget.push(unpaidBudget);
    summaryRows.totalExpenseBudget.push(expBudget);
    summaryRows.deltaDP.push(delta);
    summaryRows.balanceEndBudget.push(balanceEndBudget);

    discrepancyDPFact[i] = iwPaid[i] - planTotal[i];
  }

  // Discrepancy = balanceEndDP - balanceInAccounts (null if no accounts data)
  const discrepancyArr: (number | null)[] = summaryRows.balanceEndDP.map((bal, i) => {
    const acc = balanceInAccountsArr[i];
    return acc === null ? null : bal - acc;
  });

  // ─── Projects union list ───────────────────────────────────────
  const allPids = new Set<string>([
    ...planByProject.keys(),
    ...iwByProject.keys(),
    ...chargeByProject.keys(),
  ]);
  const projectRows = activeProjects
    .filter(p => allPids.has(p.id))
    .map(p => {
      const plan = planByProject.get(p.id) ?? new Array(weeksInYear).fill(0);
      const iw = iwByProject.get(p.id) ?? new Array(weeksInYear).fill(0);
      const iwPaidArr = iwPaidByProject.get(p.id) ?? new Array(weeksInYear).fill(0);
      const charges2 = chargeByProject.get(p.id) ?? new Array(weeksInYear).fill(0);

      // Block 2.4: rolling cashflow per project
      const cashflow = new Array(weeksInYear).fill(0);
      let prev = 0;
      for (let i = 0; i < weeksInYear; i++) {
        prev = prev + charges2[i] - plan[i];
        cashflow[i] = prev;
      }

      return {
        id: p.id,
        name: p.name,
        type: p.type,
        plan,
        iw,
        iwPaid: iwPaidArr,
        charges: charges2,
        cashflow,
      };
    });

  const externalProjects = projectRows.filter(p => p.type === "client");
  const internalProjects = projectRows.filter(p => p.type !== "client");

  // ─── Aggregates ───────────────────────────────────────────────
  const TAXES_NAME = "Налоги";
  const MOTIVATION_NAME = "Мотивация";
  const taxesProject = activeProjects.find(p => p.name === TAXES_NAME);
  const motivationProject = activeProjects.find(p => p.name === MOTIVATION_NAME);
  const taxesId = taxesProject?.id;
  const motivationId = motivationProject?.id;

  const zeroArr = () => new Array(weeksInYear).fill(0);

  const projectExpenses = zeroArr();
  const nonProjectExpenses = zeroArr();
  const taxes = zeroArr();
  const motivation = zeroArr();

  for (let i = 0; i < weeksInYear; i++) {
    for (const p of externalProjects) projectExpenses[i] += p.plan[i];
    for (const p of internalProjects) {
      if (p.id === taxesId) taxes[i] += p.plan[i];
      else if (p.id === motivationId) motivation[i] += p.plan[i];
      else nonProjectExpenses[i] += p.plan[i];
    }
  }

  // ─── Week headers ──────────────────────────────────────────────
  const weekHeaders = weeks.map(w => {
    const start = isoWeekStart(year, w);
    return {
      week: w,
      month: start.getMonth() + 1,
      monthName: start.toLocaleDateString("ru-RU", { month: "short" }),
    };
  });

  return NextResponse.json({
    year,
    weeksInYear,
    weeks: weekHeaders,
    openingBalance: openingBalance?.amount ?? 0,
    summary: summaryRows,
    projects: projectRows,
    externalProjects,
    internalProjects,
    aggregates: { projectExpenses, nonProjectExpenses, taxes, motivation },
    balanceInAccounts: balanceInAccountsArr,
    discrepancy: discrepancyArr,
    discrepancyDPFact,
    currentWeek,
    currentWeekYear,
  });
}
