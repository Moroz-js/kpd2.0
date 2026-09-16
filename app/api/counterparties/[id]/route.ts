import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { getCounterparty, updateCounterparty } from "@/lib/services/counterparties";
import { COUNTERPARTY_LEGAL_TYPES } from "@/lib/statuses";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const row = await getCounterparty(id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  legalType: z
    .enum(Object.keys(COUNTERPARTY_LEGAL_TYPES) as [string, ...string[]])
    .nullable()
    .optional(),
  comment: z.string().nullable().optional(),
  uniqueProjectId: z.string().nullable().optional(),
  uniqueWorkTypeId: z.string().nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
  executorId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  bankAccountId: z.string().nullable().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const updated = await updateCounterparty(id, parsed.data, me.id);
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg.includes("not found")) return NextResponse.json({ error: msg }, { status: 404 });
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Контрагент с таким названием уже существует" },
        { status: 409 }
      );
    }
    if (msg.startsWith("Нельзя") || msg.startsWith("У контрагента")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
