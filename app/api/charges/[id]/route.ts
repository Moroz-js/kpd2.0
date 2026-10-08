import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { updateCharge, deleteCharge } from "@/lib/services/charges";
import { prisma } from "@/lib/db";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  bankAccountId: z.string().optional(),
  orderId: z.string().optional(),
  amount: z.number().positive().nullable().optional(),
  issuedPlanAt: z.string().nullable().optional(),
  issuedAt: z.string().nullable().optional(),
  paidPlanAt: z.string().nullable().optional(),
  paidAt: z.string().nullable().optional(),
  paymentPurpose: z.string().nullable().optional(),
  status: z.enum(["planned", "to_pay", "pending_approval", "paid"]).optional(),
  paymentProbability: z.enum(["high", "medium", "low"]).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation", details: parsed.error.flatten() }, { status: 422 });

  if (parsed.data.status === "paid") {
    const existing = await prisma.charge.findUnique({ where: { id }, select: { paidAt: true } });
    const paidAt = parsed.data.paidAt !== undefined ? parsed.data.paidAt : existing?.paidAt;
    if (!paidAt) {
      return NextResponse.json({ error: "Укажите дату оплаты для статуса «Оплачено»" }, { status: 400 });
    }
  }

  try {
    const updated = await updateCharge(id, parsed.data, user.id);
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await deleteCharge(id, user.id);
  return NextResponse.json({ ok: true });
}
