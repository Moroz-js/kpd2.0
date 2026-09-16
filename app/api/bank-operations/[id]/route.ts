import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { updateBankOperation } from "@/lib/services/bankOperations";
import { BANK_OPERATION_STATUSES, BANK_COUNTERPARTY_TYPES } from "@/lib/statuses";

const patchSchema = z.object({
  counterpartyId: z.string().nullable().optional(),
  counterpartyName: z.string().nullable().optional(),
  counterpartyType: z.enum(Object.keys(BANK_COUNTERPARTY_TYPES) as [string, ...string[]]).nullable().optional(),
  projectId: z.string().nullable().optional(),
  workTypeId: z.string().nullable().optional(),
  workDescription: z.string().nullable().optional(),
  paymentOrder: z.string().nullable().optional(),
  paymentPurpose: z.string().nullable().optional(),
  basis: z.string().nullable().optional(),
  kind: z.enum(["incoming", "outgoing"]).optional(),
  isInternalTransfer: z.boolean().optional(),
  status: z.enum(Object.keys(BANK_OPERATION_STATUSES) as [string, ...string[]]).optional(),
  comment: z.string().nullable().optional(),
  rememberBy: z.enum(["name", "account", "inn"]).nullable().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const updated = await updateBankOperation(id, parsed.data, me.id);
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg.includes("not found")) {
      return NextResponse.json({ error: "Операция не найдена" }, { status: 404 });
    }
    if (msg.includes("Нельзя подтвердить") || msg.includes("нельзя редактировать")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
