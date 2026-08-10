import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/audit/log";
import { withSerializableTransaction } from "@/lib/services/entity-numbering";
import { mergeSpendingPlanValues } from "@/lib/spending-plan";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

function canManage(user: Awaited<ReturnType<typeof getSessionUser>>, project: { responsibleUserId: string | null }) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return project.responsibleUserId === user.id;
}

const upsertSchema = z.object({
  executorId: z.string().min(1),
  workTypeId: z.string().min(1),
  year: z.number().int(),
  week: z.number().int().min(1).max(53),
  amount: z.number().min(0).optional(),
  comment: z.string().max(2000).nullable().optional(),
  sourceType: z.string().nullable().optional(),
}).refine((data) => data.amount !== undefined || data.comment !== undefined, {
  message: "Укажите сумму или комментарий",
});

const deleteSchema = z.object({ id: z.string().min(1) });

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id: projectId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { responsibleUserId: true } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canManage(user, project)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation", details: parsed.error.flatten() }, { status: 422 });

  const { executorId, workTypeId, year, week, amount, comment, sourceType } = parsed.data;

  const { line, action } = await withSerializableTransaction(async (tx) => {
    const existingRows = await tx.spendingPlanLine.findMany({
      where: { projectId, executorId, workTypeId, year, week },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const existing = existingRows[0];

    if (existing) {
      const merged = mergeSpendingPlanValues(existingRows, {
        amount,
        comment,
        sourceType,
      });
      const duplicateIds = existingRows.slice(1).map((row) => row.id);
      if (duplicateIds.length > 0) {
        await tx.spendingPlanLine.deleteMany({
          where: { id: { in: duplicateIds } },
        });
      }
      return {
        line: await tx.spendingPlanLine.update({
          where: { id: existing.id },
          data: merged,
        }),
        action: "update" as const,
      };
    }

    // Комментарий в пустой ячейке создаёт строку-якорь с amount=0.
    return {
      line: await tx.spendingPlanLine.create({
        data: {
          projectId,
          executorId,
          workTypeId,
          year,
          week,
          amount: amount ?? 0,
          comment: comment?.trim() || null,
          sourceType: sourceType ?? null,
          createdById: user.id,
        },
      }),
      action: "create" as const,
    };
  });

  await logActivity({
    userId: user.id,
    action,
    entityType: "SpendingPlanLine",
    entityId: line.id,
    entityLabel: `Нед. ${week} / ${year}`,
  });

  return NextResponse.json(line);
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id: projectId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { responsibleUserId: true } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canManage(user, project)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation" }, { status: 422 });

  await prisma.spendingPlanLine.delete({ where: { id: parsed.data.id } });
  return NextResponse.json({ ok: true });
}
