import "server-only";

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { prisma } from "@/lib/db";
import {
  MODEL_DELEGATES,
  type SnapshotModel,
  type SnapshotRecord,
  sanitizeSnapshotRow,
  snapshotModelKey,
} from "@/lib/snapshots/schema";
import { readSnapshotObject } from "@/lib/snapshots/storage";

export type QueryArgs = {
  where?: Record<string, unknown>;
  orderBy?: Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
};

export type SnapshotMetadata = {
  id: string;
  businessDate: Date;
  cutoffAt: Date;
  schemaVersion: number;
  formulaVersion: string;
  contentHash: string | null;
};

export interface DataSource {
  readonly kind: "live" | "snapshot";
  readonly metadata: SnapshotMetadata | null;
  query<T extends SnapshotRecord = SnapshotRecord>(model: SnapshotModel, args?: QueryArgs): Promise<T[]>;
  load(models: SnapshotModel[]): Promise<Record<string, SnapshotRecord[]>>;
}

export class LiveDataSource implements DataSource {
  readonly kind = "live" as const;
  readonly metadata = null;

  async query<T extends SnapshotRecord = SnapshotRecord>(model: SnapshotModel, args: QueryArgs = {}): Promise<T[]> {
    const delegate = (prisma as unknown as Record<string, { findMany: (args: QueryArgs) => Promise<T[]> }>)[
      MODEL_DELEGATES[model]
    ];
    if (!delegate) throw new Error(`Неизвестная модель snapshot: ${model}`);
    const rows = await delegate.findMany(args);
    return rows.map((row) => sanitizeSnapshotRow(model, row)) as T[];
  }

  async load(models: SnapshotModel[]) {
    const entries = await Promise.all(models.map(async (model) => [model, await this.query(model)] as const));
    return Object.fromEntries(entries);
  }
}

type Relation = {
  model: SnapshotModel;
  local: string;
  foreign: string;
  many?: boolean;
};

const RELATIONS: Partial<Record<SnapshotModel, Record<string, Relation>>> = {
  Client: { projects: { model: "Project", local: "id", foreign: "clientId", many: true } },
  Project: {
    client: { model: "Client", local: "clientId", foreign: "id" },
    responsible: { model: "User", local: "responsibleUserId", foreign: "id" },
    orders: { model: "Order", local: "id", foreign: "projectId", many: true },
  },
  Executor: {
    user: { model: "User", local: "userId", foreign: "id" },
    responsibleUser: { model: "User", local: "responsibleUserId", foreign: "id" },
    defaultBankAccount: { model: "BankAccount", local: "defaultBankAccountId", foreign: "id" },
    executorWorkTypes: { model: "ExecutorWorkType", local: "id", foreign: "executorId", many: true },
    projectExecutors: { model: "ProjectExecutor", local: "id", foreign: "executorId", many: true },
  },
  ExecutorWorkType: {
    workType: { model: "WorkType", local: "workTypeId", foreign: "id" },
  },
  ProjectExecutor: {
    project: { model: "Project", local: "projectId", foreign: "id" },
    executor: { model: "Executor", local: "executorId", foreign: "id" },
  },
  Order: {
    project: { model: "Project", local: "projectId", foreign: "id" },
    charges: { model: "Charge", local: "id", foreign: "orderId", many: true },
  },
  Charge: {
    bankAccount: { model: "BankAccount", local: "bankAccountId", foreign: "id" },
    order: { model: "Order", local: "orderId", foreign: "id" },
  },
  Work: {
    executor: { model: "Executor", local: "executorId", foreign: "id" },
    project: { model: "Project", local: "projectId", foreign: "id" },
    workType: { model: "WorkType", local: "workTypeId", foreign: "id" },
    responsibleExecutor: { model: "Executor", local: "responsibleExecutorId", foreign: "id" },
    payment: { model: "Payment", local: "paymentId", foreign: "id" },
  },
  OtherExpense: {
    executor: { model: "Executor", local: "executorId", foreign: "id" },
    project: { model: "Project", local: "projectId", foreign: "id" },
    workType: { model: "WorkType", local: "workTypeId", foreign: "id" },
    responsibleExecutor: { model: "Executor", local: "responsibleExecutorId", foreign: "id" },
    bankAccount: { model: "BankAccount", local: "bankAccountId", foreign: "id" },
  },
  Payment: {
    executor: { model: "Executor", local: "executorId", foreign: "id" },
    bankAccount: { model: "BankAccount", local: "bankAccountId", foreign: "id" },
    works: { model: "Work", local: "id", foreign: "paymentId", many: true },
  },
  SpendingPlanLine: {
    project: { model: "Project", local: "projectId", foreign: "id" },
    executor: { model: "Executor", local: "executorId", foreign: "id" },
    workType: { model: "WorkType", local: "workTypeId", foreign: "id" },
  },
  BankAccountReconciliation: {
    results: { model: "BankAccountReconciliationResult", local: "id", foreign: "reconciliationId", many: true },
  },
  BankAccountReconciliationResult: {
    bankAccount: { model: "BankAccount", local: "bankAccountId", foreign: "id" },
  },
  ProjectVerification: {
    results: { model: "ProjectVerificationResult", local: "id", foreign: "verificationId", many: true },
  },
  ProjectVerificationResult: {
    project: { model: "Project", local: "projectId", foreign: "id" },
  },
  Task: {
    executor: { model: "Executor", local: "executorId", foreign: "id" },
  },
  VacationEntry: {
    executor: { model: "Executor", local: "executorId", foreign: "id" },
    approvedBy: { model: "User", local: "approvedById", foreign: "id" },
  },
};

