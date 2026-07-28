/**
 * WorkService — CRUD для Work (Личная смета, TDNB-15 / KPD-284).
 */
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/audit/log";
import { nearestPaymentDate } from "@/lib/iso-weeks";
import { resolveProjectManagerExecutorId } from "@/lib/services/projects";
import { allocateEntityNumber, withNumberedTransaction } from "@/lib/services/entity-numbering";

export type CreateWorkInput = {
  projectId: string;
  workTypeId: string;
  executionYear: number;
  executionMonth: number;
  techTask: string;
  report?: string | null;
  link?: string | null;
  volume?: number | null;
  rate?: number | null;
  amount: number;
  plannedPayAt?: string | null;
  responsibleExecutorId?: string | null;
  comment?: string | null;
};

export type UpdateWorkInput = Partial<CreateWorkInput> & {
  workStatus?: string;
  paidAt?: string | null;
};

export async function listWorksForExecutor(executorId: string) {
  return prisma.work.findMany({
    where: { executorId },
    include: {
      project: { select: { id: true, name: true } },
      workType: { select: { id: true, name: true } },
      responsibleExecutor: { select: { id: true, name: true } },
      payment: {
        select: {
          id: true,
          amount: true,
          paymentStatus: true,
          plannedPayAt: true,
          paidAt: true,
          bankAccountId: true,
          bankAccount: { select: { id: true, name: true } },
          comment: true,
        },
      },
    },
    orderBy: [
      { createdAt: "asc" },
    ],
  });
}

export async function createWork(
  executorId: string,
  input: CreateWorkInput,
  userId: string
) {
  // §3 (KPD-284): ответственный по умолчанию — руководитель проекта,
  // статус «работа выставлена», дата оплаты план — ближайшее 5/20 число.
  const responsibleExecutorId =
    input.responsibleExecutorId !== undefined && input.responsibleExecutorId !== null
      ? input.responsibleExecutorId
      : await resolveProjectManagerExecutorId(input.projectId);

  const created = await withNumberedTransaction(async (tx) => {
    const number = await allocateEntityNumber(tx, "issued-work", input.executionYear);
    return tx.work.create({
      data: {
        issuedWorkNumber: number.number,
        issuedWorkNumberYear: number.year,
        issuedWorkNumberSerial: number.serial,
        executorId,
        projectId: input.projectId,
        workTypeId: input.workTypeId,
        executionYear: input.executionYear,
        executionMonth: input.executionMonth,
        techTask: input.techTask,
        report: input.report ?? null,
        link: input.link ?? null,
        volume: input.volume ?? null,
        rate: input.rate ?? null,
        amount: input.amount,
        plannedPayAt: input.plannedPayAt ? new Date(input.plannedPayAt) : nearestPaymentDate(),
        responsibleExecutorId: responsibleExecutorId ?? null,
        workStatus: "submitted",
        comment: input.comment ?? null,
      },
    });
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "Work",
    entityId: created.id,
    entityLabel: `Работа ${created.executionMonth}/${created.executionYear}`,
  });

  return created;
}

export async function updateWork(
  workId: string,
  patch: UpdateWorkInput,
  userId: string
) {
  const before = await prisma.work.findUniqueOrThrow({ where: { id: workId } });
  const amountChanged = patch.amount !== undefined && patch.amount !== before.amount;

  if (amountChanged && before.workStatus === "paid") {
    throw new Error("Сумму оплаченной работы нельзя менять из сметы");
  }

  // §5 (KPD-284): «оплачена» проставляется только автоматически при оплате выплаты
  if (patch.workStatus === "paid" && before.workStatus !== "paid") {
    throw new Error("Статус «работа оплачена» проставляется автоматически при оплате выплаты");
  }

  // §5: у привязанной к выплате работы статус и даты управляются выплатой
  if (before.paymentId) {
    if (patch.workStatus !== undefined && patch.workStatus !== before.workStatus) {
      throw new Error("Отвяжите работу от выплаты, чтобы изменить её статус");
    }
    if (patch.plannedPayAt !== undefined) {
      const next = patch.plannedPayAt ? new Date(patch.plannedPayAt).getTime() : null;
      const prev = before.plannedPayAt ? before.plannedPayAt.getTime() : null;
      if (next !== prev) {
        throw new Error("Дата оплаты план привязанной работы управляется выплатой");
      }
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.work.update({
      where: { id: workId },
      data: {
        ...(patch.projectId !== undefined && { projectId: patch.projectId }),
        ...(patch.workTypeId !== undefined && { workTypeId: patch.workTypeId }),
        ...(patch.executionYear !== undefined && { executionYear: patch.executionYear }),
        ...(patch.executionMonth !== undefined && { executionMonth: patch.executionMonth }),
        ...(patch.techTask !== undefined && { techTask: patch.techTask }),
        ...(patch.report !== undefined && { report: patch.report }),
        ...(patch.link !== undefined && { link: patch.link }),
        ...(patch.volume !== undefined && { volume: patch.volume }),
        ...(patch.rate !== undefined && { rate: patch.rate }),
        ...(patch.amount !== undefined && { amount: patch.amount }),
        ...(patch.plannedPayAt !== undefined && {
          plannedPayAt: patch.plannedPayAt ? new Date(patch.plannedPayAt) : null,
        }),
        ...(patch.responsibleExecutorId !== undefined && {
          responsibleExecutorId: patch.responsibleExecutorId,
        }),
        ...(patch.workStatus !== undefined && { workStatus: patch.workStatus }),
        ...(patch.comment !== undefined && { comment: patch.comment }),
      },
    });

    if (amountChanged && before.paymentId) {
      const linked = await tx.work.findMany({
        where: { paymentId: before.paymentId },
        select: { amount: true },
      });
      const newAmount = linked.reduce((s, w) => s + w.amount, 0);
      await tx.payment.update({
        where: { id: before.paymentId },
        data: { amount: newAmount },
      });
    }

    return row;
  });

  await logActivity({
    userId,
    action: "update",
    entityType: "Work",
    entityId: workId,
    entityLabel: `Работа ${updated.executionMonth}/${updated.executionYear}`,
  });

  return updated;
}

