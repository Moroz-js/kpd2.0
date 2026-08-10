/**
 * ProjectService (TDNB-22).
 *
 * Computed:
 *   B (name)    = `${shortName} – ${client.name}` (TEXTJOIN(" – "; TRUE; J; I))
 *   E (debt)    = SUM(IssuedWork.amount WHERE workStatus IN submitted|checked AND projectId)
 *   F (paid)    = SUM(IssuedWork.amount WHERE workStatus = paid AND projectId)
 *   G (charged) = SUM(Charge.amount WHERE status = paid AND order.projectId)
 *   K (type)    = client.name.toLowerCase() содержит "кпд" → internal, иначе client → "???"
 */

import { prisma } from "@/lib/db";
import { logActivity, diff } from "@/lib/audit/log";
import { listIssuedWorks } from "@/lib/views/issuedWorks";
import {
  allocateEntitySerial,
  withNumberedTransaction,
  withSerializableTransaction,
} from "@/lib/services/entity-numbering";
import {
  formatProjectNumber,
  isNumberedProjectType,
} from "@/lib/project-number";

const PROJECT_NUMBER_COUNTER_YEAR = 0;

export type ProjectListRow = {
  id: string;
  number: string | null;
  numberSerial: number | null;
  name: string; // B
  shortName: string; // J
  type: string; // K: internal | client | unknown
  status: string; // D
  responsibleUserId: string | null;
  responsibleName: string | null; // C
  clientId: string | null;
  clientName: string | null; // I
  company: string | null; // H
  debt: number; // E
  paid: number; // F
  charged: number; // G
  createdAt: Date;
};

export function projectFullName(shortName: string, clientName: string | null): string {
  if (!clientName) return shortName.trim();
  return `${shortName.trim()} – ${clientName}`;
}

/**
 * Возвращает id исполнителя-руководителя проекта (KPD-284/285).
 * РП проекта = `Project.responsibleUserId` → исполнитель с этим `userId`.
 * Используется для автозаполнения «Ответственного» при создании работ/трат.
 */
export async function resolveProjectManagerExecutorId(
  projectId: string
): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { responsibleUserId: true },
  });
  if (!project?.responsibleUserId) return null;
  const executor = await prisma.executor.findFirst({
    where: { userId: project.responsibleUserId },
    select: { id: true },
  });
  return executor?.id ?? null;
}

/**
 * Активные проекты + id исполнителя-руководителя проекта (для автозаполнения
 * «Ответственного» в формах). KPD-284/285.
 */
export async function listActiveProjectsWithManagerExecutor(): Promise<
  { id: string; name: string; responsibleExecutorId: string | null }[]
> {
  const [projects, execs] = await Promise.all([
    prisma.project.findMany({
      where: { status: "active" },
      select: { id: true, name: true, responsibleUserId: true },
      orderBy: { name: "asc" },
    }),
    prisma.executor.findMany({
      where: { userId: { not: null } },
      select: { id: true, userId: true },
    }),
  ]);
  const executorByUserId = new Map<string, string>();
  for (const e of execs) {
    if (e.userId) executorByUserId.set(e.userId, e.id);
  }
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    responsibleExecutorId: p.responsibleUserId
      ? executorByUserId.get(p.responsibleUserId) ?? null
      : null,
  }));
}

export function projectType(clientName: string | null): string {
  if (!clientName) return "unknown";
  return clientName.toLowerCase().includes("кпд") ? "internal" : "client";
}

export type ListProjectsFilter = {
  responsibleUserId?: string; // если задан — только проекты этого PM
};

export async function listProjects(filter?: ListProjectsFilter): Promise<ProjectListRow[]> {
  const projects = await prisma.project.findMany({
    where: filter?.responsibleUserId ? { responsibleUserId: filter.responsibleUserId } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { id: true, name: true, company: true } },
      responsible: { select: { id: true, fullName: true } },
      orders: { select: { charges: { select: { amount: true, status: true } } } },
    },
  });

  const issued = await listIssuedWorks();
  const byProject = new Map<string, { debt: number; paid: number }>();
  for (const r of issued) {
    const acc = byProject.get(r.projectId) ?? { debt: 0, paid: 0 };
    if (r.workStatus === "submitted" || r.workStatus === "checked") acc.debt += r.amount;
    else if (r.workStatus === "paid") acc.paid += r.amount;
    byProject.set(r.projectId, acc);
  }

  return projects.map((p) => {
    const agg = byProject.get(p.id) ?? { debt: 0, paid: 0 };
    let charged = 0;
    for (const o of p.orders) {
      for (const ch of o.charges) {
        if (ch.status === "paid") charged += ch.amount;
      }
    }
    return {
      id: p.id,
      number: p.number,
      numberSerial: p.numberSerial,
      name: p.name,
      shortName: p.shortName,
      type: p.type,
      status: p.status,
      responsibleUserId: p.responsibleUserId,
      responsibleName: p.responsible?.fullName ?? null,
      clientId: p.clientId,
      clientName: p.client?.name ?? null,
      company: p.client?.company ?? null,
      debt: agg.debt,
      paid: agg.paid,
      charged,
      createdAt: p.createdAt,
    };
  });
}

