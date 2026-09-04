import { prisma } from "@/lib/db";
import { diff, logActivity } from "@/lib/audit/log";
import {
  captureCashflowCommentValues,
  logCashflowCommentValueChanges,
} from "@/lib/cashflow-comment-activity";
import { nearestPaymentDate, resolvePlannedPayAtOnCheck } from "@/lib/iso-weeks";
import { assertExecutorEligibleForOtherExpense } from "@/lib/executor-personal-estimate";
import {
  hasOtherExpensePayment,
  workStatusFromPaymentStatus,
} from "@/lib/other-expense-payment";
import { allocateEntityNumber, withNumberedTransaction } from "@/lib/services/entity-numbering";

// ─── Типы ─────────────────────────────────────────────────────────────────────

export type CreateOtherExpenseInput = {
  projectId: string;
  executorId: string;
  workTypeId: string;
  responsibleExecutorId: string;
  bankAccountId?: string | null;
  executionYear: number;
  executionMonth: number;
  description: string;
  amount: number;
  paymentAmount?: number | null;
  preferredPayMethod?: string | null;
  plannedPayAt?: string | null;
  paidAt?: string | null;
  comment?: string | null;
};

export type UpdateOtherExpenseInput = Partial<Omit<CreateOtherExpenseInput, "responsibleExecutorId">> & {
  responsibleExecutorId?: string;
  workStatus?: string;
  paymentStatus?: string | null;
};

const AMOUNTS_UNEQUAL = "Сумма работы и сумма выплаты не равны";
const AMOUNTS_POSITIVE = "Сумма работы и сумма выплаты должны быть положительными";

