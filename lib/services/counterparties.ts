/**
 * CounterpartyService — справочник контрагентов.
 *
 * Строка справочника = юридический получатель (конкретное физлицо, конкретное ИП,
 * конкретная компания). Реквизиты — «куда перевести» — лежат списком внутри
 * карточки, написания из выписки — отдельным списком.
 *
 * Особенности:
 * - Ровно одна ссылка из executorId | clientId | bankAccountId. Вкладка
 *   интерфейса (kind) не хранится, а выводится из этой ссылки и типа
 *   исполнителя — хранимое поле разъезжалось бы с карточкой исполнителя.
 * - Написание в выписке уникально в пределах всей базы: если оно висит на двух
 *   контрагентах, автоопределение получит два ответа.
 * - Личная смета существует только у исполнителя с заполненным email доступа
 *   (см. lib/executor-personal-estimate.ts).
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logActivity, diff } from "@/lib/audit/log";
import { normalizeMatchValue } from "@/lib/counterparty-match";
import { inferPaymentMethod } from "@/lib/counterparty-requisites";
import { hasPersonalSmeta } from "@/lib/executor-personal-estimate";
import type { CounterpartyKind } from "@/lib/statuses";

export type CounterpartyRequisiteRow = {
  id: string;
  paymentMethod: string;
  taxId: string | null;
  bic: string | null;
  bankName: string | null;
  accountNumber: string | null;
  cardNumber: string | null;
  status: string;
  comment: string | null;
};

export type CounterpartyAliasRow = {
  id: string;
  value: string;
  source: string;
};

export type CounterpartyListRow = {
  id: string;
  name: string;
  /** Вкладка справочника — выводится из ссылки, в базе не хранится. */
  kind: CounterpartyKind;
  legalType: string | null;
  status: string;
  comment: string | null;
  executorId: string | null;
  executorName: string | null;
  clientId: string | null;
  clientName: string | null;
  bankAccountId: string | null;
  bankAccountName: string | null;
  uniqueProjectId: string | null;
  uniqueProjectName: string | null;
  uniqueWorkTypeId: string | null;
  uniqueWorkTypeName: string | null;
  /** Ссылка на личную смету исполнителя — только если смета существует. */
  personalEstimateUrl: string | null;
  requisites: CounterpartyRequisiteRow[];
  aliases: CounterpartyAliasRow[];
  operationCount: number;
  createdAt: Date;
};

const COUNTERPARTY_INCLUDE = {
  executor: { select: { id: true, name: true, type: true, accessEmail: true } },
  client: { select: { id: true, name: true } },
  bankAccount: { select: { id: true, name: true } },
  uniqueProject: { select: { id: true, name: true } },
  uniqueWorkType: { select: { id: true, name: true } },
  requisites: { orderBy: { createdAt: "asc" } },
  aliases: { orderBy: { value: "asc" } },
  _count: { select: { bankOperations: true } },
} satisfies Prisma.CounterpartyInclude;

type CounterpartyWithRelations = Prisma.CounterpartyGetPayload<{
  include: typeof COUNTERPARTY_INCLUDE;
}>;

/** Вкладка справочника: клиент → «Клиенты», свой счёт → «Счета КПД», иначе тип исполнителя. */
export function resolveCounterpartyKind(row: {
  clientId: string | null;
  bankAccountId: string | null;
  executor: { type: string } | null;
}): CounterpartyKind {
  if (row.clientId) return "client";
  if (row.bankAccountId) return "own_account";
  if (row.executor?.type === "service") return "service";
  if (row.executor?.type === "bank") return "bank";
  return "executor";
}

