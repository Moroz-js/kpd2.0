import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { projectCashflow } from "@/lib/snapshots/cashflow-projection.mjs";
import { resolveDataSource, SnapshotSourceError } from "@/lib/snapshots/data-source";
import { SECTION_MODELS } from "@/lib/snapshots/schema";
import {
  isWeekInRange,
  MAX_CASHFLOW_RANGE_MONTHS,
  parseCashflowRange,
  rangeMonths,
  rangeYears,
  type CashflowRange,
} from "@/lib/cashflow-range";

export const dynamic = "force-dynamic";

type ProjectionProject = {
  id: string; name: string; type: string;
  charges: number[]; plan: number[]; iw: number[]; cashflow: number[]; budgetCashflow: number[];
};

async function buildSeries(sourceId: string, range: CashflowRange) {
  const source = await resolveDataSource(sourceId);
  const tables = await source.load(SECTION_MODELS.cashflow);
  const metadata = source.metadata ?? null;
  const projectionDate = metadata?.cutoffAt ? new Date(metadata.cutoffAt) : new Date();

  const parts = rangeYears(range)
    .map((year) => {
      const data = projectCashflow(tables, year, projectionDate);
      const indices = (data.weeks as { week: number }[])
        .map((w, i) => (isWeekInRange(year, w.week, range) ? i : -1))
        .filter((i) => i >= 0);
      return { year, data, indices };
    })
    .filter((part) => part.indices.length > 0);

  const total = parts.reduce((sum, part) => sum + part.indices.length, 0);
  const concat = <T,>(select: (d: (typeof parts)[number]["data"]) => T[]): T[] =>
    parts.flatMap((part) => part.indices.map((i) => select(part.data)[i]));

  const projects = new Map<string, ProjectionProject>();
  let offset = 0;
  for (const part of parts) {
    for (const row of part.data.projects as ProjectionProject[]) {
      let target = projects.get(row.id);
      if (!target) {
        target = {
          id: row.id, name: row.name, type: row.type,
          charges: new Array(total).fill(0), plan: new Array(total).fill(0),
          iw: new Array(total).fill(0), cashflow: new Array(total).fill(0),
          budgetCashflow: new Array(total).fill(0),
        };
        projects.set(row.id, target);
      }
      part.indices.forEach((source, i) => {
        target!.charges[offset + i] = row.charges[source];
        target!.plan[offset + i] = row.plan[source];
        target!.iw[offset + i] = row.iw[source];
        target!.cashflow[offset + i] = row.cashflow[source];
        target!.budgetCashflow[offset + i] = row.budgetCashflow[source];
      });
    }
    offset += part.indices.length;
  }

  return {
    source: metadata ?? { id: "live", businessDate: null, cutoffAt: projectionDate },
    data: {
      weeks: parts.flatMap((part) =>
        part.indices.map((i) => ({ ...(part.data.weeks as object[])[i], year: part.year }))
      ),
      manualBalance: concat((d) => d.manualBalance as (number | null)[]),
      balanceEndDP: concat((d) => d.balanceEndDP as number[]),
      balanceEndBudget: concat((d) => d.balanceEndBudget as number[]),
      projects: [...projects.values()],
    },
  };
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const range = parseCashflowRange(
    req.nextUrl.searchParams.get("from"),
    req.nextUrl.searchParams.get("to")
  );
  if (rangeMonths(range) > MAX_CASHFLOW_RANGE_MONTHS) {
    return NextResponse.json({ error: "Период слишком длинный" }, { status: 400 });
  }
  const sourceA = req.nextUrl.searchParams.get("sourceA") ?? req.nextUrl.searchParams.get("source") ?? "live";
  const sourceB = req.nextUrl.searchParams.get("sourceB");
  if (sourceB && sourceA === sourceB) {
    return NextResponse.json({ error: "Для сравнения выберите разные источники" }, { status: 400 });
  }

  try {
    const [seriesA, seriesB] = await Promise.all([
      buildSeries(sourceA, range),
      sourceB ? buildSeries(sourceB, range) : Promise.resolve(null),
    ]);
    return NextResponse.json({ range, seriesA, seriesB });
  } catch (error) {
    if (error instanceof SnapshotSourceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
