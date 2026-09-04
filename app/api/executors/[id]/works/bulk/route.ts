import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin, canViewExecutorEstimate } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { updateWork } from "@/lib/services/works";

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1),
  patch: z.object({
    workStatus: z.enum(["submitted", "checked", "rework"]).optional(),
    plannedPayAt: z.string().nullable().optional(),
  }),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: executorId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canViewExecutorEstimate(user, executorId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "Validation", details: parsed.error.flatten() }, { status: 400 });

  const { ids, patch } = parsed.data;

  // Verify all works belong to this executor (IDOR protection)
  const works = await prisma.work.findMany({
    where: { id: { in: ids }, executorId },
    select: { id: true, workStatus: true, paymentId: true },
  });

  if (works.length !== ids.length) {
    return NextResponse.json({ error: "Some works not found for this executor" }, { status: 400 });
  }

  if (patch.workStatus !== undefined) {
    if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden: status change requires admin" }, { status: 403 });
    // §5 (KPD-284): нельзя менять статус у работ, привязанных к выплате
    if (works.some((w) => w.paymentId)) {
      return NextResponse.json(
        { error: "Среди выбранных есть работы, привязанные к выплате — отвяжите их, чтобы изменить статус" },
        { status: 400 }
      );
    }
  }

  if (patch.workStatus === undefined && patch.plannedPayAt === undefined) {
    return NextResponse.json({ updated: 0 });
  }

  // Дата оплаты план привязанных работ управляется выплатой — обновляем только непривязанные;
  // каждое изменение проводится через сервис, чтобы фиксироваться в истории (audit log).
  let updated = 0;
  for (const work of works) {
    if (patch.plannedPayAt !== undefined && work.paymentId) continue;
    try {
      await updateWork(
        work.id,
        {
          ...(patch.workStatus !== undefined && { workStatus: patch.workStatus }),
          ...(patch.plannedPayAt !== undefined && { plannedPayAt: patch.plannedPayAt }),
        },
        user.id
      );
      updated++;
    } catch { /* skip */ }
  }

  return NextResponse.json({ updated });
}
