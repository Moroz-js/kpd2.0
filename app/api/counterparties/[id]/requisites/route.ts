import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { addRequisite } from "@/lib/services/counterparties";
import { inferPaymentMethod } from "@/lib/counterparty-requisites";
import { COUNTERPARTY_PAYMENT_METHODS } from "@/lib/statuses";

const createSchema = z.object({
  paymentMethod: z
    .enum(Object.keys(COUNTERPARTY_PAYMENT_METHODS) as [string, ...string[]])
    .optional(),
  taxId: z.string().nullable().optional(),
  bic: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  accountNumber: z.string().nullable().optional(),
  cardNumber: z.string().nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
  comment: z.string().nullable().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const created = await addRequisite(
      id,
      {
        ...parsed.data,
        paymentMethod: parsed.data.paymentMethod ?? inferPaymentMethod(parsed.data),
      },
      me.id
    );
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg.includes("not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
