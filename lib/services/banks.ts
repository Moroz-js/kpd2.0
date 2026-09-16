import { prisma } from "@/lib/db";
import { logActivity, diff } from "@/lib/audit/log";
import { DEFAULT_BANKS, isBankCountry, type BankCountry } from "@/lib/banks";
import { sortByRu } from "@/lib/sort";

export type BankListRow = {
  id: string;
  name: string;
  country: string;
  status: string;
};

export async function ensureDefaultBanks() {
  const existing = await prisma.bank.findMany({ select: { name: true } });
  const have = new Set(existing.map((r) => r.name.toLowerCase()));
  const missing = DEFAULT_BANKS.filter((b) => !have.has(b.name.toLowerCase()));
  if (missing.length === 0) return;
  await prisma.bank.createMany({ data: missing.map((b) => ({ name: b.name, country: b.country })) });
}

export async function listBanks(): Promise<BankListRow[]> {
  await ensureDefaultBanks();
  const rows = await prisma.bank.findMany();
  return sortByRu(rows, (r) => r.name).map((r) => ({
    id: r.id,
    name: r.name,
    country: r.country,
    status: r.status,
  }));
}

async function findByNameCi(name: string, exceptId?: string) {
  const rows = await prisma.bank.findMany({ select: { id: true, name: true } });
  const needle = name.toLowerCase();
  return rows.find((r) => r.name.toLowerCase() === needle && r.id !== exceptId) ?? null;
}

export async function createBank(input: { name: string; country: BankCountry }, userId: string) {
  const name = input.name.trim();
  if (!name) throw new Error("Введите название банка");
  if (!isBankCountry(input.country)) throw new Error("Некорректная страна");
  if (await findByNameCi(name)) throw new Error("Такой банк уже есть");

  const created = await prisma.bank.create({
    data: { name, country: input.country, status: "active" },
  });
  await logActivity({
    userId,
    action: "create",
    entityType: "Bank",
    entityId: created.id,
    entityLabel: created.name,
  });
  return created;
}

export async function updateBank(
  id: string,
  patch: { name?: string; country?: BankCountry },
  userId: string
) {
  const before = await prisma.bank.findUnique({ where: { id } });
  if (!before) throw new Error("Банк не найден");

  const name = patch.name !== undefined ? patch.name.trim() : undefined;
  if (name !== undefined) {
    if (!name) throw new Error("Введите название банка");
    if (await findByNameCi(name, id)) throw new Error("Такой банк уже есть");
  }
  if (patch.country !== undefined && !isBankCountry(patch.country)) {
    throw new Error("Некорректная страна");
  }

  const updated = await prisma.bank.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(patch.country !== undefined && { country: patch.country }),
    },
  });
  const changes = diff(
    before as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>
  );
  if (Object.keys(changes).length > 0) {
    await logActivity({
      userId,
      action: "update",
      entityType: "Bank",
      entityId: id,
      entityLabel: updated.name,
      changes,
    });
  }
  return updated;
}

export async function archiveBank(id: string, userId: string) {
  const row = await prisma.bank.findUnique({ where: { id } });
  if (!row) throw new Error("Банк не найден");
  const updated = await prisma.bank.update({
    where: { id },
    data: { status: "archived" },
  });
  await logActivity({
    userId,
    action: "archive",
    entityType: "Bank",
    entityId: id,
    entityLabel: updated.name,
  });
  return updated;
}

export async function unarchiveBank(id: string, userId: string) {
  const row = await prisma.bank.findUnique({ where: { id } });
  if (!row) throw new Error("Банк не найден");
  const updated = await prisma.bank.update({
    where: { id },
    data: { status: "active" },
  });
  await logActivity({
    userId,
    action: "unarchive",
    entityType: "Bank",
    entityId: id,
    entityLabel: updated.name,
  });
  return updated;
}
