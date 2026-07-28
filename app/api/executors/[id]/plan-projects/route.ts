import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canViewExecutorEstimate } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: executorId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canViewExecutorEstimate(user, executorId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const lines = await prisma.spendingPlanLine.findMany({
    where: { executorId },
    select: {
      project: {
        select: { id: true, name: true, status: true },
      },
    },
    distinct: ["projectId"],
  });

  const projects = lines
    .filter((l) => l.project && l.project.status !== "archived")
    .map((l) => ({ id: l.project!.id, name: l.project!.name }));

  // Deduplicate by id
  const seen = new Set<string>();
  const unique = projects.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return NextResponse.json(unique);
}
