import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { buildExportWorkbook } from "@/lib/services/excel-export";
import { resolveDataSource, SnapshotSourceError } from "@/lib/snapshots/data-source";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const snapshot = req.nextUrl.searchParams.get("snapshot") ?? "live";
  let source;
  try {
    source = await resolveDataSource(snapshot);
  } catch (error) {
    if (error instanceof SnapshotSourceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
  const buffer = await buildExportWorkbook(source);
  const date = source.metadata?.businessDate.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  if (source.metadata) {
    await prisma.activityLog.create({
      data: {
        userId: me.id,
        action: "download",
        entityType: "SnapshotRun",
        entityId: source.metadata.id,
        entityLabel: `Экспорт снимка ${date}`,
      },
    }).catch(() => undefined);
  }
  const filename = `Смета_${date}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
