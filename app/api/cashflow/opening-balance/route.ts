import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import {
  captureCashflowCommentValues,
  logCashflowCommentValueChanges,
} from "@/lib/cashflow-comment-activity";
import { z } from "zod";

const schema = z.object({
  year: z.number().int().min(2020).max(2100),
  amount: z.number(),
});

export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation" }, { status: 422 });

  const cashflowCommentValues = await captureCashflowCommentValues();
  const record = await prisma.cashflowOpeningBalance.upsert({
    where: { year: parsed.data.year },
    update: { amount: parsed.data.amount },
    create: { year: parsed.data.year, amount: parsed.data.amount },
  });
  await logCashflowCommentValueChanges(
    cashflowCommentValues,
    user.id,
    (cell) => cell.year === parsed.data.year && cell.week === 1 && cell.rowKey === "summary:balanceStart"
  );
  return NextResponse.json(record);
}
