import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Маршруты по ролям (см. TZ Приложение B):
 *   /admin/...        — только admin
 *   /responsible/...  — только responsible
 *   /me/...           — только executor
 *   /projects/[id]    — admin или назначенный responsible (общий дашборд проекта)
 *   /login            — публичный
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user as Record<string, unknown> | undefined;
  const role = user?.role as string | undefined;
  const executorId = user?.executorId as string | null | undefined;
  const executorType = user?.executorType as string | null | undefined;
  const isPm =
    role === "responsible" ||
    (role === "executor" &&
      user?.isResponsible === true &&
      user?.responsibleActive !== false);
  const isPermanentExec = role === "executor" && executorType === "permanent";
  // Раздел /executor/* (прочие траты, исполнители) — постоянный исполнитель и PM
  const canUseExecutorSection = isPermanentExec || isPm;
  const hasProfile = !!executorId;

  if (pathname.startsWith("/api/")) {
    const method = req.method.toUpperCase();
    const source = req.nextUrl.searchParams.get("snapshot") ?? req.nextUrl.searchParams.get("source");
    const historicalContext =
      req.headers.get("x-kpd-read-only") === "1" ||
      req.nextUrl.searchParams.get("compare") === "1" ||
      (!!source && source !== "live");
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && historicalContext) {
      return NextResponse.json(
        { error: "Исторические данные и режим сравнения доступны только для чтения" },
        { status: 409 }
      );
    }
    return NextResponse.next();
  }

  // Корень / login
  if (pathname === "/login" || pathname === "/") {
    if (role) {
      const redirectPath =
        role === "admin"
          ? "/admin/cashflow"
          : isPm
          ? "/responsible/projects"
          : isPermanentExec
          ? "/executor/other-expenses"
          : "/me";
      return NextResponse.redirect(new URL(redirectPath, req.url));
    }
    return NextResponse.next();
  }

  if (!role) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (pathname === "/admin") {
    return NextResponse.redirect(new URL("/admin/cashflow", req.url));
  }

  if (pathname.startsWith("/admin") && role !== "admin") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (pathname.startsWith("/responsible") && !isPm) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // /me/* — личный профиль для любой роли с привязанным исполнителем
  if (pathname.startsWith("/me") && !hasProfile) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // /executor/* — прочие траты и исполнители для постоянного исполнителя и PM
  if (pathname.startsWith("/executor") && !canUseExecutorSection) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  // Статические файлы из public не должны проходить через auth-proxy, иначе
  // вместо изображения браузер получает редирект на страницу входа.
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