function matchesWhere(row: SnapshotRecord, where?: Record<string, unknown>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const op = expected as Record<string, unknown>;
      if ("in" in op) return Array.isArray(op.in) && op.in.includes(actual);
      if ("not" in op) return actual !== op.not;
      if ("equals" in op) return actual === op.equals;
    }
    return actual === expected;
  });
}

function sortRows(rows: SnapshotRecord[], orderBy?: QueryArgs["orderBy"]) {
  const clauses = !orderBy ? [] : Array.isArray(orderBy) ? orderBy : [orderBy];
  if (!clauses.length) return rows;
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      const [key, direction] = Object.entries(clause)[0] ?? [];
      if (!key) continue;
      const av = a[key] as string | number | null | undefined;
      const bv = b[key] as string | number | null | undefined;
      if (av === bv) continue;
      if (av == null) return direction === "asc" ? 1 : -1;
      if (bv == null) return direction === "asc" ? -1 : 1;
      const result = av < bv ? -1 : 1;
      return direction === "asc" ? result : -result;
    }
    return 0;
  });
}

export class SnapshotDataSource implements DataSource {
  readonly kind = "snapshot" as const;
  readonly metadata: SnapshotMetadata;
  private readonly prefix: string;
  private readonly cache = new Map<SnapshotModel, SnapshotRecord[]>();
  private manifestPromise?: Promise<{
    files: Array<{ model: SnapshotModel; rows: number; sha256: string }>;
  }>;

  constructor(run: {
    id: string;
    businessDate: Date;
    cutoffAt: Date;
    schemaVersion: number;
    formulaVersion: string;
    contentHash: string | null;
    objectPrefix: string;
  }) {
    this.prefix = run.objectPrefix.replace(/\/+$/, "");
    this.metadata = {
      id: run.id,
      businessDate: run.businessDate,
      cutoffAt: run.cutoffAt,
      schemaVersion: run.schemaVersion,
      formulaVersion: run.formulaVersion,
      contentHash: run.contentHash,
    };
  }

  private manifest() {
    this.manifestPromise ??= readSnapshotObject(`${this.prefix}/manifest.json`)
      .then((body) => JSON.parse(body.toString("utf8")))
      .catch((error) => {
        throw new SnapshotSourceError(
          `Снимок ${this.metadata.id} повреждён или недоступен: не удалось прочитать manifest (${
            error instanceof Error ? error.message : String(error)
          })`
        );
      });
    return this.manifestPromise;
  }

