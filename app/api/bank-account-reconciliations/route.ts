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

function isResultFilled(r: { foreignAmount: number | null; exchangeRate: number | null; amount: number | null; bankAccountCurrency: string }): boolean {
  if (r.bankAccountCurrency === "RUB") {
    return r.foreignAmount !== null && Number.isFinite(r.foreignAmount);
  }
  return r.foreignAmount !== null && Number.isFinite(r.foreignAmount) &&
    r.exchangeRate !== null && Number.isFinite(r.exchangeRate);
}

export async function GET(_req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const reconciliations = await prisma.bankAccountReconciliation.findMany({
    orderBy: { date: "desc" },
    include: {
      results: {
        include: { bankAccount: { select: { id: true, name: true, currency: true } } },
        orderBy: { bankAccount: { name: "asc" } },
      },
    },
  });

  return NextResponse.json(
    reconciliations.map((v) => {
      const resultsWithCurrency = v.results.map((r) => ({
        ...r,
        bankAccountCurrency: r.bankAccount.currency,
      }));
      const total = v.results.length;
      const filled = resultsWithCurrency.filter(isResultFilled).length;
      return {
        id: v.id,
        date: v.date.toISOString(),
        isoWeek: v.isoWeek,
        isoWeekYear: v.isoWeekYear,
        weekLabel: weekLabel(v.isoWeek),
        createdAt: v.createdAt.toISOString(),
        totalAccounts: total,
        filledAccounts: filled,
        progressPct: total === 0 ? 0 : Math.round((filled / total) * 100),
        results: v.results.map((r) => ({
          bankAccountId: r.bankAccountId,
          bankAccountName: r.bankAccount.name,
          bankAccountCurrency: r.bankAccount.currency,
          foreignAmount: r.foreignAmount ?? null,
          exchangeRate: r.exchangeRate ?? null,
          amount: r.amount ?? null,
          comment: r.comment ?? null,
        })),
      };
    })
  );
}

const createSchema = z.object({
  date: z.string(),
});

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation" }, { status: 422 });

  const date = new Date(parsed.data.date);
  const isoWeek = getISOWeek(date);
  const isoWeekYear = getISOWeekYear(date);

  const existing = await prisma.bankAccountReconciliation.findFirst({
    where: { isoWeek, isoWeekYear },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Остаток за ${weekLabel(isoWeek)} ${isoWeekYear} уже существует. Выберите другую дату.` },
      { status: 409 }
    );
  }

  const activeAccounts = await prisma.bankAccount.findMany({
    where: { status: "active" },
    select: { id: true },
  });

  const cashflowCommentValues = await captureCashflowCommentValues();
  const reconciliation = await prisma.bankAccountReconciliation.create({
    data: {
      date,
      isoWeek,
      isoWeekYear,
      createdBy: user.id,
      results: {
        create: activeAccounts.map((a) => ({ bankAccountId: a.id })),
      },
    },
  });
  await logCashflowCommentValueChanges(cashflowCommentValues, user.id);

  return NextResponse.json({ id: reconciliation.id }, { status: 201 });
}
