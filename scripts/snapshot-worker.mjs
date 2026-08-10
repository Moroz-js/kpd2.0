#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  CASHFLOW_FORMULA_VERSION,
  projectAllCashflowYears,
} from "../lib/snapshots/cashflow-projection.mjs";

const TIMEZONE = "Europe/Moscow";
const SCHEMA_VERSION = 2;
const EXECUTION_LOCK = "snapshot-creation";
const MODELS = [
  ["User", "user"],
  ["Executor", "executor"],
  ["Client", "client"],
  ["Project", "project"],
  ["ProjectWorkType", "projectWorkType"],
  ["ProjectExecutor", "projectExecutor"],
  ["BankAccount", "bankAccount"],
  ["Currency", "currency"],
  ["WorkType", "workType"],
  ["ExecutorWorkType", "executorWorkType"],
  ["Work", "work"],
  ["Payment", "payment"],
  ["OtherExpense", "otherExpense"],
  ["NumberCounter", "numberCounter"],
  ["Order", "order"],
  ["Charge", "charge"],
  ["BankOperation", "bankOperation"],
  ["SpendingPlanLine", "spendingPlanLine"],
  ["VacationEntry", "vacationEntry"],
  ["Task", "task"],
  ["CashflowOpeningBalance", "cashflowOpeningBalance"],
  ["CashflowManualBalance", "cashflowManualBalance"],
  ["CashflowCellComment", "cashflowCellComment"],
  ["ActivityLog", "activityLog"],
  ["BankAccountReconciliation", "bankAccountReconciliation"],
  ["BankAccountReconciliationResult", "bankAccountReconciliationResult"],
  ["ProjectVerification", "projectVerification"],
  ["ProjectVerificationResult", "projectVerificationResult"],
];

const prisma = new PrismaClient({ log: ["error"] });

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function moscowNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function previousBusinessDate() {
  const p = moscowNowParts();
  const date = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function currentBusinessDate() {
  const p = moscowNowParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function parseBusinessDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("business date должна иметь формат YYYY-MM-DD");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Некорректная business date");
  }
  return date;
}

function storageMode() {
  return process.env.SNAPSHOT_STORAGE_MODE ?? "db";
}

function localRoot() {
  return path.resolve(process.env.SNAPSHOT_LOCAL_DIR ?? path.join(process.cwd(), "snapshots"));
}

function s3() {
  const Bucket = process.env.SNAPSHOT_S3_BUCKET;
  if (!Bucket) throw new Error("Не задан SNAPSHOT_S3_BUCKET");
  const endpoint = process.env.SNAPSHOT_S3_ENDPOINT || undefined;
  if (process.env.NODE_ENV === "production" && endpoint?.startsWith("http://")) {
    throw new Error("Production snapshot storage требует TLS (https endpoint)");
  }
  return {
    Bucket,
    client: new S3Client({
      region: process.env.SNAPSHOT_S3_REGION ?? process.env.AWS_REGION ?? "us-east-1",
      endpoint,
      forcePathStyle: process.env.SNAPSHOT_S3_FORCE_PATH_STYLE === "true",
    }),
  };
}

async function putObject(key, body, contentType, contentEncoding) {
  const mode = storageMode();
  if (mode === "db") {
    await prisma.snapshotObject.create({
      data: {
        key,
        body,
        contentType,
        contentEncoding: contentEncoding ?? null,
        byteSize: body.byteLength,
      },
    });
    return;
  }
  if (mode === "local") {
    const root = localRoot();
    const target = path.resolve(root, key);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Некорректный object key");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body, { flag: "wx" });
    return;
  }
  if (mode !== "s3") throw new Error("SNAPSHOT_STORAGE_MODE должен быть db, local или s3");
  const { Bucket, client } = s3();
  await client.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentEncoding: contentEncoding,
      ServerSideEncryption: "AES256",
    })
  );
}

