/**
 * `IssuedWork` (TDNB-14) — view-провайдер: UNION работ из Личных смет (Work)
 * и Прочих трат (OtherExpense).
 *
 * Это **не таблица в БД**, а функция-фасад. Возвращает унифицированную форму строки.
 * Изменения в Выставленных работах → обратно в источник (см. TDNB-14 §3.7/3.8).
 */

import { prisma } from "@/lib/db";
import { getISOWeek } from "@/lib/iso-weeks";
import { hasPersonalSmeta } from "@/lib/executor-personal-estimate";

export type IssuedWorkSource = "personal" | "other-expense";

export type IssuedWorkRow = {
  sourceType: IssuedWorkSource;
  sourceId: string; // id Work.id или OtherExpense.id
  number: string | null;
  numberYear: number | null;
  numberSerial: number | null;

  executionYear: number;
  executionMonth: number;
  weekPlanFact: number | null;
  yearPlanFact: number | null;

  executorId: string;
  executorName: string;
  executorType: string;
  executorAccessEmail: string | null;
  executorCanOpenEstimate: boolean;
  projectId: string;
  projectName: string;
  projectType: string;
  workTypeId: string;
  workTypeName: string;
  workTypeSegment: string;

  responsibleExecutorId: string | null;
  responsibleExecutorName: string | null;

  amount: number;
  description: string | null;
  techTask: string | null;
  rate: number | null;
  workStatus: string;
  paymentId: string | null;
  paymentStatus: string | null;
  comment: string | null;
  checkedAt: Date | null;
  paidAt: Date | null;
  plannedPayAt: Date | null;
  updatedAt: Date;
};

export type IssuedWorksFilter = {
  yearPlanFact?: number[];
  executionYear?: number[];
  executionMonth?: number[];
  weekPlanFact?: number[];
  executorId?: string[];
  projectId?: string[];
  workTypeId?: string[];
  workStatus?: string[];
  projectType?: string[];
  workTypeSegment?: string[];
  executorType?: string[];
  sourceType?: IssuedWorkSource[];
  responsibleExecutorId?: string[];
};

/** Извлечь даты (неделя/год план-факт) — facto если есть, иначе по plan. */
function planFactWeek(plannedPayAt: Date | null, paidAt: Date | null): { week: number | null; year: number | null } {
  const d = paidAt ?? plannedPayAt;
  if (!d) return { week: null, year: null };
  // Используем календарный год (getFullYear), а не ISO-год — иначе 31.12 попадает в следующий год
  return { week: getISOWeek(d), year: d.getFullYear() };
}

