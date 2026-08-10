/**
 * Audit-log сервис (TDNB-32).
 *
 * Вызывается из всех мутирующих сервисов (Work, Payment, OtherExpense, и т.д.)
 * после успешной мутации в той же транзакции (или сразу после).
 *
 * `changes` сериализуется в JSON-строку (sqlite не поддерживает Json напрямую через Prisma).
 */

import { prisma } from "@/lib/db";

export type ActivityAction =
  | "create"
  | "update"
  | "delete"
  | "archive"
  | "unarchive"
  | "status_change"
  | "access_grant"
  | "access_revoke"
  | "password_reset"
  | "approve";

export type ActivityEntityType =
  | "Work"
  | "Payment"
  | "OtherExpense"
  | "Charge"
  | "Order"
  | "Project"
  | "Client"
  | "Executor"
  | "BankAccount"
  | "WorkType"
  | "VacationEntry"
  | "Task"
  | "SpendingPlanLine"
  | "CashflowManualBalance"
  | "User";

export type FieldDiff = Record<string, { from: unknown; to: unknown }>;

export type LogActivityInput = {
  userId: string;
  action: ActivityAction;
  entityType: ActivityEntityType;
  entityId: string;
  entityLabel?: string | null;
  changes?: FieldDiff | null;
};

/**
 * Логирование — fail-safe: бизнес-операция не должна падать из-за проблем с аудитом
 * (например, FK violation если userId из устаревшей сессии после reset БД,
 * недоступность таблицы и т.п.). Все ошибки идут в console.warn.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        entityLabel: input.entityLabel ?? null,
        changes: input.changes ? JSON.stringify(input.changes) : null,
      },
    });
  } catch (e) {
    console.warn("[audit] logActivity failed (non-fatal):", {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Вычисляет diff между двумя версиями объекта.
 * Игнорирует поля из `skip` (по умолчанию: id, createdAt, updatedAt, password).
 */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  skip: string[] = ["id", "createdAt", "updatedAt", "password"]
): FieldDiff {
  const result: FieldDiff = {};
  const skipSet = new Set(skip);

  for (const key of Object.keys(after)) {
    if (skipSet.has(key)) continue;
    const fromVal = before[key];
    const toVal = (after as Record<string, unknown>)[key];
    if (!equals(fromVal, toVal)) {
      result[key] = { from: fromVal, to: toVal };
    }
  }
  return result;
}

function equals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a == null || b == null) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}
