import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { resolveDisplayChangesForItems } from "@/lib/audit/resolve-display-changes";
import {
  CASHFLOW_COMMENT_ACTIVITY_ENTITY_TYPE,
  SPENDING_PLAN_COMMENT_ACTIVITY_ENTITY_TYPE,
  cashflowCommentActivityId,
  commentActivityAuthorName,
  spendingPlanCommentActivityId,
} from "@/lib/comment-history";

const commonSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  week: z.coerce.number().int().min(1).max(53),
});

const cashflowSchema = commonSchema.extend({
  rowKey: z.string().min(1).max(200),
});

const spendingPlanSchema = commonSchema.extend({
  projectId: z.string().min(1),
  executorId: z.string().min(1),
  workTypeId: z.string().min(1),
});

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const kind = req.nextUrl.searchParams.get("kind");
  let entityType: string;
  let entityId: string;

  if (kind === "cashflow") {
    if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const parsed = cashflowSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams)
    );
    if (!parsed.success) return NextResponse.json({ error: "Validation" }, { status: 422 });

    // «Баланс руками» — отдельная сущность (значение), не комментарий: объединяем
    // историю значения (CashflowManualBalance) с историей комментария к ячейке.
    if (parsed.data.rowKey === "summary:manualBalance") {
      const { year, week } = parsed.data;
      const commentId = cashflowCommentActivityId(year, week, parsed.data.rowKey);
      const [commentItems, balanceItems] = await Promise.all([
        prisma.activityLog.findMany({
          where: { entityType: CASHFLOW_COMMENT_ACTIVITY_ENTITY_TYPE, entityId: commentId },
          orderBy: { createdAt: "desc" },
          take: 3,
          include: { user: { select: { fullName: true } } },
        }),
        prisma.activityLog.findMany({
          where: {
            entityType: "CashflowManualBalance",
            entityLabel: `Баланс руками · нед. ${week} / ${year}`,
          },
          orderBy: { createdAt: "desc" },
          take: 3,
          include: { user: { select: { fullName: true } } },
        }),
      ]);
      const merged = [...commentItems, ...balanceItems]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 3);
      const displayChanges = await resolveDisplayChangesForItems(merged);
      return NextResponse.json({
        items: merged.map((item, index) => ({
          id: item.id,
          action: item.action,
          createdAt: item.createdAt,
          authorName: commentActivityAuthorName(item.action, item.user.fullName),
          displayChanges: displayChanges[index] ?? [],
        })),
      });
    }

    entityType = CASHFLOW_COMMENT_ACTIVITY_ENTITY_TYPE;
    entityId = cashflowCommentActivityId(
      parsed.data.year,
      parsed.data.week,
      parsed.data.rowKey
    );
  } else if (kind === "spending-plan") {
    const parsed = spendingPlanSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams)
    );
    if (!parsed.success) return NextResponse.json({ error: "Validation" }, { status: 422 });

    const project = await prisma.project.findUnique({
      where: { id: parsed.data.projectId },
      select: { responsibleUserId: true },
    });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isAdmin(user) && project.responsibleUserId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    entityType = SPENDING_PLAN_COMMENT_ACTIVITY_ENTITY_TYPE;
    entityId = spendingPlanCommentActivityId(parsed.data);
  } else {
    return NextResponse.json({ error: "Validation" }, { status: 422 });
  }

  const items = await prisma.activityLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: 3,
    include: { user: { select: { fullName: true } } },
  });
  const displayChanges = await resolveDisplayChangesForItems(items);

  return NextResponse.json({
    items: items.map((item, index) => ({
      id: item.id,
      action: item.action,
      createdAt: item.createdAt,
      authorName: commentActivityAuthorName(item.action, item.user.fullName),
      displayChanges: displayChanges[index] ?? [],
    })),
  });
}
