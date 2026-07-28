import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Личная смета существует в интерфейсе только при заполненном email доступа. */
export function hasPersonalSmeta(executor: { accessEmail: string | null }): boolean {
  return Boolean(executor.accessEmail?.trim());
}

/** Прочие траты: без личной сметы или личная смета с отозванным доступом. */
export function canAssignOtherExpense(executor: {
  status: string;
  accessEmail: string | null;
  accessRevokedAt: Date | null;
  user: { isActive: boolean } | null;
}): boolean {
  if (executor.status !== "active") return false;
  if (!hasPersonalSmeta(executor)) return true;
  return executor.accessRevokedAt != null || !executor.user?.isActive;
}

export const executorWhereForOtherExpense: Prisma.ExecutorWhereInput = {
  status: "active",
  NOT: {
    AND: [
      { accessEmail: { not: null } },
      { accessRevokedAt: null },
      { user: { is: { isActive: true } } },
    ],
  },
};

export async function assertExecutorEligibleForOtherExpense(executorId: string): Promise<void> {
  const executor = await prisma.executor.findUnique({
    where: { id: executorId },
    select: {
      status: true,
      accessEmail: true,
      accessRevokedAt: true,
      user: { select: { isActive: true } },
    },
  });
  if (!executor || !canAssignOtherExpense(executor)) {
    throw new Error(
      "Исполнитель недоступен для прочих трат: нужен без личной сметы или с отозванным доступом"
    );
  }
}