  private async rows(model: SnapshotModel): Promise<SnapshotRecord[]> {
    const cached = this.cache.get(model);
    if (cached) return cached;
    const [compressed, manifest] = await Promise.all([
      readSnapshotObject(`${this.prefix}/${snapshotModelKey(model)}`).catch((error) => {
        throw new SnapshotSourceError(
          `Снимок ${this.metadata.id} повреждён или недоступен: не удалось прочитать модель ${model} (${
            error instanceof Error ? error.message : String(error)
          })`
        );
      }),
      this.manifest(),
    ]);
    const text = gunzipSync(compressed).toString("utf8").trim();
    const rows = text
      ? text.split("\n").map(
          (line) =>
            JSON.parse(line, (key, value) => {
              if (
                typeof value === "string" &&
                /(At|Date|date)$/.test(key) &&
                /^\d{4}-\d{2}-\d{2}T/.test(value)
              ) {
                const parsed = new Date(value);
                if (!Number.isNaN(parsed.getTime())) return parsed;
              }
              return value;
            }) as SnapshotRecord
        )
      : [];
    const expected = manifest.files.find((file) => file.model === model);
    const hash = createHash("sha256").update(text ? `${text}\n` : "").digest("hex");
    if (!expected || expected.rows !== rows.length || expected.sha256 !== hash) {
      throw new SnapshotSourceError(`Snapshot повреждён: контрольная сумма модели ${model} не совпала`);
    }
    this.cache.set(model, rows);
    return rows;
  }

  private async project(
    model: SnapshotModel,
    row: SnapshotRecord,
    shape?: Record<string, unknown>
  ): Promise<SnapshotRecord> {
    if (!shape) return { ...row };
    const out: SnapshotRecord = {};
    for (const [key, spec] of Object.entries(shape)) {
      if (spec === false) continue;
      const relation = RELATIONS[model]?.[key];
      if (!relation) {
        if (spec === true) out[key] = row[key];
        continue;
      }
      const relatedRows = (await this.rows(relation.model)).filter(
        (candidate) => candidate[relation.foreign] === row[relation.local]
      );
      const nested = typeof spec === "object" && spec ? (spec as QueryArgs) : {};
      const nestedShape = nested.select ?? nested.include;
      const resolved = await Promise.all(
        relatedRows.map((candidate) => this.project(relation.model, candidate, nestedShape))
      );
      out[key] = relation.many ? resolved : resolved[0] ?? null;
    }
    if (!Object.keys(out).length) return { ...row };
    if (shape && Object.values(shape).some((v) => typeof v === "object")) {
      for (const [key, value] of Object.entries(row)) {
        if (!(key in out) && !Object.prototype.hasOwnProperty.call(shape, key)) out[key] = value;
      }
    }
    return out;
  }

  async query<T extends SnapshotRecord = SnapshotRecord>(model: SnapshotModel, args: QueryArgs = {}): Promise<T[]> {
    const rows = sortRows((await this.rows(model)).filter((row) => matchesWhere(row, args.where)), args.orderBy);
    const shape = args.select ?? args.include;
    return Promise.all(rows.map((row) => this.project(model, row, shape))) as Promise<T[]>;
  }

  async load(models: SnapshotModel[]) {
    const entries = await Promise.all(models.map(async (model) => [model, await this.rows(model)] as const));
    return Object.fromEntries(entries);
  }
}

export async function resolveDataSource(source: string | null | undefined): Promise<DataSource> {
  if (!source || source === "live") return new LiveDataSource();
  const run = await prisma.snapshotRun.findUnique({ where: { id: source } });
  if (!run || run.status !== "completed" || !run.objectPrefix) {
    throw new SnapshotSourceError("Снимок не найден, не завершён или уже недоступен");
  }
  return new SnapshotDataSource({ ...run, objectPrefix: run.objectPrefix });
}

export class SnapshotSourceError extends Error {}

/**
 * Read-only Prisma-compatible facade for existing projection/serializer code.
 * Only findMany is intentionally exposed; snapshot mode can never mutate data.
 */
export function dataSourcePrismaAdapter(source: DataSource): typeof prisma {
  if (source.kind === "live") return prisma;
  const delegateToModel = new Map(
    Object.entries(MODEL_DELEGATES).map(([model, delegate]) => [delegate, model as SnapshotModel])
  );
  return new Proxy({} as typeof prisma, {
    get(_target, delegateName) {
      const model = delegateToModel.get(String(delegateName));
      if (!model) throw new Error(`Snapshot DataSource не поддерживает Prisma.${String(delegateName)}`);
      return {
        findMany: (args: QueryArgs = {}) => source.query(model, args),
        findUnique: async (args: QueryArgs = {}) => (await source.query(model, args))[0] ?? null,
      };
    },
  });
}
