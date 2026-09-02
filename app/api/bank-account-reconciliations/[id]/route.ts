import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getISOWeek, getISOWeekYear } from "@/lib/iso-weeks";
import { weekLabel } from "@/lib/format";
import {
  captureCashflowCommentValues,
  logCashflowCommentValueChanges,
} from "@/lib/cashflow-comment-activity";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const cashflowCommentValues = await captureCashflowCommentValues();
  await prisma.bankAccountReconciliation.delete({ where: { id } });
  await logCashflowCommentValueChanges(cashflowCommentValues, user.id);
  return NextResponse.json({ ok: true });
}

const patchSchema = z.object({
  date: z.string(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation" }, { status: 422 });

  const date = new Date(parsed.data.date);
  const isoWeek = getISOWeek(date);
  const isoWeekYear = getISOWeekYear(date);

  const conflict = await prisma.bankAccountReconciliation.findFirst({
    where: { isoWeek, isoWeekYear, id: { not: id } },
  });
  if (conflict) {
    return NextResponse.json(
      { error: `Остаток за ${weekLabel(isoWeek)} ${isoWeekYear} уже существует. Выберите другую дату.` },
      { status: 409 }
    );
  }

  const cashflowCommentValues = await captureCashflowCommentValues();
  const updated = await prisma.bankAccountReconciliation.update({
    where: { id },
    data: { date, isoWeek, isoWeekYear },
  });
  await logCashflowCommentValueChanges(cashflowCommentValues, user.id);

  return NextResponse.json({ id: updated.id, date: updated.date.toISOString(), isoWeek, isoWeekYear, weekLabel: weekLabel(isoWeek) });
}
