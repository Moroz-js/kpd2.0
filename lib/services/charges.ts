import { prisma } from "@/lib/db";
import { diff, logActivity } from "@/lib/audit/log";
import {
  captureCashflowCommentValues,
  logCashflowCommentValueChanges,
} from "@/lib/cashflow-comment-activity";

// ─── Автогенерация номера начисления H001, H002, ... ─────────────────────────

async function nextChargeNumber(): Promise<string> {
  // Числовой max по всем записям без привязки к префиксу (H/Н):
  // лексикографическая сортировка ломается на легаси/импортных номерах.
  const charges = await prisma.charge.findMany({ select: { chargeNumber: true } });
  const maxNum = charges.reduce((max, c) => {
    const n = parseInt(c.chargeNumber.replace(/\D/g, ""), 10) || 0;
    return n > max ? n : max;
  }, 0);
  return `Н${String(maxNum + 1).padStart(3, "0")}`;
}

// ─── Типы ─────────────────────────────────────────────────────────────────────

export type CreateChargeInput = {
  bankAccountId?: string | null;
  orderId?: string | null;
  amount?: number | null;
  issuedPlanAt?: string | null;
  issuedAt?: string | null;
  paidPlanAt?: string | null;
  paidAt?: string | null;
  paymentPurpose?: string | null;
  status?: string;
};

