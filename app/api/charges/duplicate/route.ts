import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { duplicateCharges } from "@/lib/services/charges";

const schema = z.object({
  ids: z.array(z.string()).min(1),
});

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) {
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

  try {
    const created = await duplicateCharges(parsed.data.ids, user.id);
    return NextResponse.json({ created });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Не удалось дублировать";
    return NextResponse.json({ error }, { status: 400 });
  }
}
