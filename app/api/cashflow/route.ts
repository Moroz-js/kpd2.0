import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { buildCashflowYear, loadCashflowTables } from "@/lib/services/cashflow";
import {
  dataSourcePrismaAdapter,
  resolveDataSource,
  SnapshotSourceError,
} from "@/lib/snapshots/data-source";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam) : new Date().getFullYear();
  let source;
  try {
    source = await resolveDataSource(req.nextUrl.searchParams.get("source"));
  } catch (error) {
    if (error instanceof SnapshotSourceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  const tables = await loadCashflowTables(dataSourcePrismaAdapter(source) as never);
  return NextResponse.json(buildCashflowYear(tables, year));
}
