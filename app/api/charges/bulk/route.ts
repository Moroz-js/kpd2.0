import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { updateCharge } from "@/lib/services/charges";

const schema = z.object({
  ids: z.array(z.string()).min(1),
  patch: z.object({
    status: z.string().optional(),
  }),
});

export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation", details: parsed.error.flatten() }, { status: 400 });
  }

  const { ids, patch } = parsed.data;
  if (!patch.status) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const existing = await prisma.charge.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const validIds = new Set(existing.map((c) => c.id));

  let updated = 0;
  for (const id of ids) {
    if (!validIds.has(id)) continue;
    try {
      await updateCharge(id, { status: patch.status }, me.id);
      updated++;
    } catch { /* skip */ }
  }

  return NextResponse.json({ updated });
}
