export type DiffStatus = "added" | "removed" | "modified" | "unchanged";

export type FieldDiff = {
  field: string;
  before: unknown;
  after: unknown;
};

export type EntityDiff<T> = {
  key: string;
  status: DiffStatus;
  before: T | null;
  after: T | null;
  changes: FieldDiff[];
};

const IGNORED_FIELDS = new Set(["updatedAt"]);

function canonical(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .map(canonical)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !IGNORED_FIELDS.has(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonical(nested)])
    );
  }
  return value;
}

function equal(a: unknown, b: unknown) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function diffEntities<T extends Record<string, unknown>>(
  before: T[],
  after: T[],
  keyOf: (entity: T) => string
): EntityDiff<T>[] {
  const left = new Map(before.map((entity) => [keyOf(entity), entity]));
  const right = new Map(after.map((entity) => [keyOf(entity), entity]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a.localeCompare(b));

  return keys.map((key) => {
    const a = left.get(key) ?? null;
    const b = right.get(key) ?? null;
    if (!a) return { key, status: "added", before: null, after: b, changes: [] };
    if (!b) return { key, status: "removed", before: a, after: null, changes: [] };

    const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((field) => !IGNORED_FIELDS.has(field))
      .sort();
    const changes = fields
      .filter((field) => !equal(a[field], b[field]))
      .map((field) => ({ field, before: a[field] ?? null, after: b[field] ?? null }));

    return {
      key,
      status: changes.length ? "modified" : "unchanged",
      before: a,
      after: b,
      changes,
    };
  });
}

export function unionEntityKey(entity: Record<string, unknown>): string {
  const sourceType = typeof entity.sourceType === "string" ? entity.sourceType : null;
  const sourceId = typeof entity.sourceId === "string" ? entity.sourceId : null;
  if (sourceType && sourceId) return `${sourceType}:${sourceId}`;
  if (typeof entity.id === "string") return entity.id;
  const compositeCandidates = [
    ["projectId", "executorId"],
    ["projectId", "workTypeId"],
    ["executorId", "workTypeId"],
    ["reconciliationId", "bankAccountId"],
    ["verificationId", "projectId"],
    ["year", "week", "rowKey"],
    ["scope", "year"],
  ];
  for (const fields of compositeCandidates) {
    if (fields.every((field) => entity[field] != null)) {
      return fields.map((field) => String(entity[field])).join(":");
    }
  }
  if (entity.year != null) return String(entity.year);
  if (entity.code != null) return String(entity.code);
  throw new Error("У snapshot-сущности нет стабильного ключа");
}
