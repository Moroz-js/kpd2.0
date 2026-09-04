import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/audit/log";
import { calculateCashflowBalances } from "@/lib/cashflow-balance";
import { cashflowCommentActivityId } from "@/lib/comment-history";
import { getISOWeek, getISOWeeksInYear } from "@/lib/iso-weeks";

type CommentedCellValue = {
  year: number;
  week: number;
  rowKey: string;
  value: number | null;
};

export type CashflowCommentValues = Map<string, CommentedCellValue>;

function cellId(year: number, week: number, rowKey: string) {
  return `${year}:${week}:${rowKey}`;
}

function cashflowWeekYear(date: Date): { week: number; year: number } {
  const year = date.getFullYear();
  const isoWeek = getISOWeek(date);
  let week = isoWeek;
  if (isoWeek === 1 && date.getMonth() === 11) week = getISOWeeksInYear(year);
  else if (isoWeek >= 52 && date.getMonth() === 0) week = 1;
  return { week, year };
}

function chargeWeek(
  charge: { paidAt: Date | null; paidPlanAt: Date | null }
) {
  const date = charge.paidAt ?? charge.paidPlanAt;
  return date ? cashflowWeekYear(date) : null;
}

function expenseWeek(
  expense: { paidAt: Date | null; plannedPayAt: Date | null }
) {
  const date = expense.paidAt ?? expense.plannedPayAt;
  return date ? cashflowWeekYear(date) : null;
}

/**
 * Снимает только значения ячеек, к которым прикреплены комментарии. Вызывается
 * до и после мутации источников, а не при чтении кэшфлоу.
 */
