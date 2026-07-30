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

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId)
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });

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
    where: { executorId, projectId },
    select: {
      workType: {
        select: { id: true, name: true },
      },
    },
  });

  const workTypes = lines
    .filter((l: { workType?: { id: string; name: string } | null }) => l.workType)
    .map((l: { workType: { id: string; name: string } }) => ({ id: l.workType.id, name: l.workType.name }));

  const seen = new Set<string>();
  const unique = workTypes.filter((wt: { id: string }) => {
    if (seen.has(wt.id)) return false;
    seen.add(wt.id);
    return true;
  });

  return NextResponse.json(unique);
}
