import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { updatePayout } from "@/lib/services/payouts";

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1),
  patch: z.object({
    paymentStatus: z.enum(["planned", "paid"]).optional(),
    plannedPayAt: z.string().nullable().optional(),
    paidAt: z.string().nullable().optional(),
    bankAccountId: z.string().nullable().optional(),
  }),
});

function parseId(id: string): { sourceType: "personal" | "other-expense"; sourceId: string } | null {
  const idx = id.indexOf(":");
  if (idx < 0) return null;
  const sourceType = id.slice(0, idx);
  const sourceId = id.slice(idx + 1);
  if (sourceType !== "personal" && sourceType !== "other-expense") return null;
  return { sourceType, sourceId };
}

export async function POST(req: NextRequest) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "Validation", details: parsed.error.flatten() }, { status: 400 });

  const { ids, patch } = parsed.data;
  if (Object.keys(patch).length === 0)
    return NextResponse.json({ updated: 0 });

  const patchForService = {
    ...patch,
    paidAt: patch.paidAt === undefined ? undefined : patch.paidAt ? new Date(patch.paidAt) : null,
    plannedPayAt: patch.plannedPayAt === undefined ? undefined : patch.plannedPayAt ? new Date(patch.plannedPayAt) : null,
  };

  let updated = 0;
  const errors: string[] = [];

  for (const id of ids) {
    const parsedId = parseId(id);
    if (!parsedId) { errors.push(id); continue; }
    try {
      await updatePayout(parsedId.sourceType, parsedId.sourceId, patchForService, me.id);
      updated++;
    } catch {
      errors.push(id);
    }
  }

  return NextResponse.json({ updated, errors });
}
