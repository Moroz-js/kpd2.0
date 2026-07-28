/**
 * IssuedWorkService (TDNB-14).
 *
 * Это не отдельная таблица, а сервис обратной записи в источник (Work или OtherExpense)
 * для редактирования view-строки и процедуры «Проверки».
 *
 * §3.7 (Личная смета): обновляются Project, WorkType, plannedPayAt (Дата оплаты план)
 * §3.8 (Прочие траты): обновляются Project, WorkType, executionMonth, executionYear, Executor
 * Удаление в view запрещено — только в источнике.
 * Смена статуса на «Проверено» → checkedAt = now() в источнике.
 */

import { prisma } from "@/lib/db";
import { logActivity, diff } from "@/lib/audit/log";
import type { IssuedWorkSource } from "@/lib/views/issuedWorks";
import { checkOtherExpense, updateOtherExpense } from "@/lib/services/other-expenses";
import { hasOtherExpensePayment } from "@/lib/other-expense-payment";
import { isAdmin, isResponsible, type SessionLike } from "@/lib/permissions";

/**
 * Может ли пользователь рецензировать (менять статус/ответственного/комментарий)
 * строку выставленных работ: admin, РП проекта или текущий «Ответственный» строки
 * (KPD-287/288).
 */
export async function canReviewIssuedSource(
  user: SessionLike,
  sourceType: IssuedWorkSource,
  sourceId: string
): Promise<boolean> {
  if (isAdmin(user)) return true;

  const row =
    sourceType === "personal"
      ? await prisma.work.findUnique({
          where: { id: sourceId },
          select: { responsibleExecutorId: true, project: { select: { responsibleUserId: true } } },
        })
      : await prisma.otherExpense.findUnique({
          where: { id: sourceId },
          select: { responsibleExecutorId: true, project: { select: { responsibleUserId: true } } },
        });
  if (!row) return false;

  if (isResponsible(user) && row.project.responsibleUserId === user.id) return true;
  if (user.executorId && row.responsibleExecutorId === user.executorId) return true;
  return false;
}
function assertSettableWorkStatus(workStatus: string | undefined) {
  if (workStatus === "paid") {
    throw new Error("Статус «Оплачено» проставляется только при выплате");
  }
}

export type IssuedWorkPatch = {
  projectId?: string;
  workTypeId?: string;
  plannedPayAt?: Date | null;
  executionMonth?: number;
  executionYear?: number;
  executorId?: string;
  workStatus?: string;
  responsibleExecutorId?: string | null;
  comment?: string | null;
};

export async function updateIssuedWork(
  sourceType: IssuedWorkSource,
  sourceId: string,
  patch: IssuedWorkPatch,
  userId: string
) {
  if (sourceType === "personal") {
    return updatePersonal(sourceId, patch, userId);
  }
  return updateOther(sourceId, patch, userId);
}

async function updatePersonal(workId: string, patch: IssuedWorkPatch, userId: string) {
  const before = await prisma.work.findUnique({ where: { id: workId } });
  if (!before) throw new Error("Work not found");

  assertSettableWorkStatus(patch.workStatus);
  if (patch.workStatus !== undefined && before.workStatus === "paid") {
    throw new Error("Статус оплаченной работы меняется только через выплату");
  }
  // §5 (KPD-284): у привязанной к выплате работы статус управляется выплатой
  if (
    patch.workStatus !== undefined &&
    patch.workStatus !== before.workStatus &&
    before.paymentId
  ) {
    throw new Error("Отвяжите работу от выплаты, чтобы изменить её статус");
  }

  // §3.7 разрешённые: project, workType, plannedPayAt, status, ответственный, комментарий
  const data: Record<string, unknown> = {};
  if (patch.projectId !== undefined) data.projectId = patch.projectId;
  if (patch.workTypeId !== undefined) data.workTypeId = patch.workTypeId;
  if (patch.plannedPayAt !== undefined) data.plannedPayAt = patch.plannedPayAt;
  if (patch.responsibleExecutorId !== undefined) data.responsibleExecutorId = patch.responsibleExecutorId;
  if (patch.comment !== undefined) data.comment = patch.comment;
  if (patch.workStatus !== undefined) {
    data.workStatus = patch.workStatus;
    if (patch.workStatus === "checked" && before.workStatus !== "checked") {
      data.checkedAt = new Date();
    }
  }

  const updated = await prisma.work.update({ where: { id: workId }, data });

  const changes = diff(
    {
      projectId: before.projectId,
      workTypeId: before.workTypeId,
      plannedPayAt: before.plannedPayAt,
      workStatus: before.workStatus,
      responsibleExecutorId: before.responsibleExecutorId,
      comment: before.comment,
    },
    {
      projectId: updated.projectId,
      workTypeId: updated.workTypeId,
      plannedPayAt: updated.plannedPayAt,
      workStatus: updated.workStatus,
      responsibleExecutorId: updated.responsibleExecutorId,
      comment: updated.comment,
    }
  );
  if (Object.keys(changes).length > 0) {
    await logActivity({
      userId,
      action: patch.workStatus === "checked" ? "status_change" : "update",
      entityType: "Work",
      entityId: workId,
      entityLabel: `Личная смета · ${before.executionYear}.${String(before.executionMonth).padStart(2, "0")}`,
      changes,
    });
  }

  return updated;
}