function toRow(cp: CounterpartyWithRelations): CounterpartyListRow {
  return {
    id: cp.id,
    name: cp.name,
    kind: resolveCounterpartyKind(cp),
    legalType: cp.legalType,
    status: cp.status,
    comment: cp.comment,
    executorId: cp.executorId,
    executorName: cp.executor?.name ?? null,
    clientId: cp.clientId,
    clientName: cp.client?.name ?? null,
    bankAccountId: cp.bankAccountId,
    bankAccountName: cp.bankAccount?.name ?? null,
    uniqueProjectId: cp.uniqueProjectId,
    uniqueProjectName: cp.uniqueProject?.name ?? null,
    uniqueWorkTypeId: cp.uniqueWorkTypeId,
    uniqueWorkTypeName: cp.uniqueWorkType?.name ?? null,
    personalEstimateUrl:
      cp.executor && hasPersonalSmeta(cp.executor)
        ? `/admin/executors/${cp.executor.id}?tab=works`
        : null,
    requisites: cp.requisites.map((r) => ({
      id: r.id,
      paymentMethod: r.paymentMethod,
      taxId: r.taxId,
      bic: r.bic,
      bankName: r.bankName,
      accountNumber: r.accountNumber,
      cardNumber: r.cardNumber,
      status: r.status,
      comment: r.comment,
    })),
    aliases: cp.aliases.map((a) => ({ id: a.id, value: a.value, source: a.source })),
    operationCount: cp._count.bankOperations,
    createdAt: cp.createdAt,
  };
}

export type ListCounterpartiesFilter = {
  executorId?: string;
  clientId?: string;
  bankAccountId?: string;
};

export async function listCounterparties(
  filter?: ListCounterpartiesFilter
): Promise<CounterpartyListRow[]> {
  const rows = await prisma.counterparty.findMany({
    where: {
      ...(filter?.executorId && { executorId: filter.executorId }),
      ...(filter?.clientId && { clientId: filter.clientId }),
      ...(filter?.bankAccountId && { bankAccountId: filter.bankAccountId }),
    },
    orderBy: { name: "asc" },
    include: COUNTERPARTY_INCLUDE,
  });
  return rows.map(toRow);
}

export async function getCounterparty(id: string): Promise<CounterpartyListRow | null> {
  const row = await prisma.counterparty.findUnique({ where: { id }, include: COUNTERPARTY_INCLUDE });
  return row ? toRow(row) : null;
}

/** Короткий список для выбора контрагента в операции: имя + всё, по чему его ищут. */
export type CounterpartyOption = {
  id: string;
  name: string;
  kind: CounterpartyKind;
  status: string;
  legalType: string | null;
  uniqueProjectId: string | null;
  uniqueWorkTypeId: string | null;
  /** Имена из выписки и реквизиты — чтобы поиск находил по ИНН и написанию. */
  searchText: string;
};

