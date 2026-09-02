import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import {
  captureCashflowCommentValues,
  logCashflowCommentValueChanges,
} from "@/lib/cashflow-comment-activity";

const schema = z.object({
  foreignAmount: z.number().nullable().optional(),
  exchangeRate: z.number().nullable().optional(),
  comment: z.string().nullable().optional(),
});

function calcAmount(
  foreignAmount: number | null | undefined,
  exchangeRate: number | null | undefined,
  currency: string
): number | null {
  if (foreignAmount == null || !Number.isFinite(foreignAmount)) return null;
  if (currency === "RUB") return foreignAmount;
  if (exchangeRate == null || !Number.isFinite(exchangeRate)) return null;
  return Math.round(foreignAmount * exchangeRate * 100) / 100;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; bankAccountId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: reconciliationId, bankAccountId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation" }, { status: 422 });

  const current = await prisma.bankAccountReconciliationResult.findUnique({
    where: { reconciliationId_bankAccountId: { reconciliationId, bankAccountId } },
    include: { bankAccount: { select: { currency: true } } },
  });
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const currency = current.bankAccount.currency;

  const data: {
    foreignAmount?: number | null;
    exchangeRate?: number | null;
    amount?: number | null;
    comment?: string | null;
  } = {};

  if (parsed.data.foreignAmount !== undefined) data.foreignAmount = parsed.data.foreignAmount;
  if (parsed.data.exchangeRate !== undefined && currency !== "RUB") {
    data.exchangeRate = parsed.data.exchangeRate != null
      ? Math.round(parsed.data.exchangeRate * 100) / 100
      : null;
  }
  if (currency === "RUB") data.exchangeRate = null;
  if (parsed.data.comment !== undefined) data.comment = parsed.data.comment;

  const newForeignAmount = data.foreignAmount !== undefined ? data.foreignAmount : current.foreignAmount;
  const newExchangeRate = data.exchangeRate !== undefined ? data.exchangeRate : current.exchangeRate;
  data.amount = calcAmount(newForeignAmount, newExchangeRate, currency);
  const cashflowCommentValues = await captureCashflowCommentValues();

  const result = await prisma.bankAccountReconciliationResult.update({
    where: { reconciliationId_bankAccountId: { reconciliationId, bankAccountId } },
    data,
  });
  await logCashflowCommentValueChanges(cashflowCommentValues, user.id);

  return NextResponse.json({ ok: true, amount: result.amount });
}
