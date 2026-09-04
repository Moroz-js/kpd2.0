import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import {
  canAccessOtherExpenses,
  canEditOtherExpense,
} from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { duplicateOtherExpenses } from "@/lib/services/other-expenses";

const schema = z.object({
  ids: z.array(z.string()).min(1),
});

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !canAccessOtherExpenses(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const sources = await prisma.otherExpense.findMany({
    where: { id: { in: parsed.data.ids } },
    select: {
      id: true,
      createdById: true,
      responsibleExecutorId: true,
      workStatus: true,
      paymentStatus: true,
    },
  });
  if (sources.length !== parsed.data.ids.length) {
    return NextResponse.json(
      { error: "Не найдены все выбранные прочие траты" },
      { status: 404 }
    );
  }
  if (sources.some((source) => !canEditOtherExpense(user, source))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const created = await duplicateOtherExpenses(parsed.data.ids, user.id);
    return NextResponse.json({ created });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Не удалось дублировать";
    return NextResponse.json({ error }, { status: 400 });
  }
}
