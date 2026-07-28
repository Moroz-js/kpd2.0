import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { resolveDataSource, SnapshotSourceError } from "@/lib/snapshots/data-source";
import { SECTION_MODELS } from "@/lib/snapshots/schema";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const section = req.nextUrl.searchParams.get("section") ?? "";
  const models = SECTION_MODELS[section];
  if (!models) return NextResponse.json({ error: "Неизвестный раздел snapshot" }, { status: 400 });

  try {
    const source = await resolveDataSource(id);
    const data = await source.load(models);
    if (source.metadata) {
      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: "view",
          entityType: "SnapshotRun",
          entityId: source.metadata.id,
          entityLabel: `Просмотр снимка: ${section}`,
        },
      }).catch(() => undefined);
    }
    return NextResponse.json({ source: source.metadata, section, data });
  } catch (error) {
    if (error instanceof SnapshotSourceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
