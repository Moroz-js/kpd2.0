import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { createCharge, listCharges } from "@/lib/services/charges";
import { z } from "zod";

const createSchema = z.object({
  bankAccountId: z.string().nullable().optional(),
  orderId: z.string().nullable().optional(),
  amount: z.number().positive().nullable().optional(),
  issuedPlanAt: z.string().nullable().optional(),
  issuedAt: z.string().nullable().optional(),
  paidPlanAt: z.string().nullable().optional(),
  paidAt: z.string().nullable().optional(),
  paymentPurpose: z.string().nullable().optional(),
  status: z.enum(["planned", "to_pay", "pending_approval", "paid"]).optional(),
  paymentProbability: z.enum(["high", "medium", "low"]).nullable().optional(),
});

export async function GET(_req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = await listCharges();
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation", details: parsed.error.flatten() }, { status: 422 });

  try {
    const charge = await createCharge(parsed.data, user.id);
    return NextResponse.json(charge, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