async function updateOther(otherId: string, patch: IssuedWorkPatch, userId: string) {
  const before = await prisma.otherExpense.findUnique({ where: { id: otherId } });
  if (!before) throw new Error("OtherExpense not found");

  assertSettableWorkStatus(patch.workStatus);
  if (patch.workStatus !== undefined && hasOtherExpensePayment(before.paymentStatus)) {
    throw new Error("Статус работы нельзя менять после создания выплаты");
  }
  if (patch.workStatus !== undefined && before.workStatus === "paid") {
    throw new Error("Статус оплаченной работы меняется только через выплату");
  }

  // Единый путь «Проверено» для прочих трат — создаёт выплату и плановую дату.
  if (patch.workStatus === "checked" && before.workStatus !== "checked") {
    const rest: UpdateOtherExpenseInputFromPatch = {};
    if (patch.projectId !== undefined) rest.projectId = patch.projectId;
    if (patch.workTypeId !== undefined) rest.workTypeId = patch.workTypeId;
    if (patch.executionMonth !== undefined) rest.executionMonth = patch.executionMonth;
    if (patch.executionYear !== undefined) rest.executionYear = patch.executionYear;
    if (patch.executorId !== undefined) rest.executorId = patch.executorId;
    if (patch.plannedPayAt !== undefined) {
      rest.plannedPayAt = patch.plannedPayAt ? patch.plannedPayAt.toISOString() : null;
    }
    if (patch.responsibleExecutorId !== undefined) {
      rest.responsibleExecutorId = patch.responsibleExecutorId ?? undefined;
    }
    if (patch.comment !== undefined) rest.comment = patch.comment;
    // Сначала применяем остальные поля: checkOtherExpense увидит пользовательскую
    // плановую дату и сохранит её либо пересчитает, если она уже прошла.
    if (Object.keys(rest).length > 0) {
      await updateOtherExpense(otherId, rest, userId);
    }
    return checkOtherExpense(otherId, userId);
  }

  return updateOtherExpense(
    otherId,
    {
      ...(patch.projectId !== undefined && { projectId: patch.projectId }),
      ...(patch.workTypeId !== undefined && { workTypeId: patch.workTypeId }),
      ...(patch.executionMonth !== undefined && { executionMonth: patch.executionMonth }),
      ...(patch.executionYear !== undefined && { executionYear: patch.executionYear }),
      ...(patch.executorId !== undefined && { executorId: patch.executorId }),
      ...(patch.plannedPayAt !== undefined && {
        plannedPayAt: patch.plannedPayAt ? patch.plannedPayAt.toISOString() : null,
      }),
      ...(patch.workStatus !== undefined && { workStatus: patch.workStatus }),
      ...(patch.responsibleExecutorId !== undefined && {
        responsibleExecutorId: patch.responsibleExecutorId ?? undefined,
      }),
      ...(patch.comment !== undefined && { comment: patch.comment }),
    },
    userId
  );
}

type UpdateOtherExpenseInputFromPatch = {
  projectId?: string;
  workTypeId?: string;
  executionMonth?: number;
  executionYear?: number;
  executorId?: string;
  plannedPayAt?: string | null;
  responsibleExecutorId?: string;
  comment?: string | null;
};
