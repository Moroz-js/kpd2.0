import { prisma } from "@/lib/db";
import {
  formatChangeValue,
  formatFieldLabel,
  type DisplayChange,
} from "@/lib/audit/display-changes";

type ChangeObj = Record<string, { from: unknown; to: unknown }>;

const FK_RESOLVERS = {
  bankAccountId: "bankAccount",
  defaultBankAccountId: "bankAccount",
  projectId: "project",
  clientId: "client",
  executorId: "executor",
  responsibleExecutorId: "executor",
  workTypeId: "workType",
  responsibleUserId: "user",
  createdById: "user",
  userId: "user",
  orderId: "order",
} as const;

type ResolverKey = (typeof FK_RESOLVERS)[keyof typeof FK_RESOLVERS];

async function buildLabelMaps(
  changesList: ChangeObj[]
): Promise<Partial<Record<ResolverKey, Record<string, string>>>> {
  const idsByType: Partial<Record<ResolverKey, Set<string>>> = {};

  for (const changes of changesList) {
    for (const [field, val] of Object.entries(changes)) {
      const resolver = FK_RESOLVERS[field as keyof typeof FK_RESOLVERS];
      if (!resolver) continue;
      for (const v of [val.from, val.to]) {
        if (typeof v === "string" && v) {
          (idsByType[resolver] ??= new Set()).add(v);
        }
      }
    }
  }

  const maps: Partial<Record<ResolverKey, Record<string, string>>> = {};

  const bankIds = [...(idsByType.bankAccount ?? [])];
  if (bankIds.length > 0) {
    const rows = await prisma.bankAccount.findMany({
      where: { id: { in: bankIds } },
      select: { id: true, name: true },
    });
    maps.bankAccount = Object.fromEntries(rows.map((r) => [r.id, r.name]));
  }

  const projectIds = [...(idsByType.project ?? [])];
  if (projectIds.length > 0) {
    const rows = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true, shortName: true },
    });
    maps.project = Object.fromEntries(
      rows.map((r) => [r.id, r.shortName || r.name])
    );
  }

  const clientIds = [...(idsByType.client ?? [])];
  if (clientIds.length > 0) {
    const rows = await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true },
    });
    maps.client = Object.fromEntries(rows.map((r) => [r.id, r.name]));
  }

  const executorIds = [...(idsByType.executor ?? [])];
  if (executorIds.length > 0) {
    const rows = await prisma.executor.findMany({
      where: { id: { in: executorIds } },
      select: { id: true, name: true },
    });
    maps.executor = Object.fromEntries(rows.map((r) => [r.id, r.name]));
  }

  const workTypeIds = [...(idsByType.workType ?? [])];
  if (workTypeIds.length > 0) {
    const rows = await prisma.workType.findMany({
      where: { id: { in: workTypeIds } },
      select: { id: true, name: true },
    });
    maps.workType = Object.fromEntries(rows.map((r) => [r.id, r.name]));
  }

  const userIds = [...(idsByType.user ?? [])];
  if (userIds.length > 0) {
    const rows = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    maps.user = Object.fromEntries(rows.map((r) => [r.id, r.fullName]));
  }

  const orderIds = [...(idsByType.order ?? [])];
  if (orderIds.length > 0) {
    const rows = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNumber: true },
    });
    maps.order = Object.fromEntries(
      rows.map((r) => [r.id, `№${r.orderNumber}`])
    );
  }

  return maps;
}

function resolveValue(
  value: unknown,
  field: string,
  maps: Partial<Record<ResolverKey, Record<string, string>>>
): string {
  const resolver = FK_RESOLVERS[field as keyof typeof FK_RESOLVERS];
  if (resolver && typeof value === "string" && value) {
    const label = maps[resolver]?.[value];
    if (label) return label;
  }
  return formatChangeValue(value, field);
}

function changesToDisplay(
  obj: ChangeObj,
  maps: Partial<Record<ResolverKey, Record<string, string>>>
): DisplayChange[] {
  return Object.entries(obj).map(([field, val]) => ({
    field,
    fieldLabel: formatFieldLabel(field),
    from: resolveValue(val?.from, field, maps),
    to: resolveValue(val?.to, field, maps),
  }));
}

export async function resolveDisplayChangesForItems(
  items: { changes: string | null }[]
): Promise<DisplayChange[][]> {
  const parsed = items.map((item) => {
    if (!item.changes) return null;
    try {
      return JSON.parse(item.changes) as ChangeObj;
    } catch {
      return null;
    }
  });

  const maps = await buildLabelMaps(
    parsed.filter((obj): obj is ChangeObj => obj !== null)
  );

  return parsed.map((obj) => (obj ? changesToDisplay(obj, maps) : []));
}
