import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { projectCashflow } from "@/lib/snapshots/cashflow-projection.mjs";
import { resolveDataSource, SnapshotSourceError } from "@/lib/snapshots/data-source";
import { SECTION_MODELS } from "@/lib/snapshots/schema";

export const dynamic = "force-dynamic";

async function buildSeries(sourceId: string, year: number) {
  const source = await resolveDataSource(sourceId);
  const tables = await source.load(SECTION_MODELS.cashflow);
  const metadata = source.metadata ?? null;
  const projectionDate = metadata?.cutoffAt ? new Date(metadata.cutoffAt) : new Date();
  return {
    source: metadata ?? { id: "live", businessDate: null, cutoffAt: projectionDate },
    data: projectCashflow(tables, year, projectionDate),
  };
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const year = Number(req.nextUrl.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    return NextResponse.json({ error: "Некорректный год" }, { status: 400 });
  }
  const sourceA = req.nextUrl.searchParams.get("sourceA") ?? req.nextUrl.searchParams.get("source") ?? "live";
  const sourceB = req.nextUrl.searchParams.get("sourceB");
  if (sourceB && sourceA === sourceB) {
    return NextResponse.json({ error: "Для сравнения выберите разные источники" }, { status: 400 });
  }

  try {
    const [seriesA, seriesB] = await Promise.all([
      buildSeries(sourceA, year),
      sourceB ? buildSeries(sourceB, year) : Promise.resolve(null),
    ]);
    return NextResponse.json({ year, seriesA, seriesB });
  } catch (error) {
    if (error instanceof SnapshotSourceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