export async function captureCashflowCommentValues(): Promise<CashflowCommentValues> {
  try {
    const comments = await prisma.cashflowCellComment.findMany({
      where: {
        OR: [{ text: { not: "" } }, { highlight: { not: null } }],
      },
      select: { year: true, week: true, rowKey: true },
    });
    if (comments.length === 0) return new Map();

    const years = [...new Set(comments.map((comment) => comment.year))];
    const [
      charges,
      works,
      otherExpenses,
      planLines,
      openingBalances,
      manualBalances,
      projects,
      reconciliations,
    ] = await Promise.all([
      prisma.charge.findMany({
        select: {
          amount: true,
          status: true,
          paidAt: true,
          paidPlanAt: true,
          order: { select: { projectId: true } },
        },
      }),
      prisma.work.findMany({
        select: { projectId: true, amount: true, workStatus: true, plannedPayAt: true, paidAt: true },
      }),
      prisma.otherExpense.findMany({
        select: { projectId: true, amount: true, workStatus: true, plannedPayAt: true, paidAt: true },
      }),
      prisma.spendingPlanLine.findMany({
        where: { year: { in: years } },
        select: { projectId: true, year: true, week: true, amount: true },
      }),
      prisma.cashflowOpeningBalance.findMany({
        where: { year: { in: years } },
        select: { year: true, amount: true },
      }),
      prisma.cashflowManualBalance.findMany({
        where: { year: { in: years } },
        select: { year: true, week: true, amount: true },
      }),
      prisma.project.findMany({
        where: { status: "active" },
        select: { id: true, name: true, type: true },
      }),
      prisma.bankAccountReconciliation.findMany({
        where: { isoWeekYear: { in: years } },
        select: { isoWeekYear: true, isoWeek: true, results: { select: { amount: true } } },
      }),
    ]);

    const activeProjectIds = new Set(projects.map((project) => project.id));
    const values = new Map<string, CommentedCellValue>();
    const now = new Date();
    const current = cashflowWeekYear(now);

    for (const year of years) {
      const weeksInYear = getISOWeeksInYear(year);
      const zeroes = () => new Array<number>(weeksInYear).fill(0);
      const isPast = (week: number) =>
        year < current.year || (year === current.year && week < current.week);
      const chargeTotal = zeroes();
      const chargePaid = zeroes();
      const chargeByProject = new Map<string, number[]>();
      const totalExpense = zeroes();
      const paidExpense = zeroes();
      const expenseByProject = new Map<string, number[]>();
      const paidExpenseByProject = new Map<string, number[]>();
      const planTotal = zeroes();
      const planByProject = new Map<string, number[]>();
      const manualBalance: (number | null)[] = new Array(weeksInYear).fill(null);
      const balanceInAccounts: (number | null)[] = new Array(weeksInYear).fill(null);

      for (const charge of charges) {
        const point = chargeWeek(charge);
        const projectId = charge.order?.projectId;
        if (!point || point.year !== year || !projectId || !activeProjectIds.has(projectId)) continue;
        const index = point.week - 1;
        chargeTotal[index] += charge.amount;
        if (charge.status === "paid") chargePaid[index] += charge.amount;
        const projectValues = chargeByProject.get(projectId) ?? zeroes();
        projectValues[index] += charge.amount;
        chargeByProject.set(projectId, projectValues);
      }

      for (const expense of [...works, ...otherExpenses]) {
        const point = expenseWeek(expense);
        if (!point || point.year !== year) continue;
        const index = point.week - 1;
        totalExpense[index] += expense.amount;
        const projectValues = expenseByProject.get(expense.projectId) ?? zeroes();
        projectValues[index] += expense.amount;
        expenseByProject.set(expense.projectId, projectValues);
        if (expense.workStatus === "paid") {
          paidExpense[index] += expense.amount;
          const paidProjectValues = paidExpenseByProject.get(expense.projectId) ?? zeroes();
          paidProjectValues[index] += expense.amount;
          paidExpenseByProject.set(expense.projectId, paidProjectValues);
        }
      }

      for (const line of planLines) {
        if (line.year !== year || !activeProjectIds.has(line.projectId)) continue;
        const index = line.week - 1;
        if (index < 0 || index >= weeksInYear) continue;
        planTotal[index] += line.amount;
        const projectValues = planByProject.get(line.projectId) ?? zeroes();
        projectValues[index] += line.amount;
        planByProject.set(line.projectId, projectValues);
      }

      for (const manual of manualBalances) {
        if (manual.year === year && manual.week >= 1 && manual.week <= weeksInYear) {
          manualBalance[manual.week - 1] = manual.amount;
        }
      }
      for (const reconciliation of reconciliations) {
        if (reconciliation.isoWeekYear !== year) continue;
        const index = reconciliation.isoWeek - 1;
        if (index >= 0 && index < weeksInYear) {
          balanceInAccounts[index] = reconciliation.results.reduce(
            (sum, result) => sum + (result.amount ?? 0),
            0
          );
        }
      }

      const expensePlanDP = Array.from({ length: weeksInYear }, (_, index) =>
        isPast(index + 1) ? paidExpense[index] : planTotal[index]
      );
      const openingBalance =
        openingBalances.find((balance) => balance.year === year)?.amount ?? 0;
      const balances = calculateCashflowBalances({
        openingBalance,
        income: chargeTotal,
        expenseDP: expensePlanDP,
        expenseBudget: totalExpense,
        manualBalance,
      });
      const summary: Record<string, (number | null)[]> = {
        balanceStart: balances.balanceStartDP,
        incomeFact: chargePaid,
        incomePlanOnly: chargeTotal.map((amount, index) => amount - chargePaid[index]),
        incomePlanFact: chargeTotal,
        expensePlanDP,
        balanceEndDP: balances.balanceEndDP,
        manualBalance,
        paidFromBudget: paidExpense,
        unpaidFromBudget: totalExpense.map((amount, index) => amount - paidExpense[index]),
        balanceInAccounts,
        discrepancy: balances.balanceEndDP.map((amount, index) =>
          balanceInAccounts[index] === null ? null : amount - balanceInAccounts[index]!
        ),
        discrepancyDPFact: paidExpense.map((amount, index) => amount - planTotal[index]),
      };

      const projectExpenses = zeroes();
      const nonProjectExpenses = zeroes();
      const taxes = zeroes();
      const motivation = zeroes();
      const taxesId = projects.find((project) => project.name === "Налоги")?.id;
      const motivationId = projects.find((project) => project.name === "Мотивация")?.id;
      for (const project of projects) {
        const plan = planByProject.get(project.id) ?? zeroes();
        for (let index = 0; index < weeksInYear; index += 1) {
          if (project.type === "client") projectExpenses[index] += plan[index];
          else if (project.id === taxesId) taxes[index] += plan[index];
          else if (project.id === motivationId) motivation[index] += plan[index];
          else nonProjectExpenses[index] += plan[index];
        }
      }
      const aggregates: Record<string, number[]> = {
        projectExpenses,
        nonProjectExpenses,
        taxes,
        motivation,
      };

      for (const comment of comments) {
        if (comment.year !== year || comment.week < 1 || comment.week > weeksInYear) continue;
        const index = comment.week - 1;
        let value: number | null | undefined;
        if (comment.rowKey.startsWith("summary:")) {
          value = summary[comment.rowKey.slice("summary:".length)]?.[index];
        } else if (comment.rowKey.startsWith("aggregate:")) {
          value = aggregates[comment.rowKey.slice("aggregate:".length)]?.[index];
        } else {
          const match = /^project:(.+):(plan|iw|charges)$/.exec(comment.rowKey);
          if (match) {
            const [, projectId, kind] = match;
            const source =
              kind === "plan"
                ? planByProject
                : kind === "iw"
                  ? expenseByProject
                  : chargeByProject;
            value = source.get(projectId)?.[index] ?? 0;
          }
        }
        if (value === undefined) continue;
        values.set(cellId(comment.year, comment.week, comment.rowKey), {
          ...comment,
          value,
        });
      }
    }

    return values;
  } catch {
    // История комментариев не должна делать основную мутацию недоступной.
    return new Map();
  }
}

export async function logCashflowCommentValueChanges(
  before: CashflowCommentValues,
  userId: string,
  skip?: (cell: CommentedCellValue) => boolean
) {
  if (before.size === 0) return;
  const after = await captureCashflowCommentValues();
  await Promise.all(
    [...before].flatMap(([id, previous]) => {
      const next = after.get(id);
      if (!next || skip?.(previous) || Object.is(previous.value, next.value)) return [];
      return logActivity({
        userId,
        action: "auto_update",
        entityType: "CashflowCellComment",
        entityId: cashflowCommentActivityId(previous.year, previous.week, previous.rowKey),
        entityLabel: `Кэшфлоу · нед. ${previous.week} / ${previous.year}`,
        changes: { value: { from: previous.value, to: next.value } },
      });
    })
  );
}
