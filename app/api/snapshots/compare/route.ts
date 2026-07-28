import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { diffEntities, unionEntityKey } from "@/lib/snapshots/diff";
import { resolveDataSource, SnapshotSourceError } from "@/lib/snapshots/data-source";
import { SECTION_MODELS, type SnapshotRecord } from "@/lib/snapshots/schema";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function keyOf(row: SnapshotRecord) {
  return unionEntityKey(row);
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sourceA = req.nextUrl.searchParams.get("sourceA");
  const sourceB = req.nextUrl.searchParams.get("sourceB");
  const section = req.nextUrl.searchParams.get("section") ?? "";
  const models = SECTION_MODELS[section];
  if (!sourceA || !sourceB || sourceA === sourceB) {
    return NextResponse.json({ error: "Нужны два разных источника" }, { status: 400 });
  }
  if (!models) return NextResponse.json({ error: "Неизвестный раздел snapshot" }, { status: 400 });

  try {
    const [left, right] = await Promise.all([resolveDataSource(sourceA), resolveDataSource(sourceB)]);
    const [dataA, dataB] = await Promise.all([left.load(models), right.load(models)]);
    const diff = Object.fromEntries(
      models.map((model) => [
        model,
        diffEntities(dataA[model] ?? [], dataB[model] ?? [], keyOf),
      ])
    );
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "compare",
        entityType: "SnapshotRun",
        entityId: `${sourceA}:${sourceB}`.slice(0, 190),
        entityLabel: `Сравнение снимков: ${section}`,
      },
    }).catch(() => undefined);
    return NextResponse.json({
      sourceA: left.metadata ?? { id: "live" },
      sourceB: right.metadata ?? { id: "live" },
      section,
      diff,
    });
  } catch (error) {
    if (error instanceof SnapshotSourceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
