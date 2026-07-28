import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/permissions";
import { createManualSnapshot } from "@/lib/snapshots/manual-snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function previousMoscowDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  const date = new Date(Date.UTC(values.year, values.month - 1, values.day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [runs, lastFailure] = await Promise.all([
    prisma.snapshotRun.findMany({
      where: { status: "completed", objectPrefix: { not: null } },
      orderBy: { cutoffAt: "desc" },
      select: {
        id: true,
        businessDate: true,
        cutoffAt: true,
        completedAt: true,
        status: true,
        runKind: true,
        schemaVersion: true,
        formulaVersion: true,
        rowCounts: true,
        byteSize: true,
        contentHash: true,
      },
    }),
    prisma.snapshotRun.findFirst({
      where: { status: "failed", runKind: "scheduled" },
      orderBy: { completedAt: "desc" },
      select: { id: true, businessDate: true, completedAt: true, error: true },
    }),
  ]);
  const expectedDate = previousMoscowDate();
  return NextResponse.json({
    snapshots: runs.map((run) => ({
      ...run,
      businessDate: run.businessDate.toISOString().slice(0, 10),
      rowCounts: run.rowCounts ? JSON.parse(run.rowCounts) : null,
    })),
    health: {
      expectedDate,
      available: runs.some(
        (run) =>
          run.runKind === "scheduled" &&
          run.businessDate.toISOString().slice(0, 10) === expectedDate
      ),
      lastFailure: lastFailure
        ? { ...lastFailure, businessDate: lastFailure.businessDate.toISOString().slice(0, 10) }
        : null,
    },
  });
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const result = await createManualSnapshot();
    if (result.busy) {
      return NextResponse.json(
        { error: "Другой снимок уже создаётся. Повторите позже." },
        { status: 409 }
      );
    }
    const { run } = result;

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "create",
        entityType: "SnapshotRun",
        entityId: run.id,
        entityLabel: `Ручной снимок ${run.cutoffAt.toISOString()}`,
      },
    }).catch(() => undefined);

    return NextResponse.json(
      {
        snapshot: {
          id: run.id,
          businessDate: run.businessDate.toISOString().slice(0, 10),
          cutoffAt: run.cutoffAt.toISOString(),
          completedAt: run.completedAt?.toISOString() ?? null,
          runKind: run.runKind,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось создать снимок";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
