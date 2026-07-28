/**
 * ExecutorService (TDNB-18).
 *
 * Типы: permanent | external | service | bank
 * Учётная запись не зависит от типа исполнителя и создаётся при выдаче доступа.
 */

import { prisma } from "@/lib/db";
import { hash } from "bcryptjs";
import { logActivity, diff } from "@/lib/audit/log";
import { seedOnboardingTasks } from "@/lib/services/tasks";
import { assertCanUnsetResponsible } from "@/lib/services/responsibles";
import { parseRecipientTypes, serializeRecipientTypes } from "@/lib/executor-recipient-type";
import {
  canBeResponsible,
  formatNameForExecutorType,
  normalizeExecutorType,
} from "@/lib/executor-type";
import type { ExecutorType } from "@/lib/statuses";


export type ExecutorListRow = {
  id: string;
  name: string; // A
  companyStatus: string | null; // B
  type: string; // D
  workTypeIds: string[]; // E (raw ids)
  workTypeNames: string[]; // E (resolved labels)
  projectNames: string[]; // F (из плана расходов, как plan-projects)
  responsibleUserId: string | null;
  responsibleName: string | null; // G
  defaultBankAccountId: string | null;
  defaultBankAccountName: string | null; // H
  recipientTypes: string[]; // I (из recipientType JSON / legacy)
  requisites: string | null; // J
  contacts: string | null; // K
  contactEmail: string | null;
  accessEmail: string | null;
  userId: string | null;
  inTgChat: boolean; // L
  specialty: string | null; // M
  note: string | null; // N
  contractFile: string | null; // O
  ndaFile: string | null; // P
  status: string; // T
  lastPaidAt: Date | null; // U
  legalForm: string | null;
  createdAt: Date;
};

/**
 * Список активных постоянных исполнителей для dropdown «Ответственный»
 * (KPD-284/285). Отсортирован по имени (collator ru).
 */
export async function listActivePermanentExecutors(): Promise<
  { id: string; name: string }[]
