import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { updateProject } from "@/lib/services/projects";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const p = await prisma.project.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true, company: true } },
      responsible: { select: { id: true, fullName: true } },
      _count: { select: { works: true, otherExpenses: true, orders: true } },
    },
  });
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const chargeCount = await prisma.charge.count({ where: { order: { projectId: p.id } } });

  return NextResponse.json({
    ...p,
    counts: {
      works: p._count.works,
      otherExpenses: p._count.otherExpenses,
      orders: p._count.orders,
      charges: chargeCount,
    },
  });
}

const patchSchema = z.object({
  shortName: z.string().min(1).optional(),
  clientId: z.string().nullable().optional(),
  responsibleUserId: z.string().nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
  cashflowInitial: z.number().int().optional(),
}).strict();

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  try {
    const updated = await updateProject(id, parsed.data, me.id);
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "У этого клиента уже есть проект с таким названием" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
