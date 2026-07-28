import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type NumberScope = "payout" | "issued-work" | "other-expense";

const PREFIX: Record<NumberScope, string> = {
  payout: "В",
  "issued-work": "ВР",
  "other-expense": "ПТ",
};

export type AllocatedEntityNumber = {
  number: string;
  year: number;
  serial: number;
};

export function formatEntityNumber(scope: NumberScope, year: number, serial: number): string {
  const shortYear = String(Math.abs(year) % 100).padStart(2, "0");
  return `${PREFIX[scope]}${shortYear}.${String(serial).padStart(3, "0")}`;
}

/**
 * Выделяет следующий номер атомарным increment/upsert внутри транзакции.
 * Важно: сущность с этим номером должна быть создана в той же транзакции.
 */
export async function allocateEntityNumber(
  tx: Prisma.TransactionClient,
  scope: NumberScope,
  year: number
): Promise<AllocatedEntityNumber> {
  if (!Number.isInteger(year)) throw new Error("Год номера должен быть целым числом");

  const counter = await tx.numberCounter.upsert({
    where: { scope_year: { scope, year } },
    create: { scope, year, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });

  return {
    number: formatEntityNumber(scope, year, counter.lastValue),
    year,
    serial: counter.lastValue,
  };
}

function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_BUSY|database is locked|serialization failure|deadlock detected/i.test(message);
}

/** Serializable-транзакция с ограниченным retry для PostgreSQL и SQLite. */
export async function withNumberedTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 4
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error) || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}