> {
  const rows = await prisma.executor.findMany({
    where: { type: "permanent", status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export async function listExecutors(): Promise<ExecutorListRow[]> {
  const [executors, planLines] = await Promise.all([
    prisma.executor.findMany({
      orderBy: [{ name: "asc" }],
      include: {
        responsibleUser: { select: { id: true, fullName: true } },
        defaultBankAccount: { select: { id: true, name: true } },
        executorWorkTypes: { include: { workType: { select: { id: true, name: true } } } },
        payments: {
          where: { paymentStatus: "paid" },
          orderBy: { paidAt: "desc" },
          take: 1,
          select: { paidAt: true },
        },
      },
    }),
    prisma.spendingPlanLine.findMany({
      select: {
        executorId: true,
        projectId: true,
        project: { select: { name: true, status: true } },
      },
    }),
  ]);

  const planByExecutorId = new Map<string, Map<string, string>>();
  for (const line of planLines) {
    if (line.project.status === "archived") continue;
    let byProject = planByExecutorId.get(line.executorId);
    if (!byProject) {
      byProject = new Map();
      planByExecutorId.set(line.executorId, byProject);
    }
    byProject.set(line.projectId, line.project.name);
  }

  // Доп: последняя дата выплаты также может быть через OtherExpense.paymentDate (paid).
  const otherPayments = await prisma.otherExpense.groupBy({
    by: ["executorId"],
    where: { paymentStatus: "paid", paidAt: { not: null } },
    _max: { paidAt: true },
  });
  const otherPaymentMap = new Map(
    otherPayments.map((o) => [o.executorId, o._max?.paidAt ?? null])
  );

  return executors.map((e) => {
    const lastFromPayments = e.payments[0]?.paidAt ?? null;
    const lastFromOther = otherPaymentMap.get(e.id) ?? null;
    const lastPaidAt =
      lastFromPayments && lastFromOther
        ? lastFromPayments > lastFromOther
          ? lastFromPayments
          : lastFromOther
        : lastFromPayments ?? lastFromOther;

    const workTypes = e.executorWorkTypes.map((ewt) => ewt.workType);
    const projects = Array.from(planByExecutorId.get(e.id)?.values() ?? []).sort((a, b) =>
      a.localeCompare(b, "ru")
    );

    return {
      id: e.id,
      name: e.name,
      companyStatus: e.companyStatus,
      type: e.type,
      workTypeIds: workTypes.map((wt) => wt.id),
      workTypeNames: workTypes.map((wt) => wt.name).sort((a, b) => a.localeCompare(b, "ru")),
      projectNames: projects,
      responsibleUserId: e.responsibleUserId,
      responsibleName: e.responsibleUser?.fullName ?? null,
      defaultBankAccountId: e.defaultBankAccountId,
      defaultBankAccountName: e.defaultBankAccount?.name ?? null,
      recipientTypes: parseRecipientTypes(e.recipientType),
      requisites: e.requisites,
      contacts: e.contacts,
      contactEmail: e.contactEmail,
      accessEmail: e.accessEmail,
      userId: e.userId,
      inTgChat: e.inTgChat,
      specialty: e.specialty,
      note: e.note,
      contractFile: e.contractFile,
      ndaFile: e.ndaFile,
      status: e.status,
      lastPaidAt,
      legalForm: e.legalForm,
      createdAt: e.createdAt,
    };
  });
}

export type CreateExecutorInput =
  | {
      type: "permanent";
      firstName: string;
      lastName: string;
      contactEmail?: string | null;
      accessEmail?: string | null;
      password?: string;
      companyStatus?: string | null;
      responsibleUserId?: string | null;
      specialty?: string | null;
      defaultBankAccountId?: string | null;
      recipientTypes?: string[];
      recipientType?: string | null;
    }
  | {
      type: "external" | "service" | "bank";
      name: string;
      contactEmail?: string | null;
      accessEmail?: string | null;
      password?: string;
      responsibleUserId?: string | null;
      recipientTypes?: string[];
      recipientType?: string | null;
      defaultBankAccountId?: string | null;
    };

function recipientTypeForCreate(input: {
  recipientTypes?: string[];
  recipientType?: string | null;
}): string | null {
  if (input.recipientTypes !== undefined) {
    return serializeRecipientTypes(input.recipientTypes);
  }
  if (input.recipientType) {
    return serializeRecipientTypes(parseRecipientTypes(input.recipientType));
  }
  return null;
}

export function executorDisplayName(input: CreateExecutorInput): string {
  if (input.type === "permanent") {
    return `${input.lastName.trim()} ${input.firstName.trim()}`;
  }
  return formatNameForExecutorType(input.type, input.name);
}

export async function createExecutor(input: CreateExecutorInput, userId: string) {
  const name = executorDisplayName(input);
  const accessEmail = input.accessEmail?.trim().toLowerCase() || null;
  const contactEmail = input.contactEmail?.trim().toLowerCase() || null;

  const created = await prisma.$transaction(async (tx) => {
    let userIdToLink: string | null = null;

    if (accessEmail) {
      const existing = await tx.user.findUnique({ where: { email: accessEmail } });
      if (existing) throw new Error("Пользователь с таким email уже существует");
      const passwordHash = await hash(input.password ?? "Welcome2026!", 10);
      const user = await tx.user.create({
        data: {
          email: accessEmail,
          password: passwordHash,
          fullName: name,
          role: "executor",
          isActive: true,
        },
      });
      userIdToLink = user.id;
    }

    return tx.executor.create({
      data: {
        name,
        type: input.type,
        userId: userIdToLink,
        contactEmail,
        accessEmail,
        accessRevokedAt: accessEmail ? null : new Date(),
        companyStatus: input.type === "permanent" ? input.companyStatus ?? null : null,
        recipientType: recipientTypeForCreate(input),
        specialty: input.type === "permanent" ? input.specialty ?? null : null,
        responsibleUserId: input.responsibleUserId ?? null,
        defaultBankAccountId: input.defaultBankAccountId ?? null,
        status: "active",
      },
    });
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "Executor",
    entityId: created.id,
    entityLabel: created.name,
  });

  if (accessEmail) {
    await seedOnboardingTasks(created.id, userId);
  }

  return created;
}

export type UpdateExecutorInput = {
  type?: ExecutorType;
  status?: "active" | "archived";
  name?: string;
  password?: string;
  companyStatus?: string | null;
  specialty?: string | null;
  contacts?: string | null;
  contactEmail?: string | null;
  requisites?: string | null;
  note?: string | null;
  inTgChat?: boolean;
  contractFile?: string | null;
  ndaFile?: string | null;
  recipientTypes?: string[];
  recipientType?: string | null;
  responsibleUserId?: string | null;
  defaultBankAccountId?: string | null;
  oldEstimateUrl?: string | null;
  specialties?: string | null;
  isResponsible?: boolean;
  workTypeIds?: string[];
};

export async function updateExecutor(id: string, patch: UpdateExecutorInput, userId: string) {
  const before = await prisma.executor.findUnique({
    where: { id },
    include: { executorWorkTypes: true },
  });
  if (!before) throw new Error("Executor not found");

  const nextType = patch.type ?? normalizeExecutorType(before.type);

  const nextStatus = patch.status ?? before.status;

  if (patch.isResponsible === true && (nextStatus === "archived" || before.status === "archived")) {
    throw new Error("Нельзя назначить руководителем проекта архивного исполнителя");
  }

  if (patch.isResponsible === true && !canBeResponsible(nextType)) {
    throw new Error("Руководителем проекта может быть только исполнитель типа «Постоянный»");
  }

  if (patch.isResponsible === false && before.isResponsible) {
    if (!before.userId) {
      throw new Error("Нельзя снять роль руководителя проекта: у исполнителя нет учётной записи");
    }
    await assertCanUnsetResponsible(before.userId);
  }

  if (before.userId && patch.password) {
    if (patch.password.length < 6) {
      throw new Error("Пароль не короче 6 символов");
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (patch.status === "archived" && before.userId) {
      await tx.user.update({
        where: { id: before.userId },
        data: { isActive: false },
      });
    }

    if (patch.workTypeIds) {
      await tx.executorWorkType.deleteMany({ where: { executorId: id } });
      if (patch.workTypeIds.length > 0) {
        await tx.executorWorkType.createMany({
          data: patch.workTypeIds.map((wtId) => ({ executorId: id, workTypeId: wtId })),
        });
      }
    }

    const resolvedName =
      patch.name !== undefined
        ? formatNameForExecutorType(nextType, patch.name)
        : undefined;

    const clearResponsible =
      patch.type !== undefined && !canBeResponsible(nextType) && before.isResponsible;

    const exec = await tx.executor.update({
      where: { id },
      data: {
        ...(patch.status !== undefined && { status: patch.status }),
        // При архивировании — отзываем доступ к системе
        ...(patch.status === "archived" && {
          accessRevokedAt: new Date(),
          accessEmail: null,
        }),
        ...(patch.type !== undefined && { type: nextType }),
        ...(resolvedName !== undefined && { name: resolvedName }),
        ...(patch.type !== undefined &&
          nextType !== "permanent" && { companyStatus: null }),
        ...(patch.companyStatus !== undefined && { companyStatus: patch.companyStatus }),
        ...(patch.specialty !== undefined && { specialty: patch.specialty }),
        ...(patch.contacts !== undefined && { contacts: patch.contacts }),
        ...(patch.contactEmail !== undefined && {
          contactEmail: patch.contactEmail?.trim().toLowerCase() || null,
        }),
        ...(patch.requisites !== undefined && { requisites: patch.requisites }),
        ...(patch.note !== undefined && { note: patch.note }),
        ...(patch.inTgChat !== undefined && { inTgChat: patch.inTgChat }),
        ...(patch.contractFile !== undefined && { contractFile: patch.contractFile }),
        ...(patch.ndaFile !== undefined && { ndaFile: patch.ndaFile }),
        ...(patch.recipientTypes !== undefined && {
          recipientType: serializeRecipientTypes(patch.recipientTypes),
        }),
        ...(patch.recipientType !== undefined &&
          patch.recipientTypes === undefined && {
            recipientType: patch.recipientType
              ? serializeRecipientTypes(parseRecipientTypes(patch.recipientType))
              : null,
          }),
        ...(patch.responsibleUserId !== undefined && { responsibleUserId: patch.responsibleUserId }),
        ...(patch.defaultBankAccountId !== undefined && {
          defaultBankAccountId: patch.defaultBankAccountId,
        }),
        ...(patch.oldEstimateUrl !== undefined && { oldEstimateUrl: patch.oldEstimateUrl }),
        ...(patch.specialties !== undefined && { specialties: patch.specialties }),
        ...(clearResponsible && { isResponsible: false }),
        ...(patch.isResponsible !== undefined && {
          isResponsible: canBeResponsible(nextType) ? patch.isResponsible : false,
          ...(patch.isResponsible && canBeResponsible(nextType) && { responsibleActive: true }),
        }),
      },
    });

    const userIdToSync = before.userId;
    if (resolvedName !== undefined && userIdToSync) {
      await tx.user.update({
        where: { id: userIdToSync },
        data: { fullName: resolvedName },
      });
    }

    if (before.userId && patch.password) {
      await tx.user.update({
        where: { id: before.userId },
        data: { password: await hash(patch.password, 10) },
      });
    }

    return exec;
  });

  const changes = diff(
    {
      type: before.type,
      name: before.name,
      companyStatus: before.companyStatus,
      specialty: before.specialty,
      contacts: before.contacts,
      contactEmail: before.contactEmail,
      requisites: before.requisites,
      note: before.note,
      inTgChat: before.inTgChat,
      contractFile: before.contractFile,
      ndaFile: before.ndaFile,
      recipientType: before.recipientType,
      responsibleUserId: before.responsibleUserId,
      defaultBankAccountId: before.defaultBankAccountId,
    },
    {
      type: updated.type,
      name: updated.name,
      companyStatus: updated.companyStatus,
      specialty: updated.specialty,
      contacts: updated.contacts,
      contactEmail: updated.contactEmail,
      requisites: updated.requisites,
      note: updated.note,
      inTgChat: updated.inTgChat,
      contractFile: updated.contractFile,
      ndaFile: updated.ndaFile,
      recipientType: updated.recipientType,
      responsibleUserId: updated.responsibleUserId,
      defaultBankAccountId: updated.defaultBankAccountId,
    }
  );
  if (Object.keys(changes).length > 0) {
    await logActivity({
      userId,
      action: "update",
      entityType: "Executor",
      entityId: id,
      entityLabel: updated.name,
      changes,
    });
  }

  return updated;
}

export type ArchiveExecutorPrecheck = {
  openWorks: number;
  pendingPayments: number;
};

export async function archiveExecutorPrecheck(id: string): Promise<ArchiveExecutorPrecheck> {
  const [openWorks, pendingPayments] = await Promise.all([
    prisma.work.count({
      where: { executorId: id, workStatus: { in: ["submitted", "checked", "rework"] } },
    }),
    prisma.payment.count({
      where: { executorId: id, paymentStatus: "planned" },
    }),
  ]);
  return { openWorks, pendingPayments };
}

export async function archiveExecutor(id: string, userId: string) {
  const exec = await prisma.executor.findUnique({ where: { id } });
  if (!exec) throw new Error("Executor not found");
  const updated = await prisma.$transaction(async (tx) => {
    if (exec.userId) {
      await tx.user.update({ where: { id: exec.userId }, data: { isActive: false } });
    }
    return tx.executor.update({
      where: { id },
      data: { status: "archived", accessRevokedAt: new Date(), accessEmail: null },
    });
  });
  await logActivity({
    userId,
    action: "archive",
    entityType: "Executor",
    entityId: id,
    entityLabel: updated.name,
  });
  return updated;
}

export async function unarchiveExecutor(id: string, userId: string) {
  const exec = await prisma.executor.findUnique({ where: { id } });
  if (!exec) throw new Error("Executor not found");
  const updated = await prisma.executor.update({
    where: { id },
    data: { status: "active" },
  });
  await logActivity({
    userId,
    action: "unarchive",
    entityType: "Executor",
    entityId: id,
    entityLabel: updated.name,
  });
  return updated;
}

export const ACCESS_EMAIL_CONTACT_WARNING =
  'Поле "Контакт email" не перезаписывается автоматически. При необходимости исправьте его вручную.';

export async function grantExecutorAccess(
  id: string,
  accessEmailInput: string,
  password: string | undefined,
  userId: string
) {
  const exec = await prisma.executor.findUnique({
    where: { id },
    include: { user: { select: { id: true } } },
  });
  if (!exec) throw new Error("Executor not found");
  if (exec.status !== "active") throw new Error("Нельзя выдать доступ архивному исполнителю");

  const accessEmail = accessEmailInput.trim().toLowerCase();
  if (!accessEmail) throw new Error("Укажите Email для доступа");
  if (!exec.userId && (!password || password.length < 6)) {
    throw new Error("Пароль не короче 6 символов");
  }

  const emailOwner = await prisma.user.findUnique({ where: { email: accessEmail } });
  if (emailOwner && emailOwner.id !== exec.userId) {
    throw new Error("Пользователь с таким email уже существует");
  }

  let createdUser = false;
  const updated = await prisma.$transaction(async (tx) => {
    let linkedUserId = exec.userId;
    if (linkedUserId) {
      await tx.user.update({
        where: { id: linkedUserId },
        data: {
          email: accessEmail,
          isActive: true,
          ...(password && { password: await hash(password, 10) }),
        },
      });
    } else {
      const user = await tx.user.create({
        data: {
          email: accessEmail,
          password: await hash(password!, 10),
          fullName: exec.name,
          role: "executor",
          isActive: true,
        },
      });
      linkedUserId = user.id;
      createdUser = true;
    }

    return tx.executor.update({
      where: { id },
      data: {
        userId: linkedUserId,
        accessEmail,
        accessRevokedAt: null,
      },
    });
  });

  await logActivity({
    userId,
    action: "access_grant",
    entityType: "Executor",
    entityId: id,
    entityLabel: updated.name,
  });

  if (createdUser) await seedOnboardingTasks(id, userId);

  const warning =
    exec.contactEmail?.trim().toLowerCase() !== accessEmail
      ? ACCESS_EMAIL_CONTACT_WARNING
      : null;
  return { executor: updated, warning };
}

export async function revokeExecutorAccess(id: string, userId: string) {
  const exec = await prisma.executor.findUnique({
    where: { id },
    include: { user: { select: { id: true } } },
  });
  if (!exec) throw new Error("Executor not found");

  const updated = await prisma.$transaction(async (tx) => {
    if (exec.user) {
      await tx.user.update({
        where: { id: exec.user.id },
        data: { isActive: false },
      });
    }
    return tx.executor.update({
      where: { id },
      data: { accessRevokedAt: new Date(), accessEmail: null },
    });
  });

  await logActivity({
    userId,
    action: "access_revoke",
    entityType: "Executor",
    entityId: id,
    entityLabel: updated.name,
  });
  return updated;
}
