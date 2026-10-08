import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { MAX_CASHFLOW_RANGE_MONTHS, parseCashflowRange, rangeMonths } from "@/lib/cashflow-range";
import { buildCashflowRange, loadCashflowTables } from "@/lib/services/cashflow";
import {
  dataSourcePrismaAdapter,
  resolveDataSource,
  SnapshotSourceError,
} from "@/lib/snapshots/data-source";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const range = parseCashflowRange(
    req.nextUrl.searchParams.get("from"),
    req.nextUrl.searchParams.get("to")
  );
  if (rangeMonths(range) > MAX_CASHFLOW_RANGE_MONTHS) {
    return NextResponse.json({ error: "Период не может быть длиннее 60 месяцев" }, { status: 400 });
  }
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
  return NextResponse.json(buildCashflowRange(tables, range));
}
