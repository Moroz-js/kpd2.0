import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { updateIssuedWork, canReviewIssuedSource } from "@/lib/services/issuedWorks";
import { WORK_STATUSES_SETTABLE } from "@/lib/statuses";
import { parseLocalDateInput, zNullableDateString } from "@/lib/date-string";

const patchSchema = z.object({
  projectId: z.string().optional(),
  workTypeId: z.string().optional(),
  plannedPayAt: zNullableDateString,
  executionMonth: z.number().int().min(1).max(12).optional(),
  executionYear: z.number().int().optional(),
  executorId: z.string().optional(),
  workStatus: z.enum(WORK_STATUSES_SETTABLE).optional(),
  responsibleExecutorId: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
});

/** Composite id format: `${sourceType}:${sourceId}` (e.g. "personal:cl123" or "other-expense:cl456"). */
function parseId(id: string): { sourceType: "personal" | "other-expense"; sourceId: string } | null {
  const idx = id.indexOf(":");
  if (idx < 0) return null;
  const sourceType = id.slice(0, idx);
  const sourceId = id.slice(idx + 1);
  if (sourceType !== "personal" && sourceType !== "other-expense") return null;
  if (!sourceId) return null;
  return { sourceType, sourceId };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const parsedId = parseId(id);
  if (!parsedId) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const patch = parsed.data;

  // Доступ: admin — всё; РП проекта или текущий «Ответственный» строки — только
  // рецензирование (статус/ответственный/комментарий) (KPD-287/288).
  if (!isAdmin(me)) {
    const canReview = await canReviewIssuedSource(me, parsedId.sourceType, parsedId.sourceId);
    if (!canReview) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const allowedForReviewer = new Set(["workStatus", "responsibleExecutorId", "comment"]);
    const hasForbidden = Object.keys(patch).some((k) => !allowedForReviewer.has(k));
    if (hasForbidden) {
      return NextResponse.json(
        { error: "Можно менять только статус, ответственного и комментарий" },
        { status: 403 }
      );
    }
  }

  // Защита от запрещённых полей: для personal allow только {projectId, workTypeId, plannedPayAt, workStatus}.
  // Для other-expense allow {projectId, workTypeId, executionMonth, executionYear, executorId, workStatus}.
  if (parsedId.sourceType === "personal") {
    if (
      patch.executionMonth !== undefined ||
      patch.executionYear !== undefined ||
      patch.executorId !== undefined
    ) {
      return NextResponse.json(
        { error: "Эти поля Личной сметы редактируются только в источнике" },
        { status: 400 }
      );
    }
  }

  try {
    const { plannedPayAt, ...rest } = patch;
    const issuedPatch = {
      ...rest,
      ...(plannedPayAt !== undefined && {
        plannedPayAt: plannedPayAt ? parseLocalDateInput(plannedPayAt) : null,
      }),
    };
    const updated = await updateIssuedWork(
      parsedId.sourceType,
      parsedId.sourceId,
      issuedPatch,
      me.id
    );
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
