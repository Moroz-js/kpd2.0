import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const yearRaw = req.nextUrl.searchParams.get("year");
  const year = yearRaw ? Number(yearRaw) : null;
  if (year != null && (!Number.isInteger(year) || year < 2000 || year > 2200)) {
    return NextResponse.json({ error: "Некорректный год" }, { status: 400 });
  }

  const snapshots = await prisma.snapshotRun.findMany({
    where: {
      status: "completed",
      objectPrefix: { not: null },
    },
    orderBy: { cutoffAt: "desc" },
    select: {
      id: true,
      businessDate: true,
      cutoffAt: true,
      completedAt: true,
      formulaVersion: true,
      runKind: true,
    },
  });

  return NextResponse.json({
    snapshots: snapshots.map((snapshot) => ({
      ...snapshot,
      businessDate: snapshot.businessDate.toISOString().slice(0, 10),
    })),
  });
}
