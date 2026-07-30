import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canViewExecutorEstimate } from "@/lib/permissions";
import {
  dataSourcePrismaAdapter,
  resolveDataSource,
  SnapshotSourceError,
} from "@/lib/snapshots/data-source";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: executorId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canViewExecutorEstimate(user, executorId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let source;
  try {
    source = await resolveDataSource(
      req.nextUrl.searchParams.get("source") ?? req.nextUrl.searchParams.get("snapshot")
    );
  } catch (error) {
    if (error instanceof SnapshotSourceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
  const db = dataSourcePrismaAdapter(source);

  const lines = await db.spendingPlanLine.findMany({
    where: { executorId },
    select: {
      project: {
        select: { id: true, name: true, status: true },
      },
    },
  });

  const projects = lines
    .filter((l: { project?: { id: string; name: string; status: string } | null }) => l.project && l.project.status !== "archived")
    .map((l: { project: { id: string; name: string } }) => ({ id: l.project.id, name: l.project.name }));

  const seen = new Set<string>();
  const unique = projects.filter((p: { id: string }) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return NextResponse.json(unique);
}