/** §1.5 Процедура «Проверки» — workStatus→checked + checkedAt = now(). */
export async function checkWork(workId: string, userId: string) {
  const work = await prisma.work.findUniqueOrThrow({ where: { id: workId } });

  const updated = await prisma.work.update({
    where: { id: workId },
    data: { workStatus: "checked", checkedAt: new Date() },
  });

  await logActivity({
    userId,
    action: "status_change",
    entityType: "Work",
    entityId: workId,
    entityLabel: `Работа ${work.executionMonth}/${work.executionYear}`,
    changes: { workStatus: { from: work.workStatus, to: "checked" } },
  });

  return updated;
}

/** Дублирование работ: копии со статусом «выставлена», без выплаты и дат проверки/оплаты. */
export async function duplicateWorks(
  executorId: string,
  ids: string[],
  userId: string
) {
  const sources = await prisma.work.findMany({
    where: { id: { in: ids }, executorId },
  });

  if (sources.length !== ids.length) {
    throw new Error("Some works not found for this executor");
  }

  const byId = new Map(sources.map((w) => [w.id, w]));
  const created = [];

  for (const id of ids) {
    const src = byId.get(id)!;
    const copy = await withNumberedTransaction(async (tx) => {
      const number = await allocateEntityNumber(tx, "issued-work", src.executionYear);
      return tx.work.create({
        data: {
          issuedWorkNumber: number.number,
          issuedWorkNumberYear: number.year,
          issuedWorkNumberSerial: number.serial,
          executorId,
          projectId: src.projectId,
          workTypeId: src.workTypeId,
          executionYear: src.executionYear,
          executionMonth: src.executionMonth,
          techTask: src.techTask,
          report: src.report,
          link: src.link,
          volume: src.volume,
          rate: src.rate,
          amount: src.amount,
          responsibleExecutorId: src.responsibleExecutorId,
          comment: src.comment,
          plannedPayAt: src.plannedPayAt,
          workStatus: "submitted",
          paymentId: null,
          paidAt: null,
          checkedAt: null,
        },
      });
    });

    await logActivity({
      userId,
      action: "create",
      entityType: "Work",
      entityId: copy.id,
      entityLabel: `Работа ${copy.executionMonth}/${copy.executionYear} (копия)`,
    });

    created.push(copy);
  }

  return created;
}

/** Удаление с каскадом: пересчитываем Payment.amount, если нет работ — удаляем Payment. */
export async function deleteWork(workId: string, userId: string) {
  const work = await prisma.work.findUniqueOrThrow({ where: { id: workId } });

  await prisma.$transaction(async (tx) => {
    if (work.paymentId) {
      // Снимаем связь перед удалением
      await tx.work.update({ where: { id: workId }, data: { paymentId: null } });

      const remaining = await tx.work.findMany({
        where: { paymentId: work.paymentId },
        select: { amount: true },
      });

      if (remaining.length === 0) {
        await tx.payment.delete({ where: { id: work.paymentId } });
      } else {
        const newAmount = remaining.reduce((s, w) => s + w.amount, 0);
        await tx.payment.update({
          where: { id: work.paymentId },
          data: { amount: newAmount },
        });
      }
    }

    await tx.work.delete({ where: { id: workId } });
  });

  await logActivity({
    userId,
    action: "delete",
    entityType: "Work",
    entityId: workId,
    entityLabel: `Работа ${work.executionMonth}/${work.executionYear}`,
  });
}
