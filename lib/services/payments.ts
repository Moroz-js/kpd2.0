/**
 * PaymentService — создание/редактирование выплат (TDNB-15 / KPD-284).
 *
 * createPaymentFromWorks — формирование выплаты из проверенных работ
 * createManualPayment    — «Добавить выплату» (без работ)
 * setPaymentWorkLinks    — управление связями выплата↔работы (attach/detach)
 * markPaymentPaid        — оплата выплаты + каскад на привязанные работы
 * propagatePlanDate      — каскад «Дата оплаты план» на привязанные работы
 */
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/audit/log";
import { parseLocalDateInput } from "@/lib/date-string";
import { nearestPaymentDate } from "@/lib/iso-weeks";
import { allocateEntityNumber, withNumberedTransaction } from "@/lib/services/entity-numbering";

// Возвращает defaultBankAccountId исполнителя → глобальный дефолт → null
async function resolveDefaultBank(executorId: string): Promise<string | null> {
  const exec = await prisma.executor.findUnique({
    where: { id: executorId },
    select: { defaultBankAccountId: true },
  });
  if (exec?.defaultBankAccountId) return exec.defaultBankAccountId;

  const global = await prisma.bankAccount.findFirst({
    where: { isDefault: true, status: "active" },
    select: { id: true },
  });
  return global?.id ?? null;
}

// ─── §4 Формирование выплаты из проверенных работ ───────────────────────────

/**
 * Создаёт одну выплату на переданные проверенные непривязанные работы и
 * проставляет двустороннюю связь. KPD-284 §4.
 */
export async function createPaymentFromWorks(
  executorId: string,
  workIds: string[],
  userId: string
) {
  const works = await prisma.work.findMany({
    where: { id: { in: workIds }, executorId },
    select: { id: true, amount: true, workStatus: true, paymentId: true },
  });
  if (works.length === 0) {
    throw new Error("Нет работ для формирования выплаты");
  }
  if (works.length !== workIds.length) {
    throw new Error("Некоторые работы не найдены");
  }
  for (const w of works) {
    if (w.paymentId) {
      throw new Error("Среди выбранных есть работа, уже привязанная к выплате");
    }
    if (w.workStatus !== "checked") {
      throw new Error("Сформировать выплату можно только из проверенных работ");
    }
  }

  const amount = works.reduce((s, w) => s + w.amount, 0);
  const bankAccountId = await resolveDefaultBank(executorId);
  const plannedPayAt = nearestPaymentDate();

  const payment = await withNumberedTransaction(async (tx) => {
    const number = await allocateEntityNumber(tx, "payout", plannedPayAt.getFullYear());
    const p = await tx.payment.create({
      data: {
        payoutNumber: number.number,
        payoutNumberYear: number.year,
        payoutNumberSerial: number.serial,
        executorId,
        periodYear: plannedPayAt.getFullYear(),
        periodMonth: plannedPayAt.getMonth() + 1,
        amount,
        paymentStatus: "planned",
        bankAccountId,
        plannedPayAt,
      },
    });
    await tx.work.updateMany({
      where: { id: { in: workIds } },
      data: { paymentId: p.id, plannedPayAt },
    });
    return p;
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "Payment",
    entityId: payment.id,
    entityLabel: `Выплата на ${works.length} работ`,
  });

  return payment;
}

// ─── §5 Управление связями выплата ↔ работы (attach/detach) ─────────────────