function parseDate(value: string, fieldLabel: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldLabel}: некорректная дата`);
  }
  return date;
}

function assertAmountsConsistent(
  amount: number,
  paymentAmount: number | null,
  paymentStatus: string | null
) {
  if (!hasOtherExpensePayment(paymentStatus) && paymentAmount == null) return;
  if (paymentAmount == null || !(amount > 0) || !(paymentAmount > 0)) {
    throw new Error(AMOUNTS_POSITIVE);
  }
  if (amount !== paymentAmount) {
    throw new Error(AMOUNTS_UNEQUAL);
  }
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listOtherExpenses(opts?: {
  scopeUserId?: string;
  scopeExecutorId?: string | null;
}) {
  const orFilters: Record<string, unknown>[] = [];
  if (opts?.scopeUserId) orFilters.push({ createdById: opts.scopeUserId });
  if (opts?.scopeExecutorId) orFilters.push({ responsibleExecutorId: opts.scopeExecutorId });
  const scoped = opts?.scopeUserId || opts?.scopeExecutorId;
  return prisma.otherExpense.findMany({
    where: scoped ? { OR: orFilters } : undefined,
    include: {
      project: { select: { id: true, name: true, shortName: true } },
      executor: { select: { id: true, name: true } },
      workType: { select: { id: true, name: true, segment: true } },
      responsibleUser: { select: { id: true, fullName: true } },
      responsibleExecutor: { select: { id: true, name: true } },
      bankAccount: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

const otherExpenseInclude = {
  project: { select: { id: true, name: true, shortName: true } },
  executor: { select: { id: true, name: true } },
  workType: { select: { id: true, name: true, segment: true } },
  responsibleUser: { select: { id: true, fullName: true } },
  responsibleExecutor: { select: { id: true, name: true } },
  bankAccount: { select: { id: true, name: true } },
} as const;

type Existing = Awaited<ReturnType<typeof prisma.otherExpense.findUniqueOrThrow>>;

function assertCanChangeWorkStatus(existing: Existing, patch: UpdateOtherExpenseInput) {
  if (patch.workStatus === undefined) return;
  if (patch.workStatus === "checked") {
    throw new Error("Статус «Проверено» устанавливается только через проверку работы");
  }
  if (patch.workStatus === "paid") {
    throw new Error("Статус «Оплачено» устанавливается автоматически при оплате выплаты");
  }
  if (hasOtherExpensePayment(existing.paymentStatus)) {
    // Откат «Проверено» → «Выставлено»/«На доработку» разрешён только если одновременно
    // удаляется выплата (paymentStatus: null) и выплата ещё не отправлена/оплачена.
    const isRevert =
      (patch.workStatus === "submitted" || patch.workStatus === "rework") &&
      existing.paymentStatus === "planned" &&
      patch.paymentStatus === null;
    if (!isRevert) {
      throw new Error("Статус работы нельзя менять после создания выплаты");
    }
  }
}

/** Ответственного нельзя менять после проверки (workStatus checked/paid). */
function assertCanChangeResponsible(existing: Existing, patch: UpdateOtherExpenseInput) {
  if (patch.responsibleExecutorId === undefined) return;
  if (patch.responsibleExecutorId === existing.responsibleExecutorId) return;
  if (existing.workStatus === "checked" || existing.workStatus === "paid") {
    throw new Error("Ответственного нельзя менять после проверки работы");
  }
}

function applyPaymentCascade(
  existing: Existing,
  state: {
    workStatus: string;
    paymentStatus: string | null;
    paymentAmount: number | null;
    plannedPayAt: Date | null;
    paidAt: Date | null;
    checkedAt: Date | null;
  },
  patch: UpdateOtherExpenseInput
) {
  if (patch.plannedPayAt !== undefined) {
    state.plannedPayAt = patch.plannedPayAt
      ? parseDate(patch.plannedPayAt, "Дата оплаты план")
      : null;
  }

  if (patch.paymentAmount !== undefined) {
    state.paymentAmount = patch.paymentAmount;
  }

  if (patch.paymentStatus !== undefined) {
    state.paymentStatus = patch.paymentStatus;
    if (patch.paymentStatus === null) {
      // Удаление выплаты — очищаем платёжные поля; plannedPayAt сохраняем намеренно
      state.paymentAmount = null;
      state.paidAt = null;
      state.checkedAt = null;
      // Не возвращаемся, чтобы patch.workStatus мог применяться дальше
    } else {
      state.workStatus = workStatusFromPaymentStatus(patch.paymentStatus);
      if (patch.paymentStatus === "planned") {
        // Откат на «Запланировано» — убираем дату оплаты
        state.paidAt = null;
        // Создание/пересоздание выплаты: paymentAmount = amount
        if (state.paymentAmount == null) {
          state.paymentAmount = patch.amount ?? existing.amount;
        }
      }
      if (patch.paymentStatus === "paid" && !state.paidAt) {
        state.paidAt = existing.paidAt ?? new Date();
      }
    }
  }

  if (patch.paidAt !== undefined) {
    const nextPaidAt = patch.paidAt ? parseDate(patch.paidAt, "Дата оплаты") : null;
    state.paidAt = nextPaidAt;

    if (!hasOtherExpensePayment(state.paymentStatus)) return;

    if (nextPaidAt) {
      state.paymentStatus = "paid";
      state.workStatus = "paid";
    } else if (existing.paidAt) {
      state.paymentStatus = "planned";
      state.workStatus = "checked";
    }
  }

  if (patch.workStatus !== undefined) {
    state.workStatus = patch.workStatus;
    if (patch.workStatus === "checked" && !state.checkedAt) {
      state.checkedAt = new Date();
    }
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createOtherExpense(
  input: CreateOtherExpenseInput,
  userId: string
) {
  await assertExecutorEligibleForOtherExpense(input.executorId);
  const paidAt = input.paidAt ? parseDate(input.paidAt, "Дата оплаты") : null;
  const amount = input.amount;
  if (!(amount > 0)) throw new Error(AMOUNTS_POSITIVE);

  if (input.paymentAmount != null) {
    assertAmountsConsistent(amount, input.paymentAmount, "planned");
  }
  const paymentAmount = paidAt
    ? (input.paymentAmount ?? amount)
    : null;
  if (paidAt) {
    assertAmountsConsistent(amount, paymentAmount, "paid");
  }

  const plannedPayAt = input.plannedPayAt
    ? parseDate(input.plannedPayAt, "Дата оплаты план")
    : nearestPaymentDate();
  const cashflowCommentValues = await captureCashflowCommentValues();

  const expense = await withNumberedTransaction(async (tx) => {
    const expenseNumber = await allocateEntityNumber(tx, "other-expense", input.executionYear);
    const issuedNumber = await allocateEntityNumber(tx, "issued-work", input.executionYear);
    const payoutNumber = paidAt
      ? await allocateEntityNumber(tx, "payout", input.executionYear)
      : null;

    return tx.otherExpense.create({
      data: {
        otherExpenseNumber: expenseNumber.number,
        otherExpenseNumberYear: expenseNumber.year,
        otherExpenseNumberSerial: expenseNumber.serial,
        issuedWorkNumber: issuedNumber.number,
        issuedWorkNumberYear: issuedNumber.year,
        issuedWorkNumberSerial: issuedNumber.serial,
        ...(payoutNumber && {
          payoutNumber: payoutNumber.number,
          payoutNumberYear: payoutNumber.year,
          payoutNumberSerial: payoutNumber.serial,
        }),
        projectId: input.projectId,
        executorId: input.executorId,
        workTypeId: input.workTypeId,
        responsibleExecutorId: input.responsibleExecutorId,
        bankAccountId: input.bankAccountId ?? null,
        executionYear: input.executionYear,
        executionMonth: input.executionMonth,
        description: input.description,
        amount,
        paymentAmount,
        preferredPayMethod: input.preferredPayMethod ?? null,
        plannedPayAt,
        paidAt,
        checkedAt: paidAt ? new Date() : null,
        comment: input.comment ?? null,
        workStatus: paidAt ? "paid" : "submitted",
        paymentStatus: paidAt ? "paid" : null,
        createdById: userId,
      },
      include: otherExpenseInclude,
    });
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "OtherExpense",
    entityId: expense.id,
    entityLabel: expense.description,
  });
  await logCashflowCommentValueChanges(cashflowCommentValues, userId);

  return expense;
}

/** Копирует прочие траты без статусов, выплаты и фактических дат. */
export async function duplicateOtherExpenses(ids: string[], userId: string) {
  const sources = await prisma.otherExpense.findMany({
    where: { id: { in: ids } },
  });
  if (sources.length !== ids.length) {
    throw new Error("Не найдены все выбранные прочие траты");
  }
  if (sources.some((source) => !source.responsibleExecutorId)) {
    throw new Error("У траты не указан ответственный");
  }

  const sourcesById = new Map(sources.map((expense) => [expense.id, expense]));
  const created = [];
  const cashflowCommentValues = await captureCashflowCommentValues();
  for (const id of ids) {
    const source = sourcesById.get(id)!;
    // Месяц выполнения +1. Плановая оплата — 5-е месяца после план-факт даты
    // исходной записи, а при её отсутствии — после нового месяца выполнения.
    const executionMonth = source.executionMonth === 12 ? 1 : source.executionMonth + 1;
    const executionYear = source.executionMonth === 12 ? source.executionYear + 1 : source.executionYear;
    const sourcePeriod = source.paidAt ?? source.plannedPayAt;
    const plannedPayAt = sourcePeriod
      ? new Date(sourcePeriod.getFullYear(), sourcePeriod.getMonth() + 1, 5)
      : new Date(executionYear, executionMonth, 5);

    const copy = await withNumberedTransaction(async (tx) => {
      const expenseNumber = await allocateEntityNumber(
        tx,
        "other-expense",
        executionYear
      );
      const issuedNumber = await allocateEntityNumber(
        tx,
        "issued-work",
        executionYear
      );
      return tx.otherExpense.create({
        data: {
          otherExpenseNumber: expenseNumber.number,
          otherExpenseNumberYear: expenseNumber.year,
          otherExpenseNumberSerial: expenseNumber.serial,
          issuedWorkNumber: issuedNumber.number,
          issuedWorkNumberYear: issuedNumber.year,
          issuedWorkNumberSerial: issuedNumber.serial,
          projectId: source.projectId,
          executorId: source.executorId,
          workTypeId: source.workTypeId,
          responsibleExecutorId: source.responsibleExecutorId,
          bankAccountId: source.bankAccountId,
          executionYear,
          executionMonth,
          description: source.description,
          amount: source.amount,
          preferredPayMethod: source.preferredPayMethod,
          plannedPayAt,
          comment: source.comment,
          paymentAmount: null,
          paidAt: null,
          checkedAt: null,
          workStatus: "submitted",
          paymentStatus: null,
          createdById: userId,
        },
        include: otherExpenseInclude,
      });
    });

    await logActivity({
      userId,
      action: "create",
      entityType: "OtherExpense",
      entityId: copy.id,
      entityLabel: `${copy.description} (копия)`,
    });
    created.push(copy);
  }
  await logCashflowCommentValueChanges(cashflowCommentValues, userId);

  return created;
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateOtherExpense(
  id: string,
  patch: UpdateOtherExpenseInput,
  userId: string
) {
  const existing = await prisma.otherExpense.findUniqueOrThrow({ where: { id } });
  if (patch.executorId !== undefined) {
    await assertExecutorEligibleForOtherExpense(patch.executorId);
  }
  assertCanChangeWorkStatus(existing, patch);
  assertCanChangeResponsible(existing, patch);

  const state = {
    workStatus: existing.workStatus,
    paymentStatus: existing.paymentStatus,
    paymentAmount: existing.paymentAmount,
    plannedPayAt: existing.plannedPayAt,
    paidAt: existing.paidAt,
    checkedAt: existing.checkedAt,
  };

  applyPaymentCascade(existing, state, patch);

  const amount = patch.amount !== undefined ? patch.amount : existing.amount;
  if (patch.amount !== undefined && !(amount > 0)) {
    throw new Error(AMOUNTS_POSITIVE);
  }
  assertAmountsConsistent(amount, state.paymentAmount, state.paymentStatus);
  const cashflowCommentValues = await captureCashflowCommentValues();

  const updated = await withNumberedTransaction(async (tx) => {
    const hasPayment = hasOtherExpensePayment(state.paymentStatus) && state.paymentAmount != null;
    const payoutNumber = hasPayment && !existing.payoutNumber
      ? await allocateEntityNumber(tx, "payout", patch.executionYear ?? existing.executionYear)
      : null;

    return tx.otherExpense.update({
      where: { id },
      include: otherExpenseInclude,
      data: {
        ...(patch.projectId !== undefined && { projectId: patch.projectId }),
        ...(patch.executorId !== undefined && { executorId: patch.executorId }),
        ...(patch.workTypeId !== undefined && { workTypeId: patch.workTypeId }),
        ...(patch.responsibleExecutorId !== undefined && { responsibleExecutorId: patch.responsibleExecutorId }),
        ...(patch.bankAccountId !== undefined && { bankAccountId: patch.bankAccountId }),
        ...(patch.executionYear !== undefined && { executionYear: patch.executionYear }),
        ...(patch.executionMonth !== undefined && { executionMonth: patch.executionMonth }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.amount !== undefined && { amount: patch.amount }),
        ...(patch.preferredPayMethod !== undefined && { preferredPayMethod: patch.preferredPayMethod }),
        ...(patch.comment !== undefined && { comment: patch.comment }),
        ...(payoutNumber && {
          payoutNumber: payoutNumber.number,
          payoutNumberYear: payoutNumber.year,
          payoutNumberSerial: payoutNumber.serial,
        }),
        ...(!hasPayment && {
          payoutNumber: null,
          payoutNumberYear: null,
          payoutNumberSerial: null,
        }),
        workStatus: state.workStatus,
        paymentStatus: state.paymentStatus,
        paymentAmount: state.paymentAmount,
        plannedPayAt: state.plannedPayAt,
        paidAt: state.paidAt,
        checkedAt: state.checkedAt,
      },
    });
  });

  const changes = diff(
    {
      projectId: existing.projectId,
      executorId: existing.executorId,
      workTypeId: existing.workTypeId,
      responsibleExecutorId: existing.responsibleExecutorId,
      bankAccountId: existing.bankAccountId,
      executionYear: existing.executionYear,
      executionMonth: existing.executionMonth,
      description: existing.description,
      amount: existing.amount,
      paymentAmount: existing.paymentAmount,
      plannedPayAt: existing.plannedPayAt,
      paidAt: existing.paidAt,
      workStatus: existing.workStatus,
      paymentStatus: existing.paymentStatus,
      preferredPayMethod: existing.preferredPayMethod,
      comment: existing.comment,
    },
    {
      projectId: updated.projectId,
      executorId: updated.executorId,
      workTypeId: updated.workTypeId,
      responsibleExecutorId: updated.responsibleExecutorId,
      bankAccountId: updated.bankAccountId,
      executionYear: updated.executionYear,
      executionMonth: updated.executionMonth,
      description: updated.description,
      amount: updated.amount,
      paymentAmount: updated.paymentAmount,
      plannedPayAt: updated.plannedPayAt,
      paidAt: updated.paidAt,
      workStatus: updated.workStatus,
      paymentStatus: updated.paymentStatus,
      preferredPayMethod: updated.preferredPayMethod,
      comment: updated.comment,
    }
  );
  if (Object.keys(changes).length > 0) {
    await logActivity({
      userId,
      action: "update",
      entityType: "OtherExpense",
      entityId: id,
      entityLabel: existing.description,
      changes,
    });
  }
  await logCashflowCommentValueChanges(cashflowCommentValues, userId);

  return updated;
}

// ─── Check ────────────────────────────────────────────────────────────────────

export async function checkOtherExpense(id: string, userId: string) {
  const existing = await prisma.otherExpense.findUniqueOrThrow({ where: { id } });

  if (existing.workStatus === "checked" || existing.workStatus === "paid") {
    throw new Error("Работа уже проверена или оплачена");
  }
  if (hasOtherExpensePayment(existing.paymentStatus)) {
    throw new Error("Выплата уже создана");
  }

  const plannedPayAt = resolvePlannedPayAtOnCheck(existing.plannedPayAt);
  const cashflowCommentValues = await captureCashflowCommentValues();

  const updated = await withNumberedTransaction(async (tx) => {
    const number = existing.payoutNumber
      ? null
      : await allocateEntityNumber(tx, "payout", existing.executionYear);
    return tx.otherExpense.update({
      where: { id },
      include: otherExpenseInclude,
      data: {
        ...(number && {
          payoutNumber: number.number,
          payoutNumberYear: number.year,
          payoutNumberSerial: number.serial,
        }),
        workStatus: "checked",
        checkedAt: new Date(),
        paymentStatus: "planned",
        paymentAmount: existing.amount,
        plannedPayAt,
      },
    });
  });

  await logActivity({
    userId,
    action: "status_change",
    entityType: "OtherExpense",
    entityId: id,
    entityLabel: existing.description,
    changes: {
      workStatus: { from: existing.workStatus, to: "checked" },
      paymentStatus: { from: existing.paymentStatus, to: "planned" },
    },
  });
  await logCashflowCommentValueChanges(cashflowCommentValues, userId);

  return updated;
}

// ─── Revert check (откат с «Проверено» + удаление выплаты) ───────────────────

export async function revertOtherExpenseCheck(
  id: string,
  targetStatus: "submitted" | "rework",
  userId: string
) {
  const existing = await prisma.otherExpense.findUniqueOrThrow({ where: { id } });

  if (existing.workStatus !== "checked") {
    throw new Error("Откат возможен только для работы со статусом «Проверено»");
  }
  if (existing.paymentStatus === "paid") {
    throw new Error("Нельзя откатить: выплата уже оплачена");
  }
  const cashflowCommentValues = await captureCashflowCommentValues();

  const updated = await prisma.otherExpense.update({
    where: { id },
    include: otherExpenseInclude,
    data: {
      workStatus: targetStatus,
      checkedAt: null,
      paymentStatus: null,
      paymentAmount: null,
      payoutNumber: null,
      payoutNumberYear: null,
      payoutNumberSerial: null,
      paidAt: null,
    },
  });

  await logActivity({
    userId,
    action: "status_change",
    entityType: "OtherExpense",
    entityId: id,
    entityLabel: existing.description,
    changes: {
      workStatus: { from: existing.workStatus, to: targetStatus },
      paymentStatus: { from: existing.paymentStatus, to: null },
    },
  });
  await logCashflowCommentValueChanges(cashflowCommentValues, userId);

  return updated;
}

// ─── Clear payment (выплаты: удаление) ───────────────────────────────────────

export async function clearOtherExpensePayment(id: string, userId: string) {
  const existing = await prisma.otherExpense.findUniqueOrThrow({ where: { id } });
  const cashflowCommentValues = await captureCashflowCommentValues();

  const updated = await prisma.otherExpense.update({
    where: { id },
    include: otherExpenseInclude,
    data: {
      paymentAmount: null,
      payoutNumber: null,
      payoutNumberYear: null,
      payoutNumberSerial: null,
      plannedPayAt: null,
      paidAt: null,
      bankAccountId: null,
      paymentStatus: null,
      workStatus: existing.workStatus === "paid" ? "checked" : existing.workStatus,
    },
  });

  await logActivity({
    userId,
    action: "delete",
    entityType: "OtherExpense",
    entityId: id,
    entityLabel: `Прочие траты · ${existing.description.slice(0, 40)} (очищена выплата)`,
  });
  await logCashflowCommentValueChanges(cashflowCommentValues, userId);

  return updated;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteOtherExpense(id: string, userId: string) {
  const existing = await prisma.otherExpense.findUniqueOrThrow({ where: { id } });
  const cashflowCommentValues = await captureCashflowCommentValues();

  await prisma.otherExpense.delete({ where: { id } });

  await logActivity({
    userId,
    action: "delete",
    entityType: "OtherExpense",
    entityId: id,
    entityLabel: existing.description,
  });
  await logCashflowCommentValueChanges(cashflowCommentValues, userId);
}
