import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  canAccessOtherExpenses,
  canEditOtherExpense,
  canDeleteOtherExpense,
} from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { updateOtherExpense, deleteOtherExpense } from "@/lib/services/other-expenses";
import { zNullableDateString } from "@/lib/date-string";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  projectId: z.string().optional(),
  executorId: z.string().optional(),
  workTypeId: z.string().optional(),
  responsibleExecutorId: z.string().optional(),
  bankAccountId: z.string().nullable().optional(),
  executionYear: z.number().int().min(2020).max(2100).optional(),
  executionMonth: z.number().int().min(1).max(12).optional(),
  description: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  paymentAmount: z.number().positive().nullable().optional(),
  preferredPayMethod: z.string().nullable().optional(),
  plannedPayAt: zNullableDateString,
  paidAt: zNullableDateString,
  workStatus: z.enum(["submitted", "checked", "paid", "rework"]).optional(),
  paymentStatus: z.enum(["planned", "paid"]).nullable().optional(),
  comment: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || !canAccessOtherExpenses(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = await prisma.otherExpense.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditOtherExpense(user, row)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation", details: parsed.error.flatten() }, { status: 422 });

  // Ответственный: после проверки менять нельзя; новый — только активный permanent.
  if (
    parsed.data.responsibleExecutorId !== undefined &&
    parsed.data.responsibleExecutorId !== row.responsibleExecutorId
  ) {
    if (row.workStatus === "checked" || row.workStatus === "paid") {
      return NextResponse.json(
        { error: "Ответственного нельзя менять после проверки работы" },
        { status: 422 }
      );
    }
    const exists = await prisma.executor.findFirst({
      where: { id: parsed.data.responsibleExecutorId, type: "permanent", status: "active" },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json(
        { error: "Выбранный ответственный не найден среди активных постоянных исполнителей" },
        { status: 422 }
      );
    }
  }

  try {
    const updated = await updateOtherExpense(id, parsed.data, user.id);
    return NextResponse.json(updated);
  } catch (e) {
    console.error("[other-expenses] PATCH failed:", e);
    const msg = e instanceof Error ? e.message : "Не удалось сохранить";
    const status = msg.startsWith("Сумма работы и сумма выплаты") ? 422 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || !canAccessOtherExpenses(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = await prisma.otherExpense.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canDeleteOtherExpense(user, row)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await deleteOtherExpense(id, user.id);
  return NextResponse.json({ ok: true });
}