export async function setPaymentWorkLinks(
  executorId: string,
  paymentId: string,
  links: { add?: string[]; remove?: string[] },
  userId: string
) {
  const add = links.add ?? [];
  const remove = links.remove ?? [];

  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.executorId !== executorId) throw new Error("Выплата не найдена");
  if (payment.paymentStatus === "paid") {
    throw new Error("Чтобы изменить список привязанных работ, смените статус выплаты на «запланирована» (если она ещё не оплачена)");
  }

  await prisma.$transaction(async (tx) => {
    if (add.length > 0) {
      const works = await tx.work.findMany({
        where: { id: { in: add }, executorId },
        select: { id: true, workStatus: true, paymentId: true },
      });
      if (works.length !== add.length) throw new Error("Некоторые работы не найдены");
      for (const w of works) {
        if (w.paymentId && w.paymentId !== paymentId) {
          throw new Error("Работа уже привязана к другой выплате");
        }
        if (w.workStatus !== "checked" && w.workStatus !== "paid") {
          throw new Error("Привязать можно только проверенную работу");
        }
      }
      await tx.work.updateMany({
        where: { id: { in: add } },
        data: { paymentId, plannedPayAt: payment.plannedPayAt },
      });
    }
    if (remove.length > 0) {
      await tx.work.updateMany({
        where: { id: { in: remove }, paymentId },
        data: { paymentId: null },
      });
    }
    const linked = await tx.work.findMany({
      where: { paymentId },
      select: { amount: true },
    });
    const amount = linked.reduce((s, w) => s + w.amount, 0);
    await tx.payment.update({ where: { id: paymentId }, data: { amount } });
  });

  await logActivity({
    userId,
    action: "update",
    entityType: "Payment",
    entityId: paymentId,
    entityLabel: `Состав выплаты ${payment.periodMonth}/${payment.periodYear}`,
  });
}

// ─── Ручное создание («Добавить выплату») ───────────────────────────────────

export type CreateManualPaymentInput = {
  executorId: string;
  periodYear: number;
  periodMonth: number;
  amount: number;
  paymentStatus?: string;
  bankAccountId?: string | null;
  plannedPayAt?: string | null;
  paidAt?: string | null;
  comment?: string | null;
};

export async function createManualPayment(
  input: CreateManualPaymentInput,
  userId: string
) {
  const bankAccountId =
    input.bankAccountId !== undefined
      ? input.bankAccountId
      : await resolveDefaultBank(input.executorId);

  const payment = await withNumberedTransaction(async (tx) => {
    const number = await allocateEntityNumber(tx, "payout", input.periodYear);
    return tx.payment.create({
      data: {
        payoutNumber: number.number,
        payoutNumberYear: number.year,
        payoutNumberSerial: number.serial,
        executorId: input.executorId,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        amount: input.amount,
        paymentStatus: input.paymentStatus ?? "planned",
        bankAccountId,
        plannedPayAt: input.plannedPayAt
          ? parseLocalDateInput(input.plannedPayAt)
          : nearestPaymentDate(),
        paidAt: input.paidAt ? parseLocalDateInput(input.paidAt) : null,
        comment: input.comment ?? null,
      },
    });
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "Payment",
    entityId: payment.id,
    entityLabel: `Выплата ${input.periodMonth}/${input.periodYear}`,
  });

  return payment;
}

// ─── Редактирование (без смены статуса на paid) ───────────────────────────

export type UpdatePaymentInput = {
  amount?: number;
  paymentStatus?: string;
  bankAccountId?: string | null;
  plannedPayAt?: string | null;
  paidAt?: string | null;
  comment?: string | null;
  periodYear?: number;
  periodMonth?: number;
  filledTechTask?: string | null;
  filledAct?: string | null;
};

