import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import {
  canViewExecutorEstimate,
  canViewExecutorsList,
  canEditExecutorSettings,
  isAdmin,
  isResponsible,
} from "@/lib/permissions";
import { updateExecutor } from "@/lib/services/executors";
import { prisma } from "@/lib/db";
import {
  dataSourcePrismaAdapter,
  resolveDataSource,
  SnapshotSourceError,
} from "@/lib/snapshots/data-source";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  // Карточку исполнителя (настройки) видят admin, PM, постоянный исполнитель,
  // а также владелец своего профиля. Данные сметы отдаются отдельными эндпоинтами
  // под canViewExecutorEstimate.
  const allowed = canViewExecutorsList(me) || (await canViewExecutorEstimate(me, id));
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  let source;
  try {
    source = await resolveDataSource(url.searchParams.get("source") ?? url.searchParams.get("snapshot"));
  } catch (error) {
    if (error instanceof SnapshotSourceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
  const db = dataSourcePrismaAdapter(source);

  const executor = await db.executor.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, fullName: true, role: true, isActive: true } },
      responsibleUser: { select: { id: true, fullName: true } },
      defaultBankAccount: { select: { id: true, name: true } },
      executorWorkTypes: { include: { workType: { select: { id: true, name: true, segment: true } } } },
      projectExecutors: {
        include: { project: { select: { id: true, name: true, status: true } } },
      },
    },
  });

  if (!executor) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Snapshot adapter не умеет nested orderBy — сортируем в JS
  if (Array.isArray(executor.projectExecutors)) {
    executor.projectExecutors.sort((a: { project?: { name?: string } | null }, b: { project?: { name?: string } | null }) =>
      (a.project?.name ?? "").localeCompare(b.project?.name ?? "", "ru")
    );
  }

  return NextResponse.json(executor);
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  companyStatus: z.string().nullable().optional(),
  specialty: z.string().nullable().optional(),
  contacts: z.string().nullable().optional(),
  contactEmail: z.string().email("Некорректный контактный email").nullable().optional(),
  requisites: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  inTgChat: z.boolean().optional(),
  contractFile: z.string().nullable().optional(),
  ndaFile: z.string().nullable().optional(),
  recipientTypes: z.array(z.string()).optional(),
  recipientType: z.string().nullable().optional(),
  responsibleUserId: z.string().nullable().optional(),
  defaultBankAccountId: z.string().nullable().optional(),
  oldEstimateUrl: z.string().nullable().optional(),
  type: z.enum(["permanent", "external", "service", "bank"]).optional(),
  status: z.enum(["active", "archived"]).optional(),
  password: z.string().min(6).optional(),
  specialties: z.string().nullable().optional(),
  isResponsible: z.boolean().optional(),
  workTypeIds: z.array(z.string()).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  // Редактировать настройки может: admin, PM, любой executor (только свой профиль)
  if (!canEditExecutorSettings(me)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Не-admin и не-PM может редактировать только себя
  if (!isAdmin(me) && !isResponsible(me) && me.executorId !== id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  // Не-admin (PM, постоянный исполнитель) не управляет учётной записью, типом и
  // ролью ответственного — это admin-only поля.
  let data = parsed.data;
  if (!isAdmin(me)) {
    const { password: _p, type: _t, isResponsible: _r, status: _s, ...rest } = data;
    void _p; void _t; void _r; void _s;
    data = rest;
  }
  try {
    const updated = await updateExecutor(id, data, me.id);
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const status = msg.startsWith("Нельзя") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
