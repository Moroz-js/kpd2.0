import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { resolveDisplayChangesForItems } from "@/lib/audit/resolve-display-changes";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const pageSize = 50;
  const entityType = sp.get("entityType") ?? undefined;
  const userIds = sp.getAll("userId").filter(Boolean);

  const where = {
    ...(entityType ? { entityType } : {}),
    ...(userIds.length > 0 ? { userId: { in: userIds } } : {}),
  };

  const [items, total, entityTypes, userIdRows] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { fullName: true, role: true } } },
    }),
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      where: userIds.length > 0 ? { userId: { in: userIds } } : {},
      distinct: ["entityType"],
      select: { entityType: true },
    }),
    prisma.activityLog.findMany({
      where: entityType ? { entityType } : {},
      distinct: ["userId"],
      select: { userId: true },
    }),
  ]);

  const displayChangesList = await resolveDisplayChangesForItems(items);

  return NextResponse.json({
    items: items.map((item, i) => ({
      ...item,
      displayChanges: displayChangesList[i] ?? [],
    })),
    total,
    page,
    pageSize,
    available: {
      entityTypes: entityTypes.map((item) => item.entityType),
      userIds: userIdRows.map((item) => item.userId),
    },
  });
}
