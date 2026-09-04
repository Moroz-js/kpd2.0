/**
 * POST /api/users/:id/reset-password
 *
 * Admin сбрасывает пароль другому пользователю (см. TDNB-31 §Аутентификация).
 * Body: { password: string }
 *
 * Ответ: 200 OK или 401/403/400.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canResetUserPassword } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/audit/log";
import bcrypt from "bcryptjs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!canResetUserPassword(me, id, target.isSuperAdmin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  if (!body?.password || body.password.length < 6) {
    return NextResponse.json({ error: "Password too short (min 6)" }, { status: 400 });
  }

  const hash = await bcrypt.hash(body.password, 10);
  await prisma.user.update({ where: { id }, data: { password: hash } });

  await logActivity({
    userId: me.id,
    action: "password_reset",
    entityType: "User",
    entityId: id,
    entityLabel: target.fullName,
  });

  return NextResponse.json({ ok: true });
}
