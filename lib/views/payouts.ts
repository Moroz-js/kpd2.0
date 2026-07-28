/**
 * `Payout` (TDNB-17) — view-провайдер: UNION выплат из Личных смет (Payment)
 * и Прочих трат (OtherExpense — поле `paymentAmount`).
 *
 * Не таблица в БД. Изменения в Выплатах → обратно в источник (см. TDNB-17).
 */

import { prisma } from "@/lib/db";
import { getISOWeek, getISOWeekYear } from "@/lib/iso-weeks";

export type PayoutSource = "personal" | "other-expense";

export type PayoutRow = {
  sourceType: PayoutSource;
  sourceId: string;
  number: string | null;
  numberYear: number | null;
  numberSerial: number | null;

  periodYear: number;
  periodMonth: number;
  weekPlanFact: number | null;
  yearPlanFact: number | null;

  executorId: string;
  executorName: string;
  executorAccessEmail: string | null;

  amount: number;
  /** Сумма работы для other-expense (`OtherExpense.amount`). */
  workAmount: number | null;
  /** Сумма выплаты для other-expense (`OtherExpense.paymentAmount`). */
  paymentAmount: number | null;
  paymentStatus: string | null;
  plannedPayAt: Date | null;
  paidAt: Date | null;
  bankAccountId: string | null;
  bankAccountName: string | null;
  comment: string | null;
  hasLinkedWorks: boolean;
  updatedAt: Date;
};

export type PayoutsFilter = {
  yearPlanFact?: number[];
  periodYear?: number[];
  periodMonth?: number[];
  weekPlanFact?: number[];
  executorId?: string[];
  paymentStatus?: string[];
  bankAccountId?: string[];
  sourceType?: PayoutSource[];
};

function planFactWeek(plannedPayAt: Date | null, paidAt: Date | null) {
  const d = paidAt ?? plannedPayAt;
  if (!d) return { week: null, year: null };
  return { week: getISOWeek(d), year: getISOWeekYear(d) };
}

export async function listPayouts(filter: PayoutsFilter = {}): Promise<PayoutRow[]> {
  const [payments, otherExpenses] = await Promise.all([
    prisma.payment.findMany({
      include: {
        executor: { select: { id: true, name: true, accessEmail: true } },
        bankAccount: { select: { id: true, name: true } },
        _count: { select: { works: true } },
      },
    }),
    prisma.otherExpense.findMany({
      where: { paymentAmount: { not: null } },
      include: {
        executor: { select: { id: true, name: true, accessEmail: true } },
        bankAccount: { select: { id: true, name: true } },
      },
    }),
  ]);

  const personal: PayoutRow[] = payments.map((p) => {
    const pf = planFactWeek(p.plannedPayAt, p.paidAt);
    return {
      sourceType: "personal",
      sourceId: p.id,
      number: p.payoutNumber,
      numberYear: p.payoutNumberYear,
      numberSerial: p.payoutNumberSerial,
      periodYear: p.periodYear,
      periodMonth: p.periodMonth,
      weekPlanFact: pf.week,
      yearPlanFact: pf.year,
      executorId: p.executorId,
      executorName: p.executor.name,
      executorAccessEmail: p.executor.accessEmail,
      amount: p.amount,
      workAmount: null,
      paymentAmount: null,
      paymentStatus: p.paymentStatus,
      plannedPayAt: p.plannedPayAt,
      paidAt: p.paidAt,
      bankAccountId: p.bankAccountId,
      bankAccountName: p.bankAccount?.name ?? null,
      comment: p.comment,
      hasLinkedWorks: p._count.works > 0,
      updatedAt: p.updatedAt,
    };
  });

  const other: PayoutRow[] = otherExpenses.map((o) => {
    const pf = planFactWeek(o.plannedPayAt, o.paidAt);
    return {
      sourceType: "other-expense",
      sourceId: o.id,
      number: o.payoutNumber,
      numberYear: o.payoutNumberYear,
      numberSerial: o.payoutNumberSerial,
      periodYear: o.executionYear,
      periodMonth: o.executionMonth,
      weekPlanFact: pf.week,
      yearPlanFact: pf.year,
      executorId: o.executorId,
      executorName: o.executor.name,
      executorAccessEmail: o.executor.accessEmail,
      amount: o.paymentAmount ?? 0,
      workAmount: o.amount,
      paymentAmount: o.paymentAmount,
      paymentStatus: o.paymentStatus,
      plannedPayAt: o.plannedPayAt,
      paidAt: o.paidAt,
      bankAccountId: o.bankAccountId,
      bankAccountName: o.bankAccount?.name ?? null,
      comment: o.comment,
      hasLinkedWorks: false,
      updatedAt: o.updatedAt,
    };
  });

  return applyFilter([...personal, ...other], filter);
}

function applyFilter(rows: PayoutRow[], f: PayoutsFilter): PayoutRow[] {
  return rows.filter((r) => {
    if (f.yearPlanFact?.length && (r.yearPlanFact == null || !f.yearPlanFact.includes(r.yearPlanFact))) return false;
    if (f.periodYear?.length && !f.periodYear.includes(r.periodYear)) return false;
    if (f.periodMonth?.length && !f.periodMonth.includes(r.periodMonth)) return false;
    if (f.weekPlanFact?.length && (r.weekPlanFact == null || !f.weekPlanFact.includes(r.weekPlanFact))) return false;
    if (f.executorId?.length && !f.executorId.includes(r.executorId)) return false;
    if (f.paymentStatus?.length && !f.paymentStatus.includes(r.paymentStatus ?? "")) return false;
    if (f.bankAccountId?.length && r.bankAccountId && !f.bankAccountId.includes(r.bankAccountId)) return false;
    if (f.sourceType?.length && !f.sourceType.includes(r.sourceType)) return false;
    return true;
  });
}
