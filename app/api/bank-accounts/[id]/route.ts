import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { updateBankAccount } from "@/lib/services/bankAccounts";
import { STATEMENT_FORMATS } from "@/lib/statuses";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  details: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  currency: z.string().regex(/^[A-Za-z]{3,6}$/, "Код валюты: 3–6 латинских букв").optional(),
  statementFormat: z.enum(Object.keys(STATEMENT_FORMATS) as [string, ...string[]]).optional(),
  isDefault: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const updated = await updateBankAccount(id, parsed.data, me.id);
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Счёт с таким названием уже существует" },
        { status: 409 }
      );
    }
    if (msg.includes("Cannot unset")) {
      return NextResponse.json(
        { error: "Нельзя снять флаг — сначала назначьте другой счёт по умолчанию" },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
