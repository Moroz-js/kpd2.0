import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin, isResponsible } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { listIssuedWorks } from "@/lib/views/issuedWorks";
import {
  dataSourcePrismaAdapter,
  resolveDataSource,
  SnapshotSourceError,
} from "@/lib/snapshots/data-source";

type Ctx = { params: Promise<{ id: string }> };

// Все работы проекта (Личные сметы + Прочие траты) для таблицы на дашборде (KPD-287).
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Права по live-проекту
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, responsibleUserId: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!isAdmin(user) && !(isResponsible(user) && project.responsibleUserId === user.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  const rows = await listIssuedWorks({ projectId: [id] }, db);
  return NextResponse.json(rows);
}
