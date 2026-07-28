import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canViewExecutorEstimate } from "@/lib/permissions";
import { prisma } from "@/lib/db";

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

  const lines = await prisma.spendingPlanLine.findMany({
    where: { executorId, projectId },
    select: {
      workType: {
        select: { id: true, name: true },
      },
    },
    distinct: ["workTypeId"],
  });

  const workTypes = lines
    .filter((l) => l.workType)
    .map((l) => ({ id: l.workType!.id, name: l.workType!.name }));

  return NextResponse.json(workTypes);
}
