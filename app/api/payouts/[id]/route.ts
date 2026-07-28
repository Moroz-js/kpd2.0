import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { deletePayout, updatePayout } from "@/lib/services/payouts";
import { zNullableDateString } from "@/lib/date-string";

const patchSchema = z.object({
  amount: z.number().positive().optional(),
  paymentAmount: z.number().positive().optional(),
  paymentStatus: z.enum(["planned", "paid"]).optional(),
  paidAt: zNullableDateString,
  plannedPayAt: zNullableDateString,
  bankAccountId: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  executorId: z.string().optional(),
  executionMonth: z.number().int().min(1).max(12).optional(),
  executionYear: z.number().int().optional(),
});

function parseId(id: string): { sourceType: "personal" | "other-expense"; sourceId: string } | null {
  const idx = id.indexOf(":");
  if (idx < 0) return null;
  const sourceType = id.slice(0, idx);
  const sourceId = id.slice(idx + 1);
  if (sourceType !== "personal" && sourceType !== "other-expense") return null;
  return { sourceType, sourceId };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const parsedId = parseId(id);
  if (!parsedId) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const patch = parsed.data;
  if (parsedId.sourceType === "personal") {
    if (
      patch.executorId !== undefined ||
      patch.executionMonth !== undefined ||
      patch.executionYear !== undefined
    ) {
      return NextResponse.json(
        { error: "Исполнитель и период у выплаты из Личной сметы редактируются только в источнике" },
        { status: 400 }
      );
    }
  }

  try {
    const updated = await updatePayout(
      parsedId.sourceType,
      parsedId.sourceId,
      {
        ...patch,
        paidAt:
          patch.paidAt === undefined
            ? undefined
            : patch.paidAt
              ? new Date(patch.paidAt)
              : null,
        plannedPayAt:
          patch.plannedPayAt === undefined
            ? undefined
            : patch.plannedPayAt
              ? new Date(patch.plannedPayAt)
              : null,
      },
      me.id
    );
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const status =
      msg.startsWith("Сумма выплаты привязана к работам") ||
      msg.startsWith("Сумма работы и сумма выплаты")
        ? 400
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const parsedId = parseId(id);
  if (!parsedId) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  try {
    const res = await deletePayout(parsedId.sourceType, parsedId.sourceId, me.id);
    return NextResponse.json(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