export type CreateProjectInput = {
  clientId: string;
  shortName: string;
  responsibleUserId?: string | null;
};

export async function createProject(input: CreateProjectInput, userId: string) {
  const shortName = input.shortName.trim();
  const created = await withNumberedTransaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id: input.clientId } });
    if (!client) throw new Error("Client not found");
    if (client.status === "archived") {
      throw new Error("Cannot create project for archived client");
    }

    const name = projectFullName(shortName, client.name);
    const type = projectType(client.name);
    if (!isNumberedProjectType(type)) {
      throw new Error("Cannot assign a number to a project without a type");
    }

    const allocated = await allocateEntitySerial(
      tx,
      "project",
      PROJECT_NUMBER_COUNTER_YEAR
    );

    return tx.project.create({
      data: {
        number: formatProjectNumber(type, allocated.serial),
        numberSerial: allocated.serial,
        shortName,
        name,
        type,
        status: "active",
        clientId: client.id,
        responsibleUserId: input.responsibleUserId ?? null,
      },
    });
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "Project",
    entityId: created.id,
    entityLabel: created.name,
  });

  return created;
}

export type UpdateProjectInput = {
  shortName?: string;
  clientId?: string | null;
  responsibleUserId?: string | null;
  status?: string;
  cashflowInitial?: number;
};

export async function updateProject(id: string, patch: UpdateProjectInput, userId: string) {
  const { before, updated } = await withSerializableTransaction(async (tx) => {
    const before = await tx.project.findUnique({
      where: { id },
      include: { client: { select: { name: true } } },
    });
    if (!before) throw new Error("Project not found");

    const newClientId =
      patch.clientId !== undefined ? patch.clientId : before.clientId;
    let clientName = before.client?.name ?? null;
    if (newClientId !== before.clientId) {
      if (newClientId) {
        const newClient = await tx.client.findUnique({ where: { id: newClientId } });
        if (!newClient) throw new Error("Client not found");
        clientName = newClient.name;
      } else {
        clientName = null;
      }
    }

    const typeVal = projectType(clientName);
    const newShortName = (patch.shortName ?? before.shortName).trim();
    const newName = projectFullName(newShortName, clientName);
    const newNumber =
      before.number !== null &&
      before.numberSerial !== null &&
      typeVal !== before.type &&
      isNumberedProjectType(typeVal)
        ? formatProjectNumber(typeVal, before.numberSerial)
        : before.number;

    const updated = await tx.project.update({
      where: { id },
      data: {
        shortName: newShortName,
        name: newName,
        type: typeVal,
        number: newNumber,
        ...(patch.clientId !== undefined && { clientId: newClientId }),
        ...(patch.responsibleUserId !== undefined && { responsibleUserId: patch.responsibleUserId }),
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.cashflowInitial !== undefined && { cashflowInitial: patch.cashflowInitial }),
      },
    });

    return { before, updated };
  });

  const changes = diff(
    {
      shortName: before.shortName,
      number: before.number,
      numberSerial: before.numberSerial,
      name: before.name,
      type: before.type,
      clientId: before.clientId,
      responsibleUserId: before.responsibleUserId,
      status: before.status,
    },
    {
      shortName: updated.shortName,
      number: updated.number,
      numberSerial: updated.numberSerial,
      name: updated.name,
      type: updated.type,
      clientId: updated.clientId,
      responsibleUserId: updated.responsibleUserId,
      status: updated.status,
    }
  );
  if (Object.keys(changes).length > 0) {
    await logActivity({
      userId,
      action: "update",
      entityType: "Project",
      entityId: id,
      entityLabel: updated.name,
      changes,
    });
  }

  return updated;
}

export async function archiveProject(id: string, userId: string) {
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) throw new Error("Project not found");
  const updated = await prisma.project.update({
    where: { id },
    data: { status: "archived" },
  });
  await logActivity({
    userId,
    action: "archive",
    entityType: "Project",
    entityId: id,
    entityLabel: updated.name,
  });
  return updated;
}

export async function unarchiveProject(id: string, userId: string) {
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) throw new Error("Project not found");
  const updated = await prisma.project.update({
    where: { id },
    data: { status: "active" },
  });
  await logActivity({
    userId,
    action: "unarchive",
    entityType: "Project",
    entityId: id,
    entityLabel: updated.name,
  });
  return updated;
}
