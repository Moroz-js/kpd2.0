/**
 * VacationService — CRUD для VacationEntry (TDNB-15 §Вкладка 4).
 */
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/audit/log";

export type CreateVacationInput = {
  startAt: string;
  endAt: string;
  secondStartAt?: string | null;
  secondEndAt?: string | null;
  substituteContacts?: string | null;
};

export type UpdateVacationInput = Partial<CreateVacationInput> & {
  status?: string; // need_approval | approved
};

function calcDays(start: Date, end: Date): number {
  const diff = end.getTime() - start.getTime();
  return Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)) + 1);
}

export async function listVacationsForExecutor(
  executorId: string,
  db: { vacationEntry: { findMany: typeof prisma.vacationEntry.findMany } } = prisma
) {
  return db.vacationEntry.findMany({
    where: { executorId },
    orderBy: { startAt: "asc" },
    include: {
      approvedBy: { select: { id: true, fullName: true } },
    },
  });
}

export async function createVacation(
  executorId: string,
  input: CreateVacationInput,
  userId: string
) {
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  const daysCount = calcDays(startAt, endAt);

  const secondStartAt = input.secondStartAt ? new Date(input.secondStartAt) : null;
  const secondEndAt = input.secondEndAt ? new Date(input.secondEndAt) : null;
  const secondDaysCount =
    secondStartAt && secondEndAt ? calcDays(secondStartAt, secondEndAt) : null;

  // Проверка наложений
  await assertNoOverlap(executorId, startAt, endAt, secondStartAt, secondEndAt);

  const entry = await prisma.vacationEntry.create({
    data: {
      executorId,
      startAt,
      endAt,
      daysCount,
      secondStartAt,
      secondEndAt,
      secondDaysCount,
      substituteContacts: input.substituteContacts ?? null,
      status: "need_approval",
    },
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "VacationEntry",
    entityId: entry.id,
    entityLabel: `Отпуск с ${input.startAt}`,
  });

  return entry;
}

export async function updateVacation(
  entryId: string,
  patch: UpdateVacationInput,
  userId: string
) {
  const entry = await prisma.vacationEntry.findUniqueOrThrow({ where: { id: entryId } });

  const startAt = patch.startAt ? new Date(patch.startAt) : entry.startAt;
  const endAt = patch.endAt ? new Date(patch.endAt) : entry.endAt;
  const daysCount = calcDays(startAt, endAt);

  const secondStartAt =
    patch.secondStartAt !== undefined
      ? patch.secondStartAt
        ? new Date(patch.secondStartAt)
        : null
      : entry.secondStartAt;
  const secondEndAt =
    patch.secondEndAt !== undefined
      ? patch.secondEndAt
        ? new Date(patch.secondEndAt)
        : null
      : entry.secondEndAt;
  const secondDaysCount =
    secondStartAt && secondEndAt ? calcDays(secondStartAt, secondEndAt) : null;

  if (patch.startAt || patch.endAt || patch.secondStartAt || patch.secondEndAt) {
    await assertNoOverlap(entry.executorId, startAt, endAt, secondStartAt, secondEndAt, entryId);
  }

  const updated = await prisma.vacationEntry.update({
    where: { id: entryId },
    data: {
      startAt,
      endAt,
      daysCount,
      secondStartAt,
      secondEndAt,
      secondDaysCount,
      ...(patch.substituteContacts !== undefined && {
        substituteContacts: patch.substituteContacts,
      }),
      // Если изменяются даты — сбрасываем статус в need_approval (для не-admin редактирования)
      ...(patch.status !== undefined
        ? { status: patch.status }
        : patch.startAt || patch.endAt
        ? { status: "need_approval" }
        : {}),
    },
  });

  await logActivity({
    userId,
    action: "update",
    entityType: "VacationEntry",
    entityId: entryId,
    entityLabel: `Отпуск ${entry.id}`,
  });

  return updated;
}

export async function approveVacation(entryId: string, userId: string) {
  const updated = await prisma.vacationEntry.update({
    where: { id: entryId },
    data: { status: "approved", approvedById: userId, approvedAt: new Date() },
  });

  await logActivity({
    userId,
    action: "status_change",
    entityType: "VacationEntry",
    entityId: entryId,
    entityLabel: `Отпуск ${entryId}`,
    changes: { status: { from: "need_approval", to: "approved" } },
  });

  return updated;
}

export async function deleteVacation(entryId: string, userId: string) {
  await prisma.vacationEntry.delete({ where: { id: entryId } });

  await logActivity({
    userId,
    action: "delete",
    entityType: "VacationEntry",
    entityId: entryId,
  });
}

// Проверка наложений периодов отпуска
async function assertNoOverlap(
  executorId: string,
  s1: Date,
  e1: Date,
  s2: Date | null,
  e2: Date | null,
  excludeId?: string
) {
  const existing = await prisma.vacationEntry.findMany({
    where: { executorId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, startAt: true, endAt: true, secondStartAt: true, secondEndAt: true },
  });

  function overlaps(a1: Date, a2: Date, b1: Date, b2: Date) {
    return a1 <= b2 && b1 <= a2;
  }

  for (const v of existing) {
    if (overlaps(s1, e1, v.startAt, v.endAt)) {
      throw new Error("Период пересекается с уже существующим отпуском");
    }
    if (v.secondStartAt && v.secondEndAt && overlaps(s1, e1, v.secondStartAt, v.secondEndAt)) {
      throw new Error("Период пересекается с уже существующим отпуском");
    }
    if (s2 && e2) {
      if (overlaps(s2, e2, v.startAt, v.endAt)) {
        throw new Error("Второй период пересекается с уже существующим отпуском");
      }
      if (v.secondStartAt && v.secondEndAt && overlaps(s2, e2, v.secondStartAt, v.secondEndAt)) {
        throw new Error("Второй период пересекается с уже существующим отпуском");
      }
    }
  }
}