async function checkStorage() {
  const mode = storageMode();
  if (!["db", "local", "s3"].includes(mode)) {
    throw new Error("SNAPSHOT_STORAGE_MODE должен быть db, local или s3");
  }
  if (mode === "db") {
    await prisma.snapshotObject.count();
    return;
  }
  if (mode === "local") {
    await fs.mkdir(localRoot(), { recursive: true });
    await fs.access(localRoot());
    return;
  }
  const { Bucket, client } = s3();
  await client.send(new HeadBucketCommand({ Bucket }));
}

function sanitize(model, row) {
  if (model !== "User") return row;
  const safe = { ...row };
  delete safe.password;
  return safe;
}

function stableJson(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function rowsToNdjson(model, rows) {
  return rows
    .map((row) => sanitize(model, row))
    .sort((a, b) => stableJson(a).localeCompare(stableJson(b)))
    .map((row) => JSON.stringify(row))
    .join("\n")
    .concat(rows.length ? "\n" : "");
}

function appCommit() {
  if (process.env.APP_COMMIT) return process.env.APP_COMMIT.slice(0, 64);
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim().slice(0, 64);
  } catch {
    return null;
  }
}

async function schemaHash() {
  const schema = await fs.readFile(path.join(process.cwd(), "prisma", "schema.prisma"));
  return createHash("sha256").update(schema).digest("hex");
}

async function readConsistentTables() {
  const read = async (tx) => {
    const data = {};
    for (const [model, delegateName] of MODELS) {
      const delegate = tx[delegateName];
      if (!delegate?.findMany) throw new Error(`Prisma delegate отсутствует: ${delegateName}`);
      data[model] = await delegate.findMany();
    }
    return data;
  };
  if ((process.env.DATABASE_URL ?? "").startsWith("postgres")) {
    return prisma.$transaction(read, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 120000,
      maxWait: 10000,
    });
  }
  return prisma.$transaction(read, { timeout: 120000, maxWait: 10000 });
}

async function removePrefix(prefix) {
  const mode = storageMode();
  const normalized = String(prefix).replace(/\/+$/, "");
  if (mode === "db") {
    await prisma.snapshotObject.deleteMany({
      where: {
        OR: [{ key: { startsWith: `${normalized}/` } }, { key: normalized }],
      },
    });
    return;
  }
  if (mode === "local") {
    const target = path.resolve(localRoot(), normalized);
    if (target.startsWith(`${localRoot()}${path.sep}`)) await fs.rm(target, { recursive: true, force: true });
    return;
  }
  const { Bucket, client } = s3();
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: `${normalized}/`, ContinuationToken: token }));
    const objects = (page.Contents ?? []).flatMap((item) => (item.Key ? [{ Key: item.Key }] : []));
    if (objects.length) await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: objects, Quiet: true } }));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

async function applyRetention(currentDate) {
  const cutoff = new Date(currentDate);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const oldRuns = await prisma.snapshotRun.findMany({
    where: { status: "completed", businessDate: { lt: cutoff }, objectPrefix: { not: null } },
    select: { id: true, objectPrefix: true },
  });
  for (const old of oldRuns) {
    await removePrefix(old.objectPrefix);
    await prisma.snapshotRun.update({
      where: { id: old.id },
      data: { objectPrefix: null, manifestKey: null, error: "retention_expired" },
    });
  }
}

async function check() {
  if (!process.env.DATABASE_URL) throw new Error("Не задан DATABASE_URL");
  const configured = new Set(MODELS.map(([model]) => model));
  const missingModels = Prisma.dmmf.datamodel.models
    .map((model) => model.name)
    .filter(
      (model) =>
        model !== "SnapshotRun" &&
        model !== "SnapshotObject" &&
        !configured.has(model)
    );
  if (missingModels.length) {
    throw new Error(`Snapshot registry не содержит модели: ${missingModels.join(", ")}`);
  }
  await checkStorage();
  await prisma.$queryRaw`SELECT 1`;
  await prisma.snapshotRun.count();
  console.log(`[snapshot] configuration OK (${storageMode()}, ${TIMEZONE}, ${CASHFLOW_FORMULA_VERSION})`);
}

