import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canAccessOtherExpenses } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { createOtherExpense, listOtherExpenses } from "@/lib/services/other-expenses";
import { prismaErrorMessage } from "@/lib/prisma-errors";
import { zNullableDateString } from "@/lib/date-string";
import { z } from "zod";

const createSchema = z.object({
  projectId: z.string().min(1),
  executorId: z.string().min(1),
  workTypeId: z.string().min(1),
  responsibleExecutorId: z.string().min(1),
  bankAccountId: z.string().nullable().optional(),
  executionYear: z.number().int().min(2020).max(2100),
  executionMonth: z.number().int().min(1).max(12),
  description: z.string().min(1),
  amount: z.number().positive(),
  paymentAmount: z.number().positive().nullable().optional(),
  preferredPayMethod: z.string().nullable().optional(),
  plannedPayAt: zNullableDateString,
  paidAt: zNullableDateString,
  comment: z.string().nullable().optional(),
});

export async function GET() {
  const user = await getSessionUser();
  if (!user || !canAccessOtherExpenses(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Все, у кого есть доступ к «Прочим тратам», видят все записи.
  const data = await listOtherExpenses();
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !canAccessOtherExpenses(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!user.id) return NextResponse.json({ error: "Сессия недействительна" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Проверьте обязательные поля", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  // Ответственный = активный постоянный исполнитель (KPD-285).
  const responsibleExists = await prisma.executor.findFirst({
    where: { id: parsed.data.responsibleExecutorId, type: "permanent", status: "active" },
    select: { id: true },
  });
  if (!responsibleExists) {
    return NextResponse.json({ error: "Выбранный ответственный не найден среди активных постоянных исполнителей" }, { status: 422 });
  }

  try {
    const expense = await createOtherExpense(parsed.data, user.id);
    return NextResponse.json(expense, { status: 201 });
  } catch (e) {
    console.error("[other-expenses] POST failed:", e);
    const message = e instanceof Error ? e.message : "";
    const status = message.startsWith("Сумма работы и сумма выплаты") ? 422 : 500;
    return NextResponse.json(
      { error: prismaErrorMessage(e, "Не удалось создать запись") },
      { status },
    );
  }
}
