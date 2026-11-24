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
  amount: z.number().finite().nullable(),
});

export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation" }, { status: 422 });

  const { year, amount } = parsed.data;
  const previous = await prisma.cashflowOpeningBalance.findUnique({ where: { year } });
  if ((previous?.amount ?? null) === amount) return NextResponse.json({ year, amount });

  const cashflowCommentValues = await captureCashflowCommentValues();
  if (amount === null) {
    // Нет записи — год снова следует за декабрём, в том числе при последующих правках.
    await prisma.cashflowOpeningBalance.deleteMany({ where: { year } });
  } else {
    await prisma.cashflowOpeningBalance.upsert({
      where: { year }, update: { amount }, create: { year, amount },
    });
  }
  await logCashflowCommentValueChanges(
    cashflowCommentValues,
    user.id,
    (cell) => cell.year === parsed.data.year && cell.week === 1 && cell.rowKey === "summary:balanceStart"
  );
  return NextResponse.json({ year, amount });
}
