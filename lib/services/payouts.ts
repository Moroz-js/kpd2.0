/**
 * PayoutService (TDNB-17).
 *
 * Удаление admin'ом → каскад в источник:
 *   Личная смета (Payment): удаляется Payment; у всех связанных Work
 *     - paymentId = NULL
 *     - paidAt = NULL
 *     - workStatus paid → checked
 *   Прочие траты (OtherExpense): очищаются payment-поля
 *     (paymentAmount, plannedPayAt, paidAt, bankAccountId, paymentStatus = "planned")
 *     workStatus paid → checked
 *
 * Редактирование (§4.5 / §4.6) — back-sync в источник.
 */

import { prisma } from "@/lib/db";
import { logActivity, diff } from "@/lib/audit/log";
import type { PayoutSource } from "@/lib/views/payouts";
import {
  clearOtherExpensePayment,
  updateOtherExpense,
} from "@/lib/services/other-expenses";
import { propagatePlanDate } from "@/lib/services/payments";

export type PayoutPatch = {
  /** Personal: Payment.amount. Other-expense: сумма работы (OtherExpense.amount). */
  amount?: number;
  /** Только other-expense: сумма выплаты (OtherExpense.paymentAmount). */
  paymentAmount?: number;
  paymentStatus?: string;
  paidAt?: Date | null;
  plannedPayAt?: Date | null;
  bankAccountId?: string | null;
  comment?: string | null;
  // только для other-expense
  executorId?: string;
  executionMonth?: number;
  executionYear?: number;
};

export async function updatePayout(
  sourceType: PayoutSource,
  sourceId: string,
  patch: PayoutPatch,
  userId: string
) {
  if (sourceType === "personal") {
    return updatePaymentSource(sourceId, patch, userId);
  }
  return updateOtherSource(sourceId, patch, userId);
}

async function updatePaymentSource(paymentId: string, patch: PayoutPatch, userId: string) {
  const before = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { _count: { select: { works: true } } },
  });
  if (!before) throw new Error("Payment not found");

  if (patch.amount !== undefined && before._count.works > 0 && patch.amount !== before.amount) {
    throw new Error(
      "Сумма выплаты привязана к работам. Изменение суммы доступно только через Личную смету исполнителя"
    );
  }

  const data: Record<string, unknown> = {};
  if (patch.amount !== undefined) data.amount = patch.amount;
  if (patch.paymentStatus !== undefined) data.paymentStatus = patch.paymentStatus;
  if (patch.paidAt !== undefined) data.paidAt = patch.paidAt;
  if (patch.bankAccountId !== undefined) data.bankAccountId = patch.bankAccountId;
  if (patch.comment !== undefined) data.comment = patch.comment;

  // §1.12 — смена plannedPayAt каскадно обновляет все неоплаченные выплаты месяца
  if (patch.plannedPayAt !== undefined) {
    await propagatePlanDate(paymentId, patch.plannedPayAt ?? null, userId);
  }

  // Возврат в «Запланировано» → очистить дату оплаты
  if (patch.paymentStatus === "planned" && before.paymentStatus !== "planned") {
    data.paidAt = null;
  }

  const updated = await prisma.payment.update({ where: { id: paymentId }, data });

  // §1.10/1.12 факт-факт: paidAt меняется → каскад на связанные работы
  if (patch.paidAt !== undefined) {
    if (patch.paidAt !== null) {
      await prisma.work.updateMany({
        where: { paymentId },
        data: { paidAt: patch.paidAt, workStatus: "paid" },
      });
    } else {
      // очистка paidAt → откат работ в checked
      await prisma.work.updateMany({
        where: { paymentId, workStatus: "paid" },
        data: { paidAt: null, workStatus: "checked" },
      });
    }
  } else if (patch.paymentStatus === "planned" && before.paymentStatus !== "planned" && before.paidAt) {
    await prisma.work.updateMany({
      where: { paymentId, workStatus: "paid" },
      data: { paidAt: null, workStatus: "checked" },
    });
  }

  const changes = diff(
    {
      amount: before.amount,
      paymentStatus: before.paymentStatus,
      paidAt: before.paidAt,
      plannedPayAt: before.plannedPayAt,
      bankAccountId: before.bankAccountId,
      comment: before.comment,
    },
    {
      amount: updated.amount,
      paymentStatus: updated.paymentStatus,
      paidAt: updated.paidAt,
      plannedPayAt: updated.plannedPayAt,
      bankAccountId: updated.bankAccountId,
      comment: updated.comment,
    }
  );
  if (Object.keys(changes).length > 0) {
    await logActivity({
      userId,
      action: "update",
      entityType: "Payment",
      entityId: paymentId,
      entityLabel: `Выплата · ${before.periodYear}.${String(before.periodMonth).padStart(2, "0")}`,
      changes,
    });
  }

  return updated;
}

async function updateOtherSource(otherId: string, patch: PayoutPatch, userId: string) {
  // amount = сумма работы; paymentAmount = сумма выплаты.
  // Обратная совместимость: если передан только amount — трактуем как обе суммы.
  const workAmount = patch.amount;
  const paymentAmount =
    patch.paymentAmount !== undefined
      ? patch.paymentAmount
      : patch.amount !== undefined
        ? patch.amount
        : undefined;

  if (
    workAmount !== undefined &&
    paymentAmount !== undefined &&
    workAmount !== paymentAmount
  ) {
    throw new Error("Сумма работы и сумма выплаты не равны");
  }

  return updateOtherExpense(
    otherId,
    {
      ...(workAmount !== undefined && { amount: workAmount }),
      ...(paymentAmount !== undefined && { paymentAmount }),
      ...(patch.paymentStatus !== undefined && { paymentStatus: patch.paymentStatus }),
      ...(patch.paidAt !== undefined && {
        paidAt: patch.paidAt ? patch.paidAt.toISOString() : null,
      }),
      ...(patch.plannedPayAt !== undefined && {
        plannedPayAt: patch.plannedPayAt ? patch.plannedPayAt.toISOString() : null,
      }),
      ...(patch.bankAccountId !== undefined && { bankAccountId: patch.bankAccountId }),
      ...(patch.comment !== undefined && { comment: patch.comment }),
      ...(patch.executorId !== undefined && { executorId: patch.executorId }),
      ...(patch.executionMonth !== undefined && { executionMonth: patch.executionMonth }),
      ...(patch.executionYear !== undefined && { executionYear: patch.executionYear }),
    },
    userId
  );
}

export async function deletePayout(
  sourceType: PayoutSource,
  sourceId: string,
  userId: string
) {
  if (sourceType === "personal") {
    return deletePaymentSource(sourceId, userId);
  }
  return clearOtherPaymentFields(sourceId, userId);
}

async function deletePaymentSource(paymentId: string, userId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new Error("Payment not found");

  await prisma.$transaction(async (tx) => {
    // Откатываем работы: paymentId=NULL, paidAt=NULL, paid → checked
    await tx.work.updateMany({
      where: { paymentId, workStatus: "paid" },
      data: { paymentId: null, paidAt: null, workStatus: "checked" },
    });
    await tx.work.updateMany({
      where: { paymentId },
      data: { paymentId: null, paidAt: null },
    });
    await tx.payment.delete({ where: { id: paymentId } });
  });

  await logActivity({
    userId,
    action: "delete",
    entityType: "Payment",
    entityId: paymentId,
    entityLabel: `Выплата · ${payment.periodYear}.${String(payment.periodMonth).padStart(2, "0")}`,
  });

  return { ok: true };
}

async function clearOtherPaymentFields(otherId: string, userId: string) {
  return clearOtherExpensePayment(otherId, userId);
}
