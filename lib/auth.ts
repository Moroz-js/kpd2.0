import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import {
  assertLoginAllowed,
  clearLoginFailures,
  loginRateLimitKeys,
  registerLoginFailure,
} from "@/lib/login-rate-limit";

// Сравнение выполняется и для отсутствующего/заблокированного аккаунта, чтобы
// ответ по времени не раскрывал существование email.
const DUMMY_PASSWORD_HASH = "$2b$10$2D4ok271vYsipx6VsG1.4eJyBmI0LqC0SI8Hq2369qyVgz.OoxA9S";

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 дней (TZ §Аутентификация)
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        if (!credentials?.email || !credentials?.password) return null;

        const email = String(credentials.email).trim().toLowerCase();
        const rateLimitKeys = loginRateLimitKeys(email, request);
        try {
          if (!await assertLoginAllowed(rateLimitKeys)) return null;
        } catch {
          // При сбое хранилища лимитов запрещаем вход, а не даём обход защиты.
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
          include: { executor: true },
        });

        const accountAvailable =
          !!user &&
          user.isActive &&
          (!user.executor || !!user.executor.accessEmail?.trim()) &&
          !user.executor?.accessRevokedAt &&
          user.executor?.status !== "archived";
        const isValid = await bcrypt.compare(
          credentials.password as string,
          user?.password ?? DUMMY_PASSWORD_HASH,
        );
        if (!accountAvailable || !isValid) {
          await registerLoginFailure(rateLimitKeys).catch(() => {});
          return null;
        }
        await clearLoginFailures(rateLimitKeys).catch(() => {});

        const exec = user.executor;
        return {
          id: user.id,
          email: user.email,
          name: user.fullName,
          role: user.role,
          isSuperAdmin: user.isSuperAdmin,
          fullName: user.fullName,
          executorId: exec?.id ?? null,
          executorType: exec?.type ?? null,
          isResponsible: !!(exec?.isResponsible || user.role === "responsible"),
          responsibleActive: exec
            ? exec.responsibleActive
            : user.role === "responsible"
              ? user.isActive
              : false,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const u = user as {
          id: string;
          role: string;
          isSuperAdmin?: boolean;
          fullName: string;
          executorId: string | null;
          executorType?: string | null;
          email?: string;
          isResponsible?: boolean;
          responsibleActive?: boolean;
        };
        token.sub = u.id;
        token.role = u.role;
        token.isSuperAdmin = u.isSuperAdmin ?? false;
        token.fullName = u.fullName;
        token.executorId = u.executorId;
        token.executorType = u.executorType ?? null;
        token.isResponsible = u.isResponsible ?? false;
        token.responsibleActive = u.responsibleActive ?? false;
        if (u.email) token.email = u.email;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        const u = session.user as unknown as Record<string, unknown>;
        u.role = token.role;
        u.isSuperAdmin = token.isSuperAdmin;
        u.fullName = token.fullName;
        u.executorId = token.executorId;
        u.executorType = token.executorType;
        u.id = token.sub;
        u.isResponsible = token.isResponsible;
        u.responsibleActive = token.responsibleActive;
      }
      return session;
    },
  },
});

export type SessionUser = {
  id: string;
  email: string;
  role: string;
  isSuperAdmin?: boolean;
  fullName: string;
  executorId: string | null;
  /** Тип привязанного исполнителя (permanent | external | service | bank). */
  executorType?: string | null;
  /** Исполнитель с флагом «ответственный» (роль PM). */
  isResponsible?: boolean;
  /** Активен ли статус ответственного (≠ архив исполнителя). */
  responsibleActive?: boolean;
};

/**
 * Текущий пользователь из сессии, сверенный с БД.
 * После db:reset id в JWT может не совпадать с новыми записями — ищем по email.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user) return null;

  const u = session.user as Record<string, unknown>;
  const email = typeof u.email === "string" ? u.email : null;
  const sessionId = typeof u.id === "string" ? u.id : null;
  if (!email && !sessionId) return null;

  const dbUser = await prisma.user.findFirst({
    where: email ? { email } : { id: sessionId! },
    select: {
      id: true,
      email: true,
      role: true,
      isSuperAdmin: true,
      fullName: true,
      isActive: true,
      executor: {
        select: {
          id: true,
          type: true,
          accessEmail: true,
          accessRevokedAt: true,
          status: true,
          isResponsible: true,
          responsibleActive: true,
        },
      },
    },
  });

  if (!dbUser?.isActive) return null;
  if (dbUser.executor && !dbUser.executor.accessEmail?.trim()) return null;
  if (dbUser.executor?.accessRevokedAt) return null;
  if (dbUser.executor?.status === "archived") return null;

  const exec = dbUser.executor;
  const isResponsibleFlag =
    exec?.isResponsible ?? dbUser.role === "responsible";
  const responsibleActive =
    exec != null
      ? exec.responsibleActive
      : dbUser.role === "responsible"
        ? dbUser.isActive
        : false;

  return {
    id: dbUser.id,
    email: dbUser.email,
    role: dbUser.role,
    isSuperAdmin: dbUser.isSuperAdmin,
    fullName: dbUser.fullName,
    executorId: exec?.id ?? null,
    executorType: exec?.type ?? null,
    isResponsible: isResponsibleFlag,
    responsibleActive,
  };
}
