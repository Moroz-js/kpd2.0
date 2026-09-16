/**
 * BankAccountService (TDNB-23).
 *
 * Особенности:
 * - Единственный active `BankAccount.isDefault = true` в системе (см. ТЗ §Дефолтный счёт).
 *   Изменения `isDefault` оборачиваем в транзакцию, которая снимает флаг у других active.
 * - Архивация дефолтного счёта → сбрасывает isDefault в false.
 * - До импорта «Робот» агрегаты по BankOperation (E, G) = 0.
 */

import { prisma } from "@/lib/db";
import { logActivity, diff } from "@/lib/audit/log";

export type BankAccountListRow = {
  id: string;
  name: string; // A
  details: string | null;
  comment: string | null;
  currency: string; // код валюты (RUB | USD | EUR | GEL | ...)
  statementFormat: string;
  status: string; // B
  isDefault: boolean;
  paymentCount: number; // C
  chargeCount: number; // D
  operationCount: number; // E
  paymentSum: number; // F
  operationSum: number; // G
  chargeSum: number; // H
  createdAt: Date;
};

export async function listBankAccounts(): Promise<BankAccountListRow[]> {
  const accounts = await prisma.bankAccount.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          payments: true,
          charges: true,
          bankOperations: true,
        },
      },
    },
  });

  // Aggregates по факту: SUM payments WHERE paid; SUM charges WHERE paid; SUM all operations.
  // payments — только из view (но для счёта используется personal payments + other-expense payments).
  // Для простоты Phase 1 берём из обеих таблиц через две aggregate query на счёт.
  const ids = accounts.map((a) => a.id);

  const [paymentSums, otherPaymentSums, chargeSums, opSums] = await Promise.all([
    prisma.payment.groupBy({
      by: ["bankAccountId"],
      where: { bankAccountId: { in: ids }, paymentStatus: "paid" },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.otherExpense.groupBy({
      by: ["bankAccountId"],
      where: { bankAccountId: { in: ids }, paymentStatus: "paid", paymentAmount: { not: null } },
      _sum: { paymentAmount: true },
      _count: { _all: true },
    }),
    prisma.charge.groupBy({
      by: ["bankAccountId"],
      where: { bankAccountId: { in: ids }, status: "paid" },
      _sum: { amount: true },
    }),
    prisma.bankOperation.groupBy({
      by: ["bankAccountId"],
      where: { bankAccountId: { in: ids } },
      _sum: { amount: true },
    }),
  ]);

  const paymentSumMap = new Map(paymentSums.map((p) => [p.bankAccountId, p._sum.amount ?? 0]));
  const otherPaymentSumMap = new Map(
    otherPaymentSums.map((p) => [p.bankAccountId, p._sum.paymentAmount ?? 0])
  );
  const chargeSumMap = new Map(chargeSums.map((c) => [c.bankAccountId, c._sum.amount ?? 0]));
  const opSumMap = new Map(opSums.map((o) => [o.bankAccountId, o._sum.amount ?? 0]));

  // payment-counts из обеих таблиц (для C)
  const otherPaymentCountMap = new Map(
    otherPaymentSums.map((p) => [p.bankAccountId, p._count._all])
  );

  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    details: a.details,
    comment: a.comment,
    currency: a.currency,
    statementFormat: a.statementFormat,
    status: a.status,
    isDefault: a.isDefault,
    paymentCount: a._count.payments + (otherPaymentCountMap.get(a.id) ?? 0),
    chargeCount: a._count.charges,
    operationCount: a._count.bankOperations,
    paymentSum: (paymentSumMap.get(a.id) ?? 0) + (otherPaymentSumMap.get(a.id) ?? 0),
    operationSum: opSumMap.get(a.id) ?? 0,
    chargeSum: chargeSumMap.get(a.id) ?? 0,
    createdAt: a.createdAt,
  }));
}

export type CreateBankAccountInput = {
  name: string;
  details?: string;
  comment?: string | null;
  currency?: string;
  statementFormat?: string;
  isDefault?: boolean;
  status?: string;
};

export async function createBankAccount(
  input: CreateBankAccountInput,
  userId: string
) {
  const created = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.bankAccount.updateMany({
        where: { isDefault: true, status: "active" },
        data: { isDefault: false },
      });
    }
    return tx.bankAccount.create({
      data: {
        name: input.name.trim(),
        details: input.details?.trim() || null,
        comment: input.comment?.trim() || null,
        currency: (input.currency ?? "RUB").trim().toUpperCase(),
        statementFormat: input.statementFormat ?? "ru",
        isDefault: !!input.isDefault,
        status: input.status ?? "active",
      },
    });
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "BankAccount",
    entityId: created.id,
    entityLabel: created.name,
  });

  return created;
}

export type UpdateBankAccountInput = {
  name?: string;
  details?: string | null;
  comment?: string | null;
  currency?: string;
  statementFormat?: string;
  isDefault?: boolean;
};

export async function updateBankAccount(
  id: string,
  patch: UpdateBankAccountInput,
  userId: string
) {
  const before = await prisma.bankAccount.findUnique({ where: { id } });
  if (!before) throw new Error("Bank account not found");

  if (before.isDefault && patch.isDefault === false) {
    throw new Error("Cannot unset the default account — assign another account as default first");
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (patch.isDefault) {
      await tx.bankAccount.updateMany({
        where: { isDefault: true, status: "active", id: { not: id } },
        data: { isDefault: false },
      });
    }
    return tx.bankAccount.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.details !== undefined && { details: patch.details?.trim() || null }),
        ...(patch.comment !== undefined && { comment: patch.comment?.trim() || null }),
        ...(patch.currency !== undefined && { currency: patch.currency.trim().toUpperCase() }),
        ...(patch.statementFormat !== undefined && { statementFormat: patch.statementFormat }),
        ...(patch.isDefault !== undefined && { isDefault: patch.isDefault }),
      },
    });
  });

  const changes = diff(before as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  if (Object.keys(changes).length > 0) {
    await logActivity({
      userId,
      action: "update",
      entityType: "BankAccount",
      entityId: id,
      entityLabel: updated.name,
      changes,
    });
  }

  return updated;
}

export async function archiveBankAccount(id: string, userId: string) {
  const before = await prisma.bankAccount.findUnique({ where: { id } });
  if (!before) throw new Error("Bank account not found");

  const updated = await prisma.bankAccount.update({
    where: { id },
    data: { status: "archived", isDefault: false },
  });

  await logActivity({
    userId,
    action: "archive",
    entityType: "BankAccount",
    entityId: id,
    entityLabel: updated.name,
  });

  return updated;
}

export async function unarchiveBankAccount(id: string, userId: string) {
  const before = await prisma.bankAccount.findUnique({ where: { id } });
  if (!before) throw new Error("Bank account not found");

  const updated = await prisma.bankAccount.update({
    where: { id },
    data: { status: "active" },
  });

  await logActivity({
    userId,
    action: "unarchive",
    entityType: "BankAccount",
    entityId: id,
    entityLabel: updated.name,
  });

  return updated;
}
