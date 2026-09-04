import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { resolveDisplayChangesForItems } from "@/lib/audit/resolve-display-changes";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const entityType = req.nextUrl.searchParams.get("entityType");
  const entityId = req.nextUrl.searchParams.get("entityId");
  if (!entityType || !entityId) {
    return NextResponse.json(
      { error: "entityType and entityId are required" },
      { status: 400 }
    );
  }

  const where = { entityType, entityId };
  const include = { user: { select: { fullName: true, role: true } } };
  const creation = await prisma.activityLog.findFirst({
    where: { ...where, action: "create" },
    orderBy: { createdAt: "asc" },
    include,
  });
  const items = await prisma.activityLog.findMany({
    where: creation ? { ...where, id: { not: creation.id } } : where,
    orderBy: { createdAt: "desc" },
    take: 3,
    include,
  });

  const logsWithChanges = creation ? [creation, ...items] : items;
  const displayChangesList = await resolveDisplayChangesForItems(logsWithChanges);
  const creationDisplayChanges = creation ? displayChangesList[0] ?? [] : [];
  const itemsOffset = creation ? 1 : 0;

  return NextResponse.json({
    creation: creation && {
      ...creation,
      displayChanges: creationDisplayChanges,
    },
    items: items.map((item, index) => ({
      ...item,
      displayChanges: displayChangesList[index + itemsOffset] ?? [],
    })),
  });
}
