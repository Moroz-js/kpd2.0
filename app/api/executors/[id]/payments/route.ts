import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canViewExecutorEstimate, isAdmin } from "@/lib/permissions";
import { createManualPayment } from "@/lib/services/payments";
import {
  dataSourcePrismaAdapter,
  resolveDataSource,
  SnapshotSourceError,
} from "@/lib/snapshots/data-source";
import { z } from "zod";

const createSchema = z.object({
  periodYear: z.number().int().min(2020).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  amount: z.number().positive(),
  paymentStatus: z.enum(["planned", "paid"]).optional(),
  bankAccountId: z.string().nullable().optional(),
  plannedPayAt: z.string().nullable().optional(),
  paidAt: z.string().nullable().optional(),
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

  const payments = await db.payment.findMany({
    where: { executorId },
    include: {
      bankAccount: { select: { id: true, name: true } },
      works: { select: { id: true, amount: true, workStatus: true, executionYear: true, executionMonth: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  return NextResponse.json(payments);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: executorId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const payment = await createManualPayment({ executorId, ...parsed.data }, user.id);
  return NextResponse.json(payment, { status: 201 });
}