export async function updatePayment(
  paymentId: string,
  patch: UpdatePaymentInput,
  userId: string
) {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { works: { select: { id: true } } },
  });
  const hasWorks = payment.works.length > 0;
  const fromStatus = payment.paymentStatus;
  const toStatus = patch.paymentStatus;

  // §5: сумма выплаты с привязанными работами = сумме работ и не редактируется вручную
  if (patch.amount !== undefined && hasWorks && patch.amount !== payment.amount) {
    throw new Error("Сумма выплаты с привязанными работами равна сумме работ и не редактируется");
  }

  // §5: каскады по смене статуса выплаты на привязанные работы
  if (toStatus && toStatus !== fromStatus) {
    if (toStatus === "paid") {
      await markPaymentPaid(paymentId, patch.paidAt ? new Date(patch.paidAt) : new Date(), userId);
    } else if (toStatus === "planned") {
      // paid → planned: работы из «оплачено» возвращаются в «проверена»
      const wasPaidLike = fromStatus === "paid";
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: paymentId },
          data: { paymentStatus: "planned", ...(wasPaidLike && { paidAt: null }) },
        });
        await tx.work.updateMany({
          where: { paymentId, workStatus: "paid" },
          data: { workStatus: "checked", ...(wasPaidLike && { paidAt: null }) },
        });
      });
    }
  }

  // Каскад «Дата оплаты план» на привязанные работы
  if (patch.plannedPayAt !== undefined) {
    const planDate = patch.plannedPayAt ? parseLocalDateInput(patch.plannedPayAt) : null;
    await propagatePlanDate(paymentId, planDate, userId);
  }

  // Правка даты оплаты без смены статуса (корректировка уже оплаченной)
  if (patch.paidAt !== undefined && !toStatus) {
    if (patch.paidAt) {
      await markPaymentPaid(paymentId, new Date(patch.paidAt), userId);
    } else {
      await prisma.payment.update({ where: { id: paymentId }, data: { paidAt: null } });
    }
  }

  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: {
      ...(patch.amount !== undefined && !hasWorks && { amount: patch.amount }),
      ...(patch.bankAccountId !== undefined && { bankAccountId: patch.bankAccountId }),
      ...(patch.comment !== undefined && { comment: patch.comment }),
      ...(patch.periodYear !== undefined && { periodYear: patch.periodYear }),
      ...(patch.periodMonth !== undefined && { periodMonth: patch.periodMonth }),
      ...(patch.filledTechTask !== undefined && { filledTechTask: patch.filledTechTask }),
      ...(patch.filledAct !== undefined && { filledAct: patch.filledAct }),
    },
  });

  await logActivity({
    userId,
    action: "update",
    entityType: "Payment",
    entityId: paymentId,
    entityLabel: `Выплата ${payment.periodMonth}/${payment.periodYear}`,
  });

  return updated;
}

// ─── Оплата выплаты + каскад на привязанные работы ──────────────────────────

export async function markPaymentPaid(
  paymentId: string,
  paidAt: Date,
  userId: string
) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: { paymentStatus: "paid", paidAt },
    });

    // §5: все привязанные работы → «оплачено»
    await tx.work.updateMany({
      where: { paymentId },
      data: { workStatus: "paid", paidAt },
    });
  });

  await logActivity({
    userId,
    action: "status_change",
    entityType: "Payment",
    entityId: paymentId,
    entityLabel: `Выплата ${payment.periodMonth}/${payment.periodYear}`,
    changes: { paymentStatus: { from: payment.paymentStatus, to: "paid" } },
  });
}

// ─── §1.12 Смена плана выплаты ─────────────────────────────────────────────

export async function propagatePlanDate(
  paymentId: string,
  plannedPayAt: Date | null,
  userId: string
) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: paymentId }, data: { plannedPayAt } });

    // §1.12 — каскад на все связанные работы (по paymentId), кроме оплаченных
    await tx.work.updateMany({
      where: { paymentId, workStatus: { not: "paid" } },
      data: { plannedPayAt },
    });
  });

  await logActivity({
    userId,
    action: "update",
    entityType: "Payment",
    entityId: paymentId,
    entityLabel: `Выплата ${payment.periodMonth}/${payment.periodYear}`,
    changes: { plannedPayAt: { from: payment.plannedPayAt, to: plannedPayAt } },
  });
}

// ─── Удаление выплаты (только admin, через TDNB-17) ───────────────────────

export async function deletePaymentForExecutor(paymentId: string, userId: string) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

  await prisma.$transaction(async (tx) => {
    // Снять paymentId у связанных работ + откатить статус оплаты (остаются «проверена»)
    await tx.work.updateMany({
      where: { paymentId },
      data: { paymentId: null, workStatus: "checked", paidAt: null },
    });

    await tx.payment.delete({ where: { id: paymentId } });
  });

  await logActivity({
    userId,
    action: "delete",
    entityType: "Payment",
    entityId: paymentId,
    entityLabel: `Выплата ${payment.periodMonth}/${payment.periodYear}`,
  });
}