export type UpdateChargeInput = Partial<CreateChargeInput>;

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listCharges() {
  return prisma.charge.findMany({
    include: {
      bankAccount: { select: { id: true, name: true, currency: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          description: true,
          project: {
            select: {
              id: true,
              name: true,
              shortName: true,
              client: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: { chargeNumber: "desc" },
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createCharge(input: CreateChargeInput, userId: string) {
  const chargeNumber = await nextChargeNumber();

  // № счёта: chargeNumber/bankAccount.name, или просто chargeNumber если счёт не выбран
  let invoiceNumber = chargeNumber;
  if (input.bankAccountId) {
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: input.bankAccountId },
      select: { name: true },
    });
    invoiceNumber = `${chargeNumber}/${bankAccount?.name ?? input.bankAccountId}`;
  }

  const paidAt = input.paidAt ? new Date(input.paidAt) : null;
  const cashflowCommentValues = await captureCashflowCommentValues();

  const charge = await prisma.charge.create({
    data: {
      chargeNumber,
      bankAccountId: input.bankAccountId ?? null,
      invoiceNumber,
      orderId: input.orderId ?? null,
      amount: input.amount ?? 0,
      issuedPlanAt: input.issuedPlanAt ? new Date(input.issuedPlanAt) : null,
      issuedAt: input.issuedAt ? new Date(input.issuedAt) : null,
      paidPlanAt: input.paidPlanAt ? new Date(input.paidPlanAt) : null,
      paidAt,
      paymentPurpose: input.paymentPurpose ?? null,
      status: paidAt ? "paid" : (input.status ?? "planned"),
    },
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "Charge",
    entityId: charge.id,
    entityLabel: `${charge.chargeNumber} / ${invoiceNumber}`,
  });
  await logCashflowCommentValueChanges(cashflowCommentValues, userId);

  return charge;
}

/** Копирует начисления без статуса, фактических дат и номера счёта. */
export async function duplicateCharges(ids: string[], userId: string) {
  const sources = await prisma.charge.findMany({ where: { id: { in: ids } } });
  if (sources.length !== ids.length) {
    throw new Error("Не найдены все выбранные начисления");
  }

  const sourcesById = new Map(sources.map((charge) => [charge.id, charge]));
  // Плановая оплата дубликата — 5-е число месяца, следующего от месяца дублирования (не от исходной даты).
  const now = new Date();
  const paidPlanAt = new Date(now.getFullYear(), now.getMonth() + 1, 5);
  const created = [];
  for (const id of ids) {
    const source = sourcesById.get(id)!;
    const copy = await createCharge(
      {
        bankAccountId: source.bankAccountId,
        orderId: source.orderId,
        amount: source.amount,
        issuedPlanAt: source.issuedPlanAt?.toISOString() ?? null,
        paidPlanAt: paidPlanAt.toISOString(),
        paymentPurpose: source.paymentPurpose,
      },
      userId
    );
    created.push(copy);
  }

  return created;
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateCharge(id: string, patch: UpdateChargeInput, userId: string) {
  const existing = await prisma.charge.findUniqueOrThrow({ where: { id } });
  const cashflowCommentValues = await captureCashflowCommentValues();

  const newPaidAt = patch.paidAt !== undefined
    ? (patch.paidAt ? new Date(patch.paidAt) : null)
    : existing.paidAt;

  // Заполнение paidAt → paid; очистка paidAt при статусе paid → to_pay
  // Авто-логика срабатывает только если статус не передан явно
  let status = patch.status ?? existing.status;
  if (patch.status === undefined) {
    if (newPaidAt && !existing.paidAt) {
      status = "paid";
    } else if (!newPaidAt && patch.paidAt !== undefined && status === "paid") {
      status = "to_pay";
    }
  }

  const updated = await prisma.charge.update({
    where: { id },
    data: {
      ...(patch.bankAccountId !== undefined && { bankAccountId: patch.bankAccountId }),
      ...(patch.orderId !== undefined && { orderId: patch.orderId }),
      ...(patch.amount !== undefined && { amount: patch.amount ?? 0 }),
      ...(patch.issuedPlanAt !== undefined && { issuedPlanAt: patch.issuedPlanAt ? new Date(patch.issuedPlanAt) : null }),
      ...(patch.issuedAt !== undefined && { issuedAt: patch.issuedAt ? new Date(patch.issuedAt) : null }),
      ...(patch.paidPlanAt !== undefined && { paidPlanAt: patch.paidPlanAt ? new Date(patch.paidPlanAt) : null }),
      ...(patch.paymentPurpose !== undefined && { paymentPurpose: patch.paymentPurpose }),
      paidAt: newPaidAt,
      status,
    },
    include: {
      bankAccount: { select: { id: true, name: true, currency: true } },
      order: {
        select: {
          id: true, orderNumber: true, description: true,
          project: {
            select: {
              id: true, name: true,
              client: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  const changes = diff(
    {
      bankAccountId: existing.bankAccountId,
      orderId: existing.orderId,
      amount: existing.amount,
      issuedPlanAt: existing.issuedPlanAt,
      issuedAt: existing.issuedAt,
      paidPlanAt: existing.paidPlanAt,
      paidAt: existing.paidAt,
      paymentPurpose: existing.paymentPurpose,
      status: existing.status,
    },
    {
      bankAccountId: updated.bankAccountId,
      orderId: updated.orderId,
      amount: updated.amount,
      issuedPlanAt: updated.issuedPlanAt,
      issuedAt: updated.issuedAt,
      paidPlanAt: updated.paidPlanAt,
      paidAt: updated.paidAt,
      paymentPurpose: updated.paymentPurpose,
      status: updated.status,
    }
  );
  if (Object.keys(changes).length > 0) {
    await logActivity({
      userId,
      action: "update",
      entityType: "Charge",
      entityId: id,
      entityLabel: existing.chargeNumber,
      changes,
    });
  }
  await logCashflowCommentValueChanges(cashflowCommentValues, userId);

  return updated;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteCharge(id: string, userId: string) {
  const existing = await prisma.charge.findUniqueOrThrow({ where: { id } });
  const cashflowCommentValues = await captureCashflowCommentValues();
  await prisma.charge.delete({ where: { id } });
  await logActivity({
    userId,
    action: "delete",
    entityType: "Charge",
    entityId: id,
    entityLabel: existing.chargeNumber,
  });
  await logCashflowCommentValueChanges(cashflowCommentValues, userId);
}