export async function createSnapshot({
  manual = false,
  businessDate: requestedBusinessDate = null,
} = {}) {
  await check();

  const p = moscowNowParts();
  if (!manual && (Number(p.hour) !== 0 || Number(p.minute) > 20)) {
    const missedText = previousBusinessDate();
    const missedDate = parseBusinessDate(missedText);
    const scheduleKey = `scheduled:${missedText}`;
    const existing = await prisma.snapshotRun.findFirst({
      where: {
        OR: [
          { scheduleKey },
          { scheduleKey: null, runKind: "scheduled", businessDate: missedDate },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!existing || existing.status !== "completed") {
      const data = {
        cutoffAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        status: "failed",
        timezone: TIMEZONE,
        schemaVersion: SCHEMA_VERSION,
        schemaHash: await schemaHash(),
        appCommit: appCommit(),
        formulaVersion: CASHFLOW_FORMULA_VERSION,
        runKind: "scheduled",
        scheduleKey,
        error: "Пропущено окно 00:01–00:20 МСК; поздний запуск не является точным снимком конца дня",
      };
      if (existing) await prisma.snapshotRun.update({ where: { id: existing.id }, data });
      else await prisma.snapshotRun.create({ data: { businessDate: missedDate, ...data } });
    }
    throw new Error("Пропущено окно 00:01–00:20 МСК; поздний запуск не создаёт неточный снимок");
  }

  const dateText =
    requestedBusinessDate ?? (manual ? currentBusinessDate() : previousBusinessDate());
  const businessDate = parseBusinessDate(dateText);
  if (!manual && dateText !== previousBusinessDate()) throw new Error("Автоматический run может снимать только предыдущий день");
  const scheduleKey = manual ? null : `scheduled:${dateText}`;

  const staleBefore = new Date(Date.now() - 30 * 60 * 1000);
  const staleRuns = await prisma.snapshotRun.findMany({
    where: { executionLock: EXECUTION_LOCK, startedAt: { lt: staleBefore } },
    select: { id: true, businessDate: true },
  });
  for (const stale of staleRuns) {
    const staleDate = stale.businessDate.toISOString().slice(0, 10);
    await removePrefix(`snapshots/${staleDate.slice(0, 4)}/${staleDate}/${stale.id}`);
    await prisma.snapshotRun.update({
      where: { id: stale.id },
      data: {
        executionLock: null,
        status: "failed",
        completedAt: new Date(),
        error: "Предыдущий процесс создания снимка превысил 30 минут",
      },
    });
  }

  let runRow;
  try {
    const existing = manual
      ? null
      : await prisma.snapshotRun.findFirst({
          where: {
            OR: [
              { scheduleKey },
              { scheduleKey: null, runKind: "scheduled", businessDate },
            ],
          },
          orderBy: { createdAt: "asc" },
        });
    if (existing?.status === "completed") {
      console.log(`[snapshot] ${dateText} уже опубликован (${existing.id})`);
      return existing;
    }
    if (existing?.status === "running" && existing.executionLock === EXECUTION_LOCK) {
      console.log("[snapshot] другой worker уже выполняется");
      return { busy: true };
    }

    const metadata = {
      cutoffAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      status: "running",
      timezone: TIMEZONE,
      schemaVersion: SCHEMA_VERSION,
      schemaHash: await schemaHash(),
      appCommit: appCommit(),
      formulaVersion: CASHFLOW_FORMULA_VERSION,
      runKind: manual ? "manual" : "scheduled",
      scheduleKey,
      executionLock: EXECUTION_LOCK,
      rowCounts: null,
      byteSize: null,
      contentHash: null,
      objectPrefix: null,
      manifestKey: null,
      error: null,
    };
    try {
      runRow = existing
        ? await prisma.snapshotRun.update({ where: { id: existing.id }, data: metadata })
        : await prisma.snapshotRun.create({ data: { businessDate, ...metadata } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        console.log("[snapshot] другой worker уже выполняется");
        return { busy: true };
      }
      throw error;
    }

    const prefix = `snapshots/${dateText.slice(0, 4)}/${dateText}/${runRow.id}`;
    if (existing) {
      // Незавершённый запуск может оставить частичные объекты. Готовые снимки
      // отсекаются выше и никогда не перезаписываются.
      await removePrefix(prefix);
    }
    const tables = await readConsistentTables();
    const files = [];
    const rowCounts = {};
    let byteSize = 0;
    const aggregateHash = createHash("sha256");

    for (const [model] of MODELS) {
      const key = `${prefix}/models/${model}.ndjson.gz`;
      const ndjson = rowsToNdjson(model, tables[model]);
      const hash = createHash("sha256").update(ndjson).digest("hex");
      const compressed = gzipSync(Buffer.from(ndjson), { level: 9 });
      await putObject(key, compressed, "application/x-ndjson", "gzip");
      rowCounts[model] = tables[model].length;
      byteSize += compressed.byteLength;
      aggregateHash.update(`${model}:${hash}:${tables[model].length}\n`);
      files.push({ model, key: `models/${model}.ndjson.gz`, rows: tables[model].length, sha256: hash, bytes: compressed.byteLength });
    }

    const cashflow = JSON.stringify(projectAllCashflowYears(tables, runRow.cutoffAt));
    const cashflowHash = createHash("sha256").update(cashflow).digest("hex");
    const cashflowBody = gzipSync(Buffer.from(cashflow), { level: 9 });
    const cashflowProjectionKey = `projections/${CASHFLOW_FORMULA_VERSION}.json.gz`;
    await putObject(`${prefix}/${cashflowProjectionKey}`, cashflowBody, "application/json", "gzip");
    byteSize += cashflowBody.byteLength;
    aggregateHash.update(`cashflow:${cashflowHash}\n`);

    const contentHash = aggregateHash.digest("hex");
    const manifest = {
      runId: runRow.id,
      businessDate: dateText,
      cutoffAt: runRow.cutoffAt.toISOString(),
      timezone: TIMEZONE,
      schemaVersion: SCHEMA_VERSION,
      schemaHash: runRow.schemaHash,
      appCommit: runRow.appCommit,
      formulaVersion: CASHFLOW_FORMULA_VERSION,
      rowCounts,
      byteSize,
      contentHash,
      files,
      projections: [{ key: cashflowProjectionKey, sha256: cashflowHash, formulaVersion: CASHFLOW_FORMULA_VERSION }],
    };
    const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2));
    await putObject(`${prefix}/manifest.json`, manifestBody, "application/json");

    const completed = await prisma.snapshotRun.update({
      where: { id: runRow.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        rowCounts: JSON.stringify(rowCounts),
        byteSize,
        contentHash,
        objectPrefix: prefix,
        manifestKey: `${prefix}/manifest.json`,
        executionLock: null,
      },
    });
    await applyRetention(businessDate);
    console.log(`[snapshot] completed ${dateText}: ${runRow.id}, ${byteSize} bytes, sha256=${contentHash}`);
    return completed;
  } catch (error) {
    if (runRow?.id) {
      await prisma.snapshotRun.update({
        where: { id: runRow.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          executionLock: null,
          error: error instanceof Error ? error.message.slice(0, 4000) : String(error).slice(0, 4000),
        },
      }).catch(() => undefined);
    }
    throw error;
  }
}

async function run() {
  if (process.argv.includes("--check")) return check();
  return createSnapshot({
    manual: process.argv.includes("--manual"),
    businessDate: arg("--business-date"),
  });
}

async function notifyFailure(error) {
  const url = process.env.SNAPSHOT_ALERT_WEBHOOK_URL;
  if (!url || process.argv.includes("--check")) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "kpd-snapshot",
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        occurredAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (notifyError) {
    console.error(`[snapshot] alert webhook failed: ${notifyError instanceof Error ? notifyError.message : String(notifyError)}`);
  }
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  run()
    .catch(async (error) => {
      console.error(`[snapshot] FAILED: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      await notifyFailure(error);
    })
    .finally(() => prisma.$disconnect());
}
