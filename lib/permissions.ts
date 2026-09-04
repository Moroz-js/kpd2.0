/**
 * Permissions — единый набор проверок прав.
 *
 * Принципы (см. TZ §Глобальные правила, TDNB-15, TDNB-29):
 * - admin — всегда «да».
 * - responsible (PM) — только в проектах, где `Project.responsibleUserId = currentUser.id`.
 * - executor — только свои данные (`Work.executorId === user.executorId` и т.п.).
 * - Доступ executor отзывается через `Executor.accessRevokedAt`.
 */

import { prisma } from "@/lib/db";
import { normalizeExecutorType } from "@/lib/executor-type";

export type SessionLike = {
  id: string;
  role: string;
  isSuperAdmin?: boolean;
  executorId?: string | null;
  executorType?: string | null;
  isResponsible?: boolean;
  responsibleActive?: boolean;
};

export type ProjectLike = { responsibleUserId: string | null };
export type WorkLike = { executorId: string; projectId: string };

// ────────────────────── Базовые ─────────────────────────────

export function isAdmin(user: SessionLike | null | undefined): boolean {
  return user?.role === "admin";
}

export function isSuperAdmin(user: SessionLike | null | undefined): boolean {
  return user?.role === "admin" && user?.isSuperAdmin === true;
}

/** Сбрасывать пароль супер-администратора может только супер-администратор. */
export function canResetUserPassword(
  actor: SessionLike | null | undefined,
  targetId: string,
  targetIsSuperAdmin: boolean,
): boolean {
  if (!actor) return false;
  if (targetIsSuperAdmin) return isSuperAdmin(actor);
  if (actor.id === targetId) return isSuperAdmin(actor);
  return isAdmin(actor);
}

/** Назначать/снимать роль admin — только супер-админ. */
export function canManageAdmins(user: SessionLike | null | undefined): boolean {
  return isSuperAdmin(user);
}

export function isResponsible(user: SessionLike | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "responsible") return user.responsibleActive !== false;
  return (
    user.role === "executor" &&
    user.isResponsible === true &&
    user.responsibleActive !== false
  );
}

export function isExecutor(user: SessionLike | null | undefined): boolean {
  return user?.role === "executor";
}

/** Постоянный исполнитель: role=executor + type=permanent. */
export function isPermanentExecutor(
  user: SessionLike | null | undefined,
  executor?: { type: string } | null
): boolean {
  if (!user || user.role !== "executor") return false;
  const type = executor?.type ?? user.executorType;
  if (!type) return false;
  return normalizeExecutorType(type) === "permanent";
}

// ────────────────────── Проекты ─────────────────────────────

export function canViewProject(user: SessionLike, project: ProjectLike): boolean {
  if (isAdmin(user)) return true;
  if (isResponsible(user)) return project.responsibleUserId === user.id;
  return false;
}

export function canManageSpendingPlan(user: SessionLike, project: ProjectLike): boolean {
  if (isAdmin(user)) return true;
  return isResponsible(user) && project.responsibleUserId === user.id;
}

// ────────────────────── Работы ─────────────────────────────

export function canViewWork(
  user: SessionLike,
  work: WorkLike,
  project: ProjectLike
): boolean {
  if (isAdmin(user)) return true;
  if (isResponsible(user)) return project.responsibleUserId === user.id;
  if (isExecutor(user)) return !!user.executorId && work.executorId === user.executorId;
  return false;
}

export function canEditWork(
  user: SessionLike,
  work: { executorId: string; workStatus: string }
): boolean {
  if (isAdmin(user)) return true;
  if (work.workStatus === "checked") return false; // только admin
  if (isExecutor(user)) return !!user.executorId && work.executorId === user.executorId;
  return false;
}

// ────────────────────── Исполнители ─────────────────────────

/**
 * Может ли user смотреть Личную смету исполнителя `executorId`.
 * Требует активного доступа: accessEmail, User.isActive и пустой accessRevokedAt.
 */
export async function canViewExecutorEstimate(
  user: SessionLike,
  executorId: string
): Promise<boolean> {
  const exec = await prisma.executor.findUnique({
    where: { id: executorId },
    select: {
      accessEmail: true,
      accessRevokedAt: true,
      status: true,
      user: { select: { isActive: true } },
    },
  });
  const hasActiveEstimate =
    !!exec?.accessEmail?.trim() &&
    exec.accessRevokedAt == null &&
    exec.status === "active" &&
    exec.user?.isActive === true;

  if (isAdmin(user)) return hasActiveEstimate;

  // Личную смету видит только её владелец (любая роль с привязанным executorId).
  // PM и постоянный исполнитель НЕ видят чужие сметы (см. спеку RBAC).
  return user.executorId === executorId && hasActiveEstimate;
}

// ────────────────────── Исполнители (раздел/настройки) ───────

