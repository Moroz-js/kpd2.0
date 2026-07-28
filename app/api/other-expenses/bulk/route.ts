import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { zNullableDateString } from "@/lib/date-string";
import { checkOtherExpense, updateOtherExpense } from "@/lib/services/other-expenses";

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1),
  patch: z.object({
    workStatus: z.enum(["submitted", "checked", "paid", "rework"]).optional(),
    paymentStatus: z.enum(["planned", "paid"]).optional(),
    plannedPayAt: zNullableDateString,
    paidAt: zNullableDateString,
    bankAccountId: z.string().nullable().optional(),
  }),
});

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "Validation", details: parsed.error.flatten() }, { status: 400 });

  const { ids, patch } = parsed.data;
  if (Object.keys(patch).length === 0)
    return NextResponse.json({ updated: 0 });

  // Verify all IDs exist
  const existing = await prisma.otherExpense.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const validIds = new Set(existing.map((r) => r.id));

  let updated = 0;
  for (const id of ids) {
    if (!validIds.has(id)) continue;
    try {
      if (patch.workStatus === "checked") {
        const rest = { ...patch };
        delete rest.workStatus;
        if (Object.keys(rest).length > 0) {
          await updateOtherExpense(id, rest, user.id);
        }
        await checkOtherExpense(id, user.id);
      } else {
        await updateOtherExpense(id, patch, user.id);
      }
      updated++;
    } catch { /* skip */ }
  }

  return NextResponse.json({ updated });
}
