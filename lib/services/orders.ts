/**
 * OrderService (TDNB-19).
 *
 * orderNumber — строка формата "З001", "З002", ...
 * Новые заказы нумеруются с З3000.
 * Используем транзакцию против race conditions.
 */

import { prisma } from "@/lib/db";
import { logActivity, diff } from "@/lib/audit/log";
import {
  captureCashflowCommentValues,
  logCashflowCommentValueChanges,
} from "@/lib/cashflow-comment-activity";

const ORDER_NUMBER_START = 3000;

export type OrderListRow = {
  id: string;
  orderNumber: string;
  description: string | null;
  contractNumber: string | null;
  status: string;
  projectId: string;
  projectName: string;
  clientId: string | null;
  clientName: string | null;
  company: string | null;
  hasUnpaidCharges: boolean;
  createdAt: Date;
};

export async function listOrders(): Promise<OrderListRow[]> {
  const orders = await prisma.order.findMany({
    orderBy: { orderNumber: "desc" },
    include: {
      project: { include: { client: { select: { id: true, name: true, company: true } } } },
      charges: { select: { status: true } },
    },
  });

  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    description: o.description,
    contractNumber: o.contractNumber,
    status: o.status,
    projectId: o.projectId,
    projectName: o.project.name,
    clientId: o.project.client?.id ?? null,
    clientName: o.project.client?.name ?? null,
    company: o.project.client?.company ?? null,
    hasUnpaidCharges: o.charges.some((c) => c.status !== "paid"),
    createdAt: o.createdAt,
  }));
}

export type CreateOrderInput = {
  description: string;
  projectId: string;
  contractNumber?: string | null;
};

export async function createOrder(input: CreateOrderInput, userId: string) {
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new Error("Project not found");
  if (project.status === "archived") throw new Error("Cannot create order for archived project");

  const created = await prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({ select: { orderNumber: true } });
    const lastNum = orders.reduce((max, o) => {
      const n = parseInt(o.orderNumber.replace(/\D/g, "")) || 0;
      return n > max ? n : max;
    }, ORDER_NUMBER_START - 1);
    const nextNum = lastNum < ORDER_NUMBER_START ? ORDER_NUMBER_START : lastNum + 1;
    const nextNumber = `З${nextNum}`;
    return tx.order.create({
      data: {
        orderNumber: nextNumber,
        description: input.description.trim(),
        projectId: input.projectId,
        contractNumber: input.contractNumber?.trim() || null,
        status: "active",
      },
    });
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "Order",
    entityId: created.id,
    entityLabel: `№${created.orderNumber}`,
  });

  return created;
}

export type UpdateOrderInput = {
  description?: string;
  projectId?: string;
  contractNumber?: string | null;
  status?: string;
};

export async function updateOrder(id: string, patch: UpdateOrderInput, userId: string) {
  const before = await prisma.order.findUnique({ where: { id } });
  if (!before) throw new Error("Order not found");
  const cashflowCommentValues = await captureCashflowCommentValues();

  const updated = await prisma.order.update({
    where: { id },
    data: {
      ...(patch.description !== undefined && { description: patch.description.trim() }),
      ...(patch.projectId !== undefined && { projectId: patch.projectId }),
      ...(patch.contractNumber !== undefined && {
        contractNumber: patch.contractNumber?.trim() || null,
      }),
      ...(patch.status !== undefined && { status: patch.status }),
    },
  });

  const changes = diff(
    {
      description: before.description,
      projectId: before.projectId,
      contractNumber: before.contractNumber,
      status: before.status,
    },
    {
      description: updated.description,
      projectId: updated.projectId,
      contractNumber: updated.contractNumber,
      status: updated.status,
    }
  );
  if (Object.keys(changes).length > 0) {
    await logActivity({
      userId,
      action: "update",
      entityType: "Order",
      entityId: id,
      entityLabel: `№${updated.orderNumber}`,
      changes,
    });
  }
  await logCashflowCommentValueChanges(cashflowCommentValues, userId);

  return updated;
}

export async function archiveOrder(id: string, userId: string) {
  const o = await prisma.order.findUnique({ where: { id } });
  if (!o) throw new Error("Order not found");
  const updated = await prisma.order.update({ where: { id }, data: { status: "archived" } });
  await logActivity({
    userId,
    action: "archive",
    entityType: "Order",
    entityId: id,
    entityLabel: `№${updated.orderNumber}`,
  });
  return updated;
}

export async function unarchiveOrder(id: string, userId: string) {
  const o = await prisma.order.findUnique({ where: { id } });
  if (!o) throw new Error("Order not found");
  const updated = await prisma.order.update({ where: { id }, data: { status: "active" } });
  await logActivity({
    userId,
    action: "unarchive",
    entityType: "Order",
    entityId: id,
    entityLabel: `№${updated.orderNumber}`,
  });
  return updated;
}
