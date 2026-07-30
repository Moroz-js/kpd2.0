import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canViewExecutorEstimate, isAdmin } from "@/lib/permissions";
import { createTask, listTasksForExecutor } from "@/lib/services/tasks";
import {
  dataSourcePrismaAdapter,
  resolveDataSource,
  SnapshotSourceError,
} from "@/lib/snapshots/data-source";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1),
  status: z.string().optional(),
  plannedDoneAt: z.string().nullable().optional(),
  result: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: executorId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = await canViewExecutorEstimate(user, executorId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  const tasks = await listTasksForExecutor(executorId, db);
  return NextResponse.json(tasks);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: executorId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const task = await createTask(executorId, parsed.data, user.id);
  return NextResponse.json(task, { status: 201 });
}