export async function listIssuedWorks(
  filter: IssuedWorksFilter = {},
  db: {
    work: { findMany: typeof prisma.work.findMany };
    otherExpense: { findMany: typeof prisma.otherExpense.findMany };
  } = prisma
): Promise<IssuedWorkRow[]> {
  const [works, otherExpenses] = await Promise.all([
    db.work.findMany({
      include: {
        executor: {
          select: {
            id: true,
            name: true,
            type: true,
            accessEmail: true,
            isResponsible: true,
          },
        },
        project: { select: { id: true, name: true, type: true } },
        workType: { select: { id: true, name: true, segment: true } },
        responsibleExecutor: { select: { id: true, name: true } },
      payment: { select: { id: true, paymentStatus: true } },
      },
    }),
    db.otherExpense.findMany({
      include: {
        executor: {
          select: {
            id: true,
            name: true,
            type: true,
            accessEmail: true,
            isResponsible: true,
          },
        },
        project: { select: { id: true, name: true, type: true } },
        workType: { select: { id: true, name: true, segment: true } },
        responsibleExecutor: { select: { id: true, name: true } },
      },
    }),
  ]);

  const personal: IssuedWorkRow[] = works.map((w) => {
    const pf = planFactWeek(w.plannedPayAt, w.paidAt);
    return {
      sourceType: "personal",
      sourceId: w.id,
      number: w.issuedWorkNumber,
      numberYear: w.issuedWorkNumberYear,
      numberSerial: w.issuedWorkNumberSerial,
      executionYear: w.executionYear,
      executionMonth: w.executionMonth,
      weekPlanFact: pf.week,
      yearPlanFact: pf.year,
      executorId: w.executorId,
      executorName: w.executor.name,
      executorType: w.executor.type,
      executorAccessEmail: w.executor.accessEmail,
      executorCanOpenEstimate:
        hasPersonalSmeta(w.executor) || w.executor.isResponsible,
      projectId: w.projectId,
      projectName: w.project.name,
      projectType: w.project.type,
      workTypeId: w.workTypeId,
      workTypeName: w.workType.name,
      workTypeSegment: w.workType.segment,
      responsibleExecutorId: w.responsibleExecutorId,
      responsibleExecutorName: w.responsibleExecutor?.name ?? null,
      amount: w.amount,
      description: w.techTask,
      techTask: w.techTask,
      rate: w.rate,
      workStatus: w.workStatus,
      paymentId: w.payment?.id ?? null,
      paymentStatus: w.payment?.paymentStatus ?? null,
      comment: w.comment,
      checkedAt: w.checkedAt,
      paidAt: w.paidAt,
      plannedPayAt: w.plannedPayAt,
      updatedAt: w.updatedAt,
    };
  });

  const other: IssuedWorkRow[] = otherExpenses.map((o) => {
    const pf = planFactWeek(o.plannedPayAt, o.paidAt);
    return {
      sourceType: "other-expense",
      sourceId: o.id,
      number: o.issuedWorkNumber,
      numberYear: o.issuedWorkNumberYear,
      numberSerial: o.issuedWorkNumberSerial,
      executionYear: o.executionYear,
      executionMonth: o.executionMonth,
      weekPlanFact: pf.week,
      yearPlanFact: pf.year,
      executorId: o.executorId,
      executorName: o.executor.name,
      executorType: o.executor.type,
      executorAccessEmail: o.executor.accessEmail,
      executorCanOpenEstimate:
        hasPersonalSmeta(o.executor) || o.executor.isResponsible,
      projectId: o.projectId,
      projectName: o.project.name,
      projectType: o.project.type,
      workTypeId: o.workTypeId,
      workTypeName: o.workType.name,
      workTypeSegment: o.workType.segment,
      responsibleExecutorId: o.responsibleExecutorId,
      responsibleExecutorName: o.responsibleExecutor?.name ?? null,
      amount: o.amount,
      description: o.description,
      techTask: null,
      rate: null,
      workStatus: o.workStatus,
      paymentId: o.paymentStatus ? o.id : null,
      paymentStatus: o.paymentStatus,
      comment: o.comment,
      checkedAt: o.checkedAt,
      paidAt: o.paidAt,
      plannedPayAt: o.plannedPayAt,
      updatedAt: o.updatedAt,
    };
  });

  return applyFilter([...personal, ...other], filter);
}

function applyFilter(rows: IssuedWorkRow[], f: IssuedWorksFilter): IssuedWorkRow[] {
  return rows.filter((r) => {
    if (f.yearPlanFact?.length && (r.yearPlanFact == null || !f.yearPlanFact.includes(r.yearPlanFact))) return false;
    if (f.executionYear?.length && !f.executionYear.includes(r.executionYear)) return false;
    if (f.executionMonth?.length && !f.executionMonth.includes(r.executionMonth)) return false;
    if (f.weekPlanFact?.length && (r.weekPlanFact == null || !f.weekPlanFact.includes(r.weekPlanFact))) return false;
    if (f.executorId?.length && !f.executorId.includes(r.executorId)) return false;
    if (f.projectId?.length && !f.projectId.includes(r.projectId)) return false;
    if (f.workTypeId?.length && !f.workTypeId.includes(r.workTypeId)) return false;
    if (f.workStatus?.length && !f.workStatus.includes(r.workStatus)) return false;
    if (f.projectType?.length && !f.projectType.includes(r.projectType)) return false;
    if (f.workTypeSegment?.length && !f.workTypeSegment.includes(r.workTypeSegment)) return false;
    if (f.executorType?.length && !f.executorType.includes(r.executorType)) return false;
    if (f.sourceType?.length && !f.sourceType.includes(r.sourceType)) return false;
    if (f.responsibleExecutorId?.length && (r.responsibleExecutorId == null || !f.responsibleExecutorId.includes(r.responsibleExecutorId))) return false;
    return true;
  });
}