/** Видит раздел «Исполнители»: только admin и PM (соответствует навигации). */
export function canViewExecutorsList(user: SessionLike | null | undefined): boolean {
  return isAdmin(user) || isResponsible(user);
}

/** Создаёт исполнителей: только admin и PM. */
export function canManageExecutors(user: SessionLike | null | undefined): boolean {
  return isAdmin(user) || isResponsible(user);
}

/**
 * Редактирует настройки исполнителя.
 * admin — всё; PM — всех; executor (permanent + external-person) — только себя.
 * Admin-only поля (пароль, тип, роль ответственного) ограничены в API/UI.
 */
export function canEditExecutorSettings(user: SessionLike | null | undefined): boolean {
  return isAdmin(user) || isResponsible(user) || isExecutor(user);
}

/** Сброс/генерация пароля другому пользователю — только admin. */
export function canResetPassword(user: SessionLike | null | undefined): boolean {
  return isAdmin(user);
}

// ────────────────────── Личный профиль ───────────────────────

/** Пункт «Личный профиль» доступен, если к юзеру привязан исполнитель. */
export function canAccessProfile(user: SessionLike | null | undefined): boolean {
  return !!user?.executorId;
}

/** Владелец профиля — видит все вкладки (смета, долг, отпуска, настройки). */
export function isProfileOwner(
  user: SessionLike | null | undefined,
  executorId: string
): boolean {
  return !!user?.executorId && user.executorId === executorId;
}

// ────────────────────── Прочие траты ────────────────────────

/** Доступ к разделу «Прочие траты»: admin, PM, постоянный исполнитель. */
export function canAccessOtherExpenses(user: SessionLike | null | undefined): boolean {
  return isAdmin(user) || isResponsible(user) || isPermanentExecutor(user);
}

/**
 * Редактирование строки прочих трат.
 * admin — всегда; остальные — создатель или ответственный, и только пока выплата
 * не «Оплачено».
 */
export function canEditOtherExpense(
  user: SessionLike,
  row: {
    createdById: string;
    responsibleExecutorId?: string | null;
    workStatus?: string | null;
    paymentStatus?: string | null;
  }
): boolean {
  if (isAdmin(user)) return true;
  if (!canAccessOtherExpenses(user)) return false;
  if (row.workStatus === "paid") return false;
  if (row.paymentStatus === "paid") return false;
  // РП может редактировать в том числе при checked
  if (user.executorId && row.responsibleExecutorId && row.responsibleExecutorId === user.executorId) return true;
  // Создатель — только до проверки
  if (row.workStatus === "checked") return false;
  return row.createdById === user.id;
}

/**
 * Проверка строки прочих трат («Проверить» → «Проверено» + создание выплаты).
 * admin — всегда; ответственный по строке (РП своих исполнителей) — пока работа
 * не проверена/оплачена и выплата ещё не создана.
 */
export function canCheckOtherExpense(
  user: SessionLike,
  row: {
    responsibleExecutorId?: string | null;
    workStatus?: string | null;
    paymentStatus?: string | null;
  }
): boolean {
  if (isAdmin(user)) return true;
  if (!canAccessOtherExpenses(user)) return false;
  if (row.workStatus === "checked" || row.workStatus === "paid") return false;
  if (row.paymentStatus === "paid") return false;
  return !!(user.executorId && row.responsibleExecutorId && row.responsibleExecutorId === user.executorId);
}

/**
 * Откат статуса «Проверено» → «Выставлено»/«На доработку» + удаление выплаты.
 * admin — всегда; ответственный по строке — если выплата ещё не оплачена.
 */
export function canRevertOtherExpenseCheck(
  user: SessionLike,
  row: {
    responsibleExecutorId?: string | null;
    paymentStatus?: string | null;
  }
): boolean {
  if (isAdmin(user)) return true;
  if (row.paymentStatus === "paid") return false;
  if (!canAccessOtherExpenses(user)) return false;
  return !!(user.executorId && row.responsibleExecutorId && row.responsibleExecutorId === user.executorId);
}

/** Удаление строки прочих трат — те же правила, что и редактирование. */
export function canDeleteOtherExpense(
  user: SessionLike,
  row: {
    createdById: string;
    responsibleExecutorId?: string | null;
    workStatus?: string | null;
    paymentStatus?: string | null;
  }
): boolean {
  return canEditOtherExpense(user, row);
}

// ────────────────────── Утилиты ─────────────────────────────

export function assertAdmin(user: SessionLike | null | undefined): void {
  if (!isAdmin(user)) throw new Error("403: Forbidden");
}

export function assertOwnsExecutor(user: SessionLike | null | undefined, executorId: string): void {
  if (!user) throw new Error("401: Unauthorized");
  if (isAdmin(user)) return;
  if (user.executorId !== executorId) throw new Error("403: Forbidden");
}

export function forbidden(): Response {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
