import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { bulkUpdateBankOperations } from "@/lib/services/bankOperations";
import { BANK_OPERATION_STATUSES } from "@/lib/statuses";

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1),
  patch: z.object({
    status: z.enum(Object.keys(BANK_OPERATION_STATUSES) as [string, ...string[]]).optional(),
    projectId: z.string().nullable().optional(),
    workTypeId: z.string().nullable().optional(),
    isInternalTransfer: z.boolean().optional(),
  }),
});

export async function PATCH(req: Request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await bulkUpdateBankOperations(parsed.data.ids, parsed.data.patch, me.id);
  return NextResponse.json(result);
}