export async function listCounterpartyOptions(): Promise<CounterpartyOption[]> {
  const rows = await prisma.counterparty.findMany({
    where: { status: "active" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      legalType: true,
      clientId: true,
      bankAccountId: true,
      uniqueProjectId: true,
      uniqueWorkTypeId: true,
      executor: { select: { type: true } },
      aliases: { select: { value: true } },
      requisites: { select: { taxId: true, accountNumber: true, cardNumber: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: resolveCounterpartyKind(r),
    status: r.status,
    legalType: r.legalType,
    uniqueProjectId: r.uniqueProjectId,
    uniqueWorkTypeId: r.uniqueWorkTypeId,
    searchText: [
      r.name,
      ...r.aliases.map((a) => a.value),
      ...r.requisites.flatMap((q) => [q.taxId, q.accountNumber, q.cardNumber]),
    ]
      .filter(Boolean)
      .join(" "),
  }));
}

export type CounterpartyLinkInput = {
  executorId?: string | null;
  clientId?: string | null;
  bankAccountId?: string | null;
};

export type CreateCounterpartyInput = CounterpartyLinkInput & {
  name: string;
  legalType?: string | null;
  comment?: string | null;
  uniqueProjectId?: string | null;
  uniqueWorkTypeId?: string | null;
  requisites?: RequisiteInput[];
  aliases?: { value: string; source?: string }[];
};

function assertSingleLink(links: CounterpartyLinkInput) {
  const filled = [links.executorId, links.clientId, links.bankAccountId].filter(Boolean);
  if (filled.length === 0) {
    throw new Error("Нельзя сохранить контрагента без ссылки на исполнителя, клиента или счёт");
  }
  if (filled.length > 1) {
    throw new Error("У контрагента должна быть ровно одна ссылка: исполнитель, клиент или счёт");
  }
}

export async function createCounterparty(input: CreateCounterpartyInput, userId: string) {
  assertSingleLink(input);

  const created = await prisma.$transaction(async (tx) => {
    const cp = await tx.counterparty.create({
      data: {
        name: input.name.trim(),
        legalType: input.legalType ?? null,
        comment: input.comment?.trim() || null,
        executorId: input.executorId ?? null,
        clientId: input.clientId ?? null,
        bankAccountId: input.bankAccountId ?? null,
        uniqueProjectId: input.uniqueProjectId ?? null,
        uniqueWorkTypeId: input.uniqueWorkTypeId ?? null,
      },
    });

    for (const r of input.requisites ?? []) {
      await tx.counterpartyRequisite.create({ data: { ...requisiteData(r), counterpartyId: cp.id } });
    }
    for (const a of input.aliases ?? []) {
      const value = a.value.trim();
      if (!value) continue;
      await tx.counterpartyAlias.create({
        data: {
          counterpartyId: cp.id,
          value,
          normalized: normalizeMatchValue(value),
          source: a.source ?? "manual",
        },
      });
    }

    return cp;
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "Counterparty",
    entityId: created.id,
    entityLabel: created.name,
  });

  return created;
}

export type UpdateCounterpartyInput = CounterpartyLinkInput & {
  name?: string;
  legalType?: string | null;
  comment?: string | null;
  status?: string;
  uniqueProjectId?: string | null;
  uniqueWorkTypeId?: string | null;
};

export async function updateCounterparty(
  id: string,
  patch: UpdateCounterpartyInput,
  userId: string
) {
  const before = await prisma.counterparty.findUnique({ where: { id } });
  if (!before) throw new Error("Counterparty not found");

  const touchesLinks =
    patch.executorId !== undefined ||
    patch.clientId !== undefined ||
    patch.bankAccountId !== undefined;
  if (touchesLinks) {
    assertSingleLink({
      executorId: patch.executorId !== undefined ? patch.executorId : before.executorId,
      clientId: patch.clientId !== undefined ? patch.clientId : before.clientId,
      bankAccountId:
        patch.bankAccountId !== undefined ? patch.bankAccountId : before.bankAccountId,
    });
  }

  const updated = await prisma.counterparty.update({
    where: { id },
    data: {
      ...(patch.name !== undefined && { name: patch.name.trim() }),
      ...(patch.legalType !== undefined && { legalType: patch.legalType }),
      ...(patch.comment !== undefined && { comment: patch.comment?.trim() || null }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.executorId !== undefined && { executorId: patch.executorId }),
      ...(patch.clientId !== undefined && { clientId: patch.clientId }),
      ...(patch.bankAccountId !== undefined && { bankAccountId: patch.bankAccountId }),
      ...(patch.uniqueProjectId !== undefined && { uniqueProjectId: patch.uniqueProjectId }),
      ...(patch.uniqueWorkTypeId !== undefined && { uniqueWorkTypeId: patch.uniqueWorkTypeId }),
    },
  });

  const changes = diff(
    before as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>
  );
  if (Object.keys(changes).length > 0) {
    await logActivity({
      userId,
      action: "update",
      entityType: "Counterparty",
      entityId: id,
      entityLabel: updated.name,
      changes,
    });
  }

  return updated;
}

export async function archiveCounterparty(id: string, userId: string) {
  const updated = await prisma.counterparty.update({
    where: { id },
    data: { status: "archived" },
  });
  await logActivity({
    userId,
    action: "archive",
    entityType: "Counterparty",
    entityId: id,
    entityLabel: updated.name,
  });
  return updated;
}

export async function unarchiveCounterparty(id: string, userId: string) {
  const updated = await prisma.counterparty.update({
    where: { id },
    data: { status: "active" },
  });
  await logActivity({
    userId,
    action: "unarchive",
    entityType: "Counterparty",
    entityId: id,
    entityLabel: updated.name,
  });
  return updated;
}

// ─── Реквизиты ───────────────────────────────────────────────

export type RequisiteInput = {
  paymentMethod?: string;
  taxId?: string | null;
  bic?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  cardNumber?: string | null;
  status?: string;
  comment?: string | null;
};

function requisiteData(input: RequisiteInput) {
  return {
    paymentMethod: input.paymentMethod ?? inferPaymentMethod(input),
    taxId: input.taxId?.trim() || null,
    bic: input.bic?.trim() || null,
    bankName: input.bankName?.trim() || null,
    accountNumber: input.accountNumber?.trim() || null,
    cardNumber: input.cardNumber?.trim() || null,
    status: input.status ?? "active",
    comment: input.comment?.trim() || null,
  };
}

export async function addRequisite(
  counterpartyId: string,
  input: RequisiteInput,
  userId: string
) {
  const parent = await prisma.counterparty.findUnique({ where: { id: counterpartyId } });
  if (!parent) throw new Error("Counterparty not found");

  const created = await prisma.counterpartyRequisite.create({
    data: { ...requisiteData(input), counterpartyId },
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "CounterpartyRequisite",
    entityId: created.id,
    entityLabel: `${parent.name} — реквизиты`,
  });

  return created;
}

export async function updateRequisite(
  requisiteId: string,
  input: Partial<RequisiteInput>,
  userId: string
) {
  const before = await prisma.counterpartyRequisite.findUnique({
    where: { id: requisiteId },
    include: { counterparty: { select: { name: true } } },
  });
  if (!before) throw new Error("Requisite not found");

  const updated = await prisma.counterpartyRequisite.update({
    where: { id: requisiteId },
    data: {
      ...(input.paymentMethod !== undefined && { paymentMethod: input.paymentMethod }),
      ...(input.taxId !== undefined && { taxId: input.taxId?.trim() || null }),
      ...(input.bic !== undefined && { bic: input.bic?.trim() || null }),
      ...(input.bankName !== undefined && { bankName: input.bankName?.trim() || null }),
      ...(input.accountNumber !== undefined && {
        accountNumber: input.accountNumber?.trim() || null,
      }),
      ...(input.cardNumber !== undefined && { cardNumber: input.cardNumber?.trim() || null }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.comment !== undefined && { comment: input.comment?.trim() || null }),
    },
  });

  const changes = diff(
    before as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>
  );
  if (Object.keys(changes).length > 0) {
    await logActivity({
      userId,
      action: "update",
      entityType: "CounterpartyRequisite",
      entityId: requisiteId,
      entityLabel: `${before.counterparty.name} — реквизиты`,
      changes,
    });
  }

  return updated;
}

export async function deleteRequisite(requisiteId: string, userId: string) {
  const before = await prisma.counterpartyRequisite.findUnique({
    where: { id: requisiteId },
    include: { counterparty: { select: { name: true } } },
  });
  if (!before) throw new Error("Requisite not found");

  await prisma.counterpartyRequisite.delete({ where: { id: requisiteId } });

  await logActivity({
    userId,
    action: "delete",
    entityType: "CounterpartyRequisite",
    entityId: requisiteId,
    entityLabel: `${before.counterparty.name} — реквизиты`,
  });
}

// ─── Написания в выписке ─────────────────────────────────────

export async function addAlias(
  counterpartyId: string,
  value: string,
  source: string,
  userId: string
) {
  const parent = await prisma.counterparty.findUnique({ where: { id: counterpartyId } });
  if (!parent) throw new Error("Counterparty not found");

  const normalized = normalizeMatchValue(value);
  const clash = await prisma.counterpartyAlias.findUnique({
    where: { normalized },
    include: { counterparty: { select: { id: true, name: true } } },
  });
  if (clash) {
    if (clash.counterparty.id === counterpartyId) return clash;
    throw new Error(`Написание уже привязано к контрагенту «${clash.counterparty.name}»`);
  }

  const created = await prisma.counterpartyAlias.create({
    data: { counterpartyId, value: value.trim(), normalized, source },
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "CounterpartyAlias",
    entityId: created.id,
    entityLabel: `${parent.name} — «${created.value}»`,
  });

  return created;
}

export async function deleteAlias(aliasId: string, userId: string) {
  const before = await prisma.counterpartyAlias.findUnique({
    where: { id: aliasId },
    include: { counterparty: { select: { name: true } } },
  });
  if (!before) throw new Error("Alias not found");

  await prisma.counterpartyAlias.delete({ where: { id: aliasId } });

  await logActivity({
    userId,
    action: "delete",
    entityType: "CounterpartyAlias",
    entityId: aliasId,
    entityLabel: `${before.counterparty.name} — «${before.value}»`,
  });
}
