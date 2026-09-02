import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { logActivity } from "@/lib/audit/log";
import { prisma } from "@/lib/db";
import { getISOWeeksInYear } from "@/lib/iso-weeks";
import { isAdmin } from "@/lib/permissions";
import {
  captureCashflowCommentValues,
  logCashflowCommentValueChanges,
} from "@/lib/cashflow-comment-activity";

const yearSchema = z.number().int().min(2020).max(2100);
const putSchema = z.object({
  year: yearSchema,
  week: z.number().int().min(1).max(53),
  amount: z.number().finite().nullable(),
});

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const year = Number(req.nextUrl.searchParams.get("year"));
  const parsedYear = yearSchema.safeParse(year);
  if (!parsedYear.success) {
    return NextResponse.json({ error: "Некорректный год" }, { status: 422 });
  }

  const weeksInYear = getISOWeeksInYear(parsedYear.data);
  const rows = await prisma.cashflowManualBalance.findMany({
    where: { year: parsedYear.data },
    select: { week: true, amount: true },
  });
  const manualBalance: (number | null)[] = new Array(weeksInYear).fill(null);
  for (const row of rows) {
    if (row.week >= 1 && row.week <= weeksInYear) {
      manualBalance[row.week - 1] = row.amount;
    }
  }

  return NextResponse.json({ year: parsedYear.data, manualBalance });
}

export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 422 });
  }

  const { year, week, amount } = parsed.data;
  if (week > getISOWeeksInYear(year)) {
    return NextResponse.json({ error: "Неделя не существует в этом году" }, { status: 422 });
  }

  const existing = await prisma.cashflowManualBalance.findUnique({
    where: { year_week: { year, week } },
  });
  if ((existing?.amount ?? null) === amount) {
    return NextResponse.json(existing ?? { year, week, amount: null });
  }
  const cashflowCommentValues = await captureCashflowCommentValues();

  let record;
  if (amount === null) {
    if (!existing) return NextResponse.json({ year, week, amount: null });
    record = await prisma.cashflowManualBalance.delete({ where: { id: existing.id } });
  } else {
    record = await prisma.cashflowManualBalance.upsert({
      where: { year_week: { year, week } },
      update: { amount },
      create: { year, week, amount },
    });
  }

  await logActivity({
    userId: user.id,
    action: amount === null ? "delete" : existing ? "update" : "create",
    entityType: "CashflowManualBalance",
    entityId: record.id,
    entityLabel: `Баланс руками · нед. ${week} / ${year}`,
    changes: { amount: { from: existing?.amount ?? null, to: amount } },
  });
  await logCashflowCommentValueChanges(
    cashflowCommentValues,
    user.id,
    (cell) => cell.rowKey === "summary:manualBalance"
  );

  return NextResponse.json({ year, week, amount });
}
