import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { updatePayment, deletePaymentForExecutor } from "@/lib/services/payments";
import { prisma } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  amount: z.number().positive().optional(),
  paymentStatus: z.enum(["planned", "paid"]).optional(),
  bankAccountId: z.string().nullable().optional(),
  plannedPayAt: z.string().nullable().optional(),
  paidAt: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  periodYear: z.number().int().min(2020).max(2100).optional(),
  periodMonth: z.number().int().min(1).max(12).optional(),
  filledTechTask: z.string().nullable().optional(),
  filledAct: z.string().nullable().optional(),
});

type Ctx = { params: Promise<{ id: string; paymentId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id: executorId, paymentId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.executorId !== executorId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    await updatePayment(paymentId, parsed.data, user.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Не удалось сохранить выплату";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const updated = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      bankAccount: { select: { id: true, name: true } },
      works: { select: { id: true, amount: true, workStatus: true, executionYear: true, executionMonth: true } },
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id: executorId, paymentId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.executorId !== executorId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await deletePaymentForExecutor(paymentId, user.id);
  return NextResponse.json({ ok: true });
}
