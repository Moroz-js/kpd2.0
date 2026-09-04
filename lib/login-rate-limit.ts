import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

type RateLimitKey = {
  key: string;
  maxAttempts: number;
};

type RateLimitRecord = {
  key: string;
  attempts: number;
  windowStartedAt: Date;
  lockedUntil: Date | null;
};

type RateLimitStore = {
  findMany: (args: { where: { key: { in: string[] } } }) => Promise<RateLimitRecord[]>;
  findUnique: (args: { where: { key: string } }) => Promise<RateLimitRecord | null>;
  create: (args: {
    data: Pick<RateLimitRecord, "key" | "attempts" | "windowStartedAt">;
  }) => Promise<RateLimitRecord>;
  update: (args: {
    where: { key: string };
    data: Partial<Pick<RateLimitRecord, "attempts" | "windowStartedAt" | "lockedUntil">>;
  }) => Promise<RateLimitRecord>;
  deleteMany: (args: { where: { key: { in: string[] } } }) => Promise<unknown>;
};

type RateLimitDb = {
  loginRateLimit: RateLimitStore;
  $transaction: <T>(
    callback: (tx: Pick<RateLimitDb, "loginRateLimit">) => Promise<T>,
  ) => Promise<T>;
};

// prisma generate выполняется при установке и деплое. Явный минимальный
// интерфейс даёт возможность проверять остальной код даже при локальном
// блокировании Windows нативного Prisma engine.
const rateLimitDb = prisma as unknown as RateLimitDb;

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || request.headers.get("x-real-ip") || "unknown").slice(0, 128);
}

/**
 * Ограничиваем и конкретную учётную запись, и IP. В БД сохраняются только
 * SHA-256 ключи — email и IP не дублируются в новой таблице.
 */
export function loginRateLimitKeys(email: string, request: Request): RateLimitKey[] {
  return [
    { key: hashKey(`account:${email}`), maxAttempts: 5 },
    { key: hashKey(`ip:${clientIp(request)}`), maxAttempts: 20 },
  ];
}

export function isLoginRateLimited(
  record: Pick<RateLimitRecord, "attempts" | "windowStartedAt" | "lockedUntil"> | undefined,
  maxAttempts: number,
  now = new Date(),
): boolean {
  if (!record) return false;
  if (record.lockedUntil && record.lockedUntil > now) return true;
  return record.windowStartedAt.getTime() > now.getTime() - WINDOW_MS
    && record.attempts >= maxAttempts;
}

export async function assertLoginAllowed(keys: RateLimitKey[]): Promise<boolean> {
  const records = await rateLimitDb.loginRateLimit.findMany({
    where: { key: { in: keys.map(({ key }) => key) } },
  });
  const byKey = new Map(records.map((record) => [record.key, record]));
  return !keys.some(({ key, maxAttempts }) =>
    isLoginRateLimited(byKey.get(key), maxAttempts),
  );
}

export async function registerLoginFailure(keys: RateLimitKey[]): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  await rateLimitDb.$transaction(async (tx) => {
    for (const { key, maxAttempts } of keys) {
      const existing = await tx.loginRateLimit.findUnique({ where: { key } });
      if (!existing) {
        await tx.loginRateLimit.create({
          data: { key, attempts: 1, windowStartedAt: now },
        });
        continue;
      }

      if (existing.windowStartedAt <= windowStart) {
        await tx.loginRateLimit.update({
          where: { key },
          data: { attempts: 1, windowStartedAt: now, lockedUntil: null },
        });
        continue;
      }

      const attempts = existing.attempts + 1;
      await tx.loginRateLimit.update({
        where: { key },
        data: {
          attempts,
          lockedUntil: attempts >= maxAttempts
            ? new Date(now.getTime() + LOCKOUT_MS)
            : existing.lockedUntil,
        },
      });
    }
  });
}

export async function clearLoginFailures(keys: RateLimitKey[]): Promise<void> {
  await rateLimitDb.loginRateLimit.deleteMany({
    where: { key: { in: keys.map(({ key }) => key) } },
  });
}
