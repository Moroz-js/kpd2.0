import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabaseUrl, getMigrationDatabaseUrl, isPostgresUrl } from "./database-url.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
const args = parseArgs(process.argv.slice(2));
const environment = args.environment;
const mode = args.apply ? "apply" : args["verify-only"] ? "verify-only" : "dry-run";
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
const reportsDir = path.join(root, "migration-reports");
const backupsDir = path.join(root, "migration-backups");
mkdirSync(reportsDir, { recursive: true });
mkdirSync(backupsDir, { recursive: true });

let prisma;
let lockRelease = () => {};
let report = {
  migration: "migrate-other-expenses",
  mode,
  environment,
  startedAt: startedAt.toISOString(),
  sourceDate: "2026-07-11",
  target: null,
  source: null,
  backup: null,
  countsBefore: null,
  countsAfter: null,
  schema: { applied: false },
  transforms: {},
  numbering: {},
  repair: {},
  verification: null,
  warnings: [],
  error: null,
};

main()
  .catch((error) => {
    report.error = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
    process.exitCode = 1;
  })
  .finally(async () => {
    report.completedAt = new Date().toISOString();
    const reportPath = path.join(reportsDir, `migrate-other-expenses-${stamp}.json`);
    writeFileSync(reportPath, `${JSON.stringify(report, jsonReplacer, 2)}\n`);
    try {
      await lockRelease();
    } catch {
      // Основная ошибка уже отражена в отчёте.
    }
    if (prisma) await prisma.$disconnect().catch(() => {});
    console.log(`[migration] report=${path.relative(root, reportPath)}`);
  });

async function main() {
  validateArgs();
  const dbUrl = getMigrationDatabaseUrl() || getDatabaseUrl();
  const target = databaseTarget(dbUrl);
  validateEnvironment(target);
  report.target = target.safe;
  console.log(`[migration] mode=${mode} environment=${environment} target=${target.safe}`);

  const source = args["other-expenses-source"]
    ? loadSourceWorkbook(path.resolve(args["other-expenses-source"]))
    : null;
  if (source) {
    report.source = {
      path: source.filePath,
      sha256: source.sha256,
      sheet: source.sheetName,
      rows: source.rows.length,
      headerRow: 4,
    };
  }

  execFileSync(process.execPath, ["scripts/set-prisma-provider.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "inherit",
  });
  if (!args["skip-generate"]) {
    execFileSync(process.execPath, [prismaCli, "generate"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "inherit",
    });
  }

  const { PrismaClient } = await import("@prisma/client");
  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  await prisma.$connect();
  lockRelease = await acquireLock(target, dbUrl);

  report.countsBefore = await readCoreCounts();
  const rawOtherExpenses = await prisma.$queryRawUnsafe('SELECT * FROM "other_expenses"');

  if (mode === "dry-run") {
    report.schema.diff = runSchemaDiff(dbUrl);
    report.numbering.preview = await previewNumbering(rawOtherExpenses);
    report.transforms.sentPayments = await rawCount(
      'SELECT COUNT(*) AS "count" FROM "payments" WHERE "paymentStatus" = \'sent\''
    );
    report.transforms.sentOtherExpenses = await rawCount(
      'SELECT COUNT(*) AS "count" FROM "other_expenses" WHERE "paymentStatus" = \'sent\''
    );
    if (source) {
      report.repair = await buildRepairPlan(source.rows, { rawFallback: true });
      writeRepairArtifacts(report.repair);
    }
    console.log("[migration] dry-run завершён, БД не изменена");
    return;
  }

  if (mode === "apply") {
    report.backup = await createBackup(target, dbUrl, rawOtherExpenses);
    applySchema(dbUrl);
    report.schema.applied = true;

    report.transforms = await applyTransforms();
    report.numbering = await backfillNumbers();
    report.repair = await buildRepairPlan(source.rows);
    writeRepairArtifacts(report.repair);
    await applyRepairPlan(report.repair);
  }

  report.verification = await verifyMigration();
  report.countsAfter = await readCoreCounts();
  assertCountsUnchanged(report.countsBefore, report.countsAfter);
  if (!report.verification.ok) {
    throw new Error(`Верификация не пройдена: ${report.verification.errors.join("; ")}`);
  }
  console.log(`[migration] ${mode} завершён успешно`);
}

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    result[key] = rest.length ? rest.join("=") : true;
  }
  return result;
}

function validateArgs() {
  if (environment !== "dev" && environment !== "production") {
    throw new Error("Обязателен --environment=dev|production");
  }
  const selectedModes = ["apply", "verify-only", "dry-run"].filter((key) => args[key]);
  if (selectedModes.length > 1) throw new Error("Выберите только один режим");
  if (mode === "apply" && !args["other-expenses-source"]) {
    throw new Error("Для --apply обязателен --other-expenses-source");
  }
  if (environment === "production") {
    const dbName = databaseTarget(getMigrationDatabaseUrl() || getDatabaseUrl()).database;
    if (args["confirm-production"] !== dbName) {
      throw new Error(`Для production укажите --confirm-production="${dbName}"`);
    }
    if (mode === "apply" && !args["maintenance-confirmed"]) {
      throw new Error("Production apply требует --maintenance-confirmed");
    }
  }
}

function databaseTarget(url) {
  if (isPostgresUrl(url)) {
    const parsed = new URL(url);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    return {
      provider: "postgresql",
      database,
      host: parsed.hostname,
      port: parsed.port || "5432",
      safe: `postgresql://${parsed.hostname}:${parsed.port || "5432"}/${database}`,
      parsed,
    };
  }
  const rawPath = url.replace(/^file:/, "").split("?")[0];
  const filePath = path.resolve(root, "prisma", rawPath);
  return {
    provider: "sqlite",
    database: path.basename(filePath),
    filePath,
    safe: `sqlite:${filePath}`,
  };
}

function validateEnvironment(target) {
  if (environment === "production" && target.provider !== "postgresql") {
    throw new Error("Production migration разрешена только для PostgreSQL");
  }
  const allowVar =
    environment === "production"
      ? process.env.MIGRATION_ALLOWED_PRODUCTION_DATABASES
      : process.env.MIGRATION_ALLOWED_DEV_DATABASES;
  if (allowVar) {
    const allowed = allowVar.split(",").map((value) => value.trim()).filter(Boolean);
    if (!allowed.includes(target.safe)) {
      throw new Error(`Fingerprint ${target.safe} отсутствует в allowlist выбранной среды`);
    }
  } else if (environment === "production") {
    report.warnings.push("MIGRATION_ALLOWED_PRODUCTION_DATABASES не задан; использовано подтверждение имени БД");
  }
}

function loadSourceWorkbook(filePath) {
  if (!existsSync(filePath)) throw new Error(`XLSX не найден: ${filePath}`);
  if (path.basename(filePath).toLocaleLowerCase("ru-RU") !== "прочие_траты.xlsx") {
    throw new Error("Ожидается источник с именем прочие_траты.xlsx");
  }
  const data = readFileSync(filePath);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const workbook = XLSX.read(data, { type: "buffer", cellDates: true });
  const visibleSheet = workbook.SheetNames.find((name, index) => {
    const metadata = workbook.Workbook?.Sheets?.[index];
    return !metadata || !metadata.Hidden;
  });
  if (!visibleSheet) throw new Error("В XLSX нет видимого листа");
  const sheet = workbook.Sheets[visibleSheet];
  const rows = XLSX.utils.sheet_to_json(sheet, { range: 3, defval: null, raw: false });
  if (!rows.length) throw new Error("XLSX не содержит строк после заголовка в строке 4");

  const expectedHeaders = [
    "Год выполнения*",
    "Месяц выполнения работ*",
    "Неделя оплаты план-факт",
    "Год оплаты план-факт",
    "Проект*",
    "Исполнитель*",
    "Описание работы*",
    "Вид работ*",
    "Ответственный*",
    "Предпочтительный способ оплапты",
    "Дата оплаты - план",
    "Сумма к выплате*",
    "Статус Работы",
    "Статус Выплаты",
    "Выплата*",
    "Дата оплаты",
    "Источник перевода*",
    "__SRC_UID",
  ];
  const headers = new Set(Object.keys(rows[0]));
  const missing = expectedHeaders.filter((header) => !headers.has(header));
  if (missing.length) throw new Error(`В XLSX отсутствуют колонки: ${missing.join(", ")}`);

  const uids = rows.map((row) => clean(row.__SRC_UID));
  if (uids.some((uid) => !uid)) throw new Error("В XLSX есть пустой __SRC_UID");
  if (new Set(uids).size !== uids.length) throw new Error("В XLSX есть дубли __SRC_UID");
  return { filePath, sha256, sheetName: visibleSheet, rows };
}

async function acquireLock(target, dbUrl) {
  if (target.provider === "postgresql") {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [726072026]);
    if (!result.rows[0]?.locked) {
      await client.end();
      throw new Error("Другой migrate-other-expenses уже выполняется");
    }
    return async () => {
      await client.query("SELECT pg_advisory_unlock($1)", [726072026]);
      await client.end();
    };
  }

  const lockPath = `${target.filePath}.migrate-other-expenses.lock`;
  let fd;
  try {
    fd = openSync(lockPath, "wx");
  } catch {
    throw new Error(`Файл блокировки уже существует: ${lockPath}`);
  }
  writeFileSync(fd, `${process.pid}\n`);
  return async () => {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  };
}

function runSchemaDiff(dbUrl) {
  try {
    const diffUrl = isPostgresUrl(dbUrl)
      ? dbUrl
      : `file:${databaseTarget(dbUrl).filePath.replaceAll("\\", "/")}`;
    return execFileSync(
      process.execPath,
      [prismaCli, "migrate", "diff", "--from-url", diffUrl, "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
      { cwd: root, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" }
    );
  } catch (error) {
    report.warnings.push(`Не удалось получить schema diff: ${error.message}`);
    return null;
  }
}

function applySchema(dbUrl) {
  execFileSync(
    process.execPath,
    [prismaCli, "db", "push", "--skip-generate"],
    { cwd: root, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "inherit" }
  );
}

async function createBackup(target, dbUrl, rawOtherExpenses) {
  const prefix = path.join(backupsDir, `migrate-other-expenses-${stamp}`);
  let dbBackup;
  if (target.provider === "postgresql") {
    dbBackup = `${prefix}.dump`;
    const parsed = new URL(dbUrl);
    execFileSync(
      "pg_dump",
      [
        "--format=custom",
        "--host", parsed.hostname,
        "--port", parsed.port || "5432",
        "--username", decodeURIComponent(parsed.username),
        "--dbname", decodeURIComponent(parsed.pathname.slice(1)),
        "--file", dbBackup,
      ],
      {
        env: { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password) },
        stdio: ["ignore", "inherit", "inherit"],
      }
    );
  } else {
    dbBackup = `${prefix}.sqlite`;
    const escaped = dbBackup.replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);
  }
  assertNonEmptyFile(dbBackup);

  const [projects, executors, workTypes, users, bankAccounts] = await Promise.all([
    prisma.$queryRawUnsafe('SELECT * FROM "projects"'),
    prisma.$queryRawUnsafe('SELECT * FROM "executors"'),
    prisma.$queryRawUnsafe('SELECT * FROM "work_types"'),
    prisma.$queryRawUnsafe('SELECT "id", "email", "fullName", "role", "isActive" FROM "users"'),
    prisma.$queryRawUnsafe('SELECT * FROM "bank_accounts"'),
  ]);
  const jsonPath = `${prefix}-other-expenses.json`;
  writeFileSync(
    jsonPath,
    `${JSON.stringify({
      otherExpenses: rawOtherExpenses,
      references: { projects, executors, workTypes, users, bankAccounts },
    }, jsonReplacer, 2)}\n`
  );
  assertNonEmptyFile(jsonPath);

  const xlsxPath = `${prefix}-other-expenses.xlsx`;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rawOtherExpenses), "Прочие траты");
  XLSX.writeFile(workbook, xlsxPath);
  assertNonEmptyFile(xlsxPath);

  return {
    database: fileInfo(dbBackup),
    otherExpensesJson: fileInfo(jsonPath),
    otherExpensesXlsx: fileInfo(xlsxPath),
  };
}

function assertNonEmptyFile(filePath) {
  if (!existsSync(filePath) || statSync(filePath).size === 0) {
    throw new Error(`Backup не создан или пуст: ${filePath}`);
  }
}

function fileInfo(filePath) {
  const data = readFileSync(filePath);
  return {
    path: filePath,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

async function applyTransforms() {
  const beforeContacts = await prisma.executor.findMany({ select: { id: true, contacts: true } });
  const [sentPayments, sentOtherExpenses, executors, snapshotRuns] = await prisma.$transaction([
    prisma.payment.updateMany({ where: { paymentStatus: "sent" }, data: { paymentStatus: "paid" } }),
    prisma.otherExpense.updateMany({ where: { paymentStatus: "sent" }, data: { paymentStatus: "paid" } }),
    prisma.executor.findMany({
      include: { user: { select: { email: true, isActive: true } } },
    }),
    prisma.snapshotRun.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  let contactEmails = 0;
  let accessEmails = 0;
  await prisma.$transaction(async (tx) => {
    for (const executor of executors) {
      if (!executor.user) continue;
      const hasActiveAccess =
        executor.user.isActive &&
        executor.status === "active" &&
        executor.accessRevokedAt == null;
      await tx.executor.update({
        where: { id: executor.id },
        data: {
          contactEmail: executor.contactEmail ?? executor.user.email,
          accessEmail: hasActiveAccess
            ? (executor.accessEmail ?? executor.user.email)
            : null,
        },
      });
      if (!executor.contactEmail) contactEmails += 1;
      if (!executor.accessEmail && hasActiveAccess) accessEmails += 1;
    }
    for (const run of snapshotRuns) {
      if (run.scheduleKey) continue;
      const date = run.businessDate.toISOString().slice(0, 10);
      await tx.snapshotRun.update({
        where: { id: run.id },
        data: { runKind: "scheduled", scheduleKey: `scheduled:${date}` },
      });
    }
  });

  const afterContacts = await prisma.executor.findMany({ select: { id: true, contacts: true } });
  if (JSON.stringify(beforeContacts) !== JSON.stringify(afterContacts)) {
    throw new Error("Поле Executor.contacts изменилось во время миграции");
  }
  const amountRows = await prisma.otherExpense.findMany({
    select: { amount: true, paymentAmount: true },
  });
  const amountMismatches = amountRows.filter(
    (row) => row.paymentAmount != null && row.amount !== row.paymentAmount
  ).length;

  return {
    sentPayments: sentPayments.count,
    sentOtherExpenses: sentOtherExpenses.count,
    contactEmails,
    accessEmails,
    snapshotScheduleKeys: snapshotRuns.filter((run) => !run.scheduleKey).length,
    amountMismatches,
  };
}

async function previewNumbering(rawOtherExpenses) {
  const [payments, works] = await Promise.all([
    prisma.$queryRawUnsafe('SELECT * FROM "payments"'),
    prisma.$queryRawUnsafe('SELECT * FROM "works"'),
  ]);
  return {
    payoutMissing:
      payments.filter((row) => !row.payoutNumber).length +
      rawOtherExpenses.filter((row) => row.paymentAmount != null && !row.payoutNumber).length,
    issuedWorkMissing:
      works.filter((row) => !row.issuedWorkNumber).length +
      rawOtherExpenses.filter((row) => !row.issuedWorkNumber).length,
    otherExpenseMissing: rawOtherExpenses.filter((row) => !row.otherExpenseNumber).length,
  };
}

async function backfillNumbers() {
  const [payments, works, otherExpenses] = await Promise.all([
    prisma.payment.findMany(),
    prisma.work.findMany(),
    prisma.otherExpense.findMany(),
  ]);
  const payoutItems = [
    ...payments.map((row) => item("payment", row, row.periodYear, "payout")),
    ...otherExpenses
      .filter((row) => row.paymentAmount != null || row.paymentStatus != null)
      .map((row) => item("otherExpense", row, row.executionYear, "payout")),
  ];
  const issuedItems = [
    ...works.map((row) => item("work", row, row.executionYear, "issuedWork")),
    ...otherExpenses.map((row) => item("otherExpense", row, row.executionYear, "issuedWork")),
  ];
  const expenseItems = otherExpenses.map((row) =>
    item("otherExpense", row, row.executionYear, "otherExpense")
  );

  const payout = await backfillScope("payout", payoutItems);
  const issuedWork = await backfillScope("issued-work", issuedItems);
  const otherExpense = await backfillScope("other-expense", expenseItems);
  return { payout, issuedWork, otherExpense };
}

function item(model, row, year, kind) {
  const prefix = kind === "payout" ? "payout" : kind;
  const numberYear = row[`${prefix}NumberYear`];
  return {
    model,
    id: row.id,
    year: numberYear ?? year,
    number: row[`${prefix}Number`],
    numberYear,
    serial: row[`${prefix}NumberSerial`],
    paidAt: row.paidAt,
    plannedPayAt: row.plannedPayAt,
    createdAt: row.createdAt,
    prefix,
  };
}

async function backfillScope(scope, items) {
  let assigned = 0;
  const years = new Map();
  for (const entry of items) {
    if (!years.has(entry.year)) years.set(entry.year, []);
    years.get(entry.year).push(entry);
  }

  for (const [year, rows] of years) {
    const used = new Set();
    for (const row of rows) {
      if (row.number && (row.numberYear == null || row.serial == null)) {
        throw new Error(`Неполные поля номера ${scope}: ${row.model}/${row.id}`);
      }
      if (row.serial == null) continue;
      if (used.has(row.serial)) throw new Error(`Дубль ${scope} ${year}.${row.serial}`);
      used.add(row.serial);
    }
    const missing = rows.filter((row) => !row.number).sort(compareNumberBackfill);
    let next = 1;
    await prisma.$transaction(async (tx) => {
      for (const row of missing) {
        while (used.has(next)) next += 1;
        const number = formatNumber(scope, year, next);
        const data = {
          [`${row.prefix}Number`]: number,
          [`${row.prefix}NumberYear`]: year,
          [`${row.prefix}NumberSerial`]: next,
        };
        await tx[row.model].update({ where: { id: row.id }, data });
        used.add(next);
        next += 1;
        assigned += 1;
      }
      const max = used.size ? Math.max(...used) : 0;
      const existingCounter = await tx.numberCounter.findUnique({
        where: { scope_year: { scope, year } },
        select: { lastValue: true },
      });
      const counterValue = Math.max(max, existingCounter?.lastValue ?? 0);
      await tx.numberCounter.upsert({
        where: { scope_year: { scope, year } },
        create: { scope, year, lastValue: counterValue },
        update: { lastValue: { set: counterValue } },
      });
    });
  }
  return { assigned, total: items.length };
}

function compareNumberBackfill(a, b) {
  const ad = a.paidAt ?? a.plannedPayAt;
  const bd = b.paidAt ?? b.plannedPayAt;
  if (ad && bd) {
    const delta = new Date(ad).getTime() - new Date(bd).getTime();
    if (delta) return delta;
  } else if (ad) return -1;
  else if (bd) return 1;
  return (
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
    a.id.localeCompare(b.id)
  );
}

function formatNumber(scope, year, serial) {
  const prefix = scope === "payout" ? "В" : scope === "issued-work" ? "ВР" : "ПТ";
  return `${prefix}${String(Math.abs(year) % 100).padStart(2, "0")}.${String(serial).padStart(3, "0")}`;
}

async function buildRepairPlan(sourceRows, options = {}) {
  if (!sourceRows) return { skipped: true, reason: "XLSX не передан" };
  let expenses;
  let executors;
  let projects;
  let workTypes;
  if (options.rawFallback && !(await hasColumn("other_expenses", "sourceUid"))) {
    [expenses, executors, projects, workTypes] = await Promise.all([
      prisma.$queryRawUnsafe('SELECT * FROM "other_expenses"'),
      prisma.$queryRawUnsafe('SELECT * FROM "executors"'),
      prisma.$queryRawUnsafe('SELECT * FROM "projects"'),
      prisma.$queryRawUnsafe('SELECT * FROM "work_types"'),
    ]);
    const executorById = new Map(executors.map((row) => [row.id, row]));
    const projectById = new Map(projects.map((row) => [row.id, row]));
    const workTypeById = new Map(workTypes.map((row) => [row.id, row]));
    expenses = expenses.map((row) => ({
      ...row,
      sourceUid: row.sourceUid ?? null,
      executor: executorById.get(row.executorId),
      project: projectById.get(row.projectId),
      workType: workTypeById.get(row.workTypeId),
      responsibleExecutor: executorById.get(row.responsibleExecutorId) ?? null,
    }));
  } else {
    [expenses, executors, projects, workTypes] = await Promise.all([
      prisma.otherExpense.findMany({
        include: {
          executor: true,
          project: true,
          workType: true,
          responsibleExecutor: true,
        },
      }),
      prisma.executor.findMany(),
      prisma.project.findMany(),
      prisma.workType.findMany(),
    ]);
  }
  const executorByName = uniqueNameMap(executors);
  const executorByUserId = new Map(
    executors.filter((row) => row.userId).map((row) => [row.userId, row])
  );
  const direct = new Map(expenses.filter((row) => row.sourceUid).map((row) => [row.sourceUid, row]));
  const candidates = new Map();
  for (const expense of expenses) {
    for (const key of expenseKeys(expense)) {
      const list = candidates.get(key) ?? [];
      list.push(expense);
      candidates.set(key, list);
    }
  }

  const decisions = [];
  const matchedIds = new Set();
  for (const source of sourceRows) {
    const uid = clean(source.__SRC_UID);
    let current = direct.get(uid);
    let match = current ? "source_uid" : "composite";
    if (!current) {
      const found = sourceKeys(source).flatMap((key) => candidates.get(key) ?? []);
      const unique = [...new Map(found.map((row) => [row.id, row])).values()]
        .filter((row) => !matchedIds.has(row.id));
      if (unique.length === 1) current = unique[0];
      else {
        decisions.push({
          sourceUid: uid,
          currentId: null,
          match: unique.length > 1 ? "ambiguous" : "unmatched",
          reason: unique.length > 1 ? "conflict" : "unmatched",
          candidateIds: unique.map((row) => row.id),
        });
        continue;
      }
    }
    matchedIds.add(current.id);

    const sourceResponsible = executorByName.get(normalize(source["Ответственный*"])) ?? null;
    const migrationResponsible =
      executorByUserId.get(current.project.responsibleUserId) ?? null;
    const sourceBase = {
      description: nullable(source["Описание работы*"]),
      preferredPayMethod: nullable(source["Предпочтительный способ оплапты"]),
      responsibleExecutorId: sourceResponsible?.id ?? null,
    };
    const baseline = {
      description: `${current.workType.name} — ${current.executor.name}`,
      preferredPayMethod: current.executor.recipientType,
      responsibleExecutorId: migrationResponsible?.id ?? null,
    };
    const currentValues = {
      description: current.description,
      preferredPayMethod: current.preferredPayMethod,
      responsibleExecutorId: current.responsibleExecutorId,
    };
    const fields = {};
    for (const field of Object.keys(sourceBase)) {
      const sourceValue = sourceBase[field];
      const baselineValue = baseline[field];
      const currentValue = currentValues[field];
      if (sourceValue == null) {
        fields[field] = { sourceBase: sourceValue, migrationBaseline: baselineValue, current: currentValue, proposed: currentValue, reason: "conflict" };
      } else if (sameValue(currentValue, baselineValue)) {
        fields[field] = { sourceBase: sourceValue, migrationBaseline: baselineValue, current: currentValue, proposed: sourceValue, reason: "restore_source" };
      } else {
        fields[field] = { sourceBase: sourceValue, migrationBaseline: baselineValue, current: currentValue, proposed: currentValue, reason: "preserve_current" };
      }
    }
    decisions.push({
      sourceUid: uid,
      currentId: current.id,
      match,
      reason: Object.values(fields).some((field) => field.reason === "conflict")
        ? "conflict"
        : "matched",
      fields,
    });
  }
  const matched = decisions.filter((row) => row.currentId);
  return {
    sourceRows: sourceRows.length,
    matched: matched.length,
    unmatched: decisions.filter((row) => row.match === "unmatched").length,
    ambiguous: decisions.filter((row) => row.match === "ambiguous").length,
    conflicts: matched.filter((row) => row.reason === "conflict").length,
    newSystemRows: expenses.filter((row) => !matchedIds.has(row.id)).map((row) => row.id),
    decisions,
  };
}

async function applyRepairPlan(plan) {
  if (plan.skipped) return;
  const applicable = plan.decisions.filter((row) => row.currentId);
  await prisma.$transaction(async (tx) => {
    for (const decision of applicable) {
      const data = { sourceUid: decision.sourceUid };
      for (const [field, value] of Object.entries(decision.fields)) {
        if (value.reason === "restore_source") data[field] = value.proposed;
      }
      await tx.otherExpense.update({ where: { id: decision.currentId }, data });
    }
  });
  plan.applied = applicable.length;
}

function expenseKeys(expense) {
  const base = [
    expense.executor.name,
    expense.project.name,
    expense.workType.name,
    expense.executionYear,
    expense.executionMonth,
    expense.amount,
  ];
  const date = dateKey(expense.paidAt ?? expense.plannedPayAt);
  return [
    compositeKey([...base, date, expense.comment]),
    compositeKey([...base, date]),
    compositeKey(base),
  ];
}

function sourceKeys(source) {
  const base = [
    source["Исполнитель*"],
    source["Проект*"],
    source["Вид работ*"],
    source["Год выполнения*"],
    parseMonth(source["Месяц выполнения работ*"]),
    parseAmount(source["Сумма к выплате*"]),
  ];
  const date = dateKey(source["Дата оплаты"] ?? source["Дата оплаты - план"]);
  return [
    compositeKey([...base, date, source.Комментарий]),
    compositeKey([...base, date]),
    compositeKey(base),
  ];
}

function uniqueNameMap(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = normalize(row.name);
    const values = buckets.get(key) ?? [];
    values.push(row);
    buckets.set(key, values);
  }
  return new Map(
    [...buckets.entries()].filter(([, values]) => values.length === 1).map(([key, values]) => [key, values[0]])
  );
}

function compositeKey(values) {
  return values.map((value) => normalize(value)).join("|");
}

function normalize(value) {
  return clean(value).toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim();
}

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function nullable(value) {
  const result = clean(value);
  return result || null;
}

function sameValue(a, b) {
  return normalize(a) === normalize(b);
}

function parseAmount(value) {
  const number = Number(clean(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : value;
}

function parseMonth(value) {
  const raw = normalize(value).replace(/\.$/, "");
  const number = Number(raw);
  if (Number.isInteger(number) && number >= 1 && number <= 12) return number;
  const months = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  const genitive = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const index = months.indexOf(raw);
  const genitiveIndex = genitive.indexOf(raw);
  return (index >= 0 ? index : genitiveIndex) + 1 || value;
}

function dateKey(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const ruDate = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (ruDate) {
      return `${ruDate[3]}-${ruDate[2].padStart(2, "0")}-${ruDate[1].padStart(2, "0")}`;
    }
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? normalize(value) : parsed.toISOString().slice(0, 10);
}

function writeRepairArtifacts(plan) {
  if (!plan?.decisions) return;
  const jsonPath = path.join(reportsDir, `repair-other-expenses-${stamp}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(plan, jsonReplacer, 2)}\n`);
  const csvRows = plan.decisions
    .filter((row) => row.match === "unmatched" || row.match === "ambiguous" || row.reason === "conflict")
    .map((row) => ({
      sourceUid: row.sourceUid,
      currentId: row.currentId,
      match: row.match,
      reason: row.reason,
      candidateIds: row.candidateIds?.join("|") ?? "",
    }));
  const csvPath = path.join(reportsDir, `repair-other-expenses-conflicts-${stamp}.csv`);
  writeFileSync(csvPath, XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(csvRows)));
  report.repairArtifacts = { json: jsonPath, csv: csvPath };
}

async function verifyMigration() {
  const errors = [];
  const [payments, works, expenses, counters, snapshotRuns, executors] = await Promise.all([
    prisma.payment.findMany(),
    prisma.work.findMany(),
    prisma.otherExpense.findMany(),
    prisma.numberCounter.findMany(),
    prisma.snapshotRun.findMany(),
    prisma.executor.findMany({ include: { user: { select: { email: true, isActive: true } } } }),
  ]);
  if (payments.some((row) => row.paymentStatus === "sent")) errors.push("Payment содержит sent");
  if (expenses.some((row) => row.paymentStatus === "sent")) errors.push("OtherExpense содержит sent");
  if (payments.some((row) => !row.payoutNumber)) errors.push("Есть Payment без номера");
  if (works.some((row) => !row.issuedWorkNumber)) errors.push("Есть Work без номера");
  if (expenses.some((row) => !row.otherExpenseNumber || !row.issuedWorkNumber)) {
    errors.push("Есть OtherExpense без ПТ/ВР номера");
  }
  if (expenses.some((row) => (row.paymentAmount != null) !== (row.payoutNumber != null))) {
    errors.push("OtherExpense.payoutNumber не соответствует наличию платёжной части");
  }
  if (snapshotRuns.some((run) => run.runKind === "scheduled" && !run.scheduleKey)) {
    errors.push("Есть плановый SnapshotRun без scheduleKey");
  }

  verifyScope(
    "payout",
    [...payments.map((row) => [row.payoutNumber, row.payoutNumberYear, row.payoutNumberSerial]), ...expenses.filter((row) => row.paymentAmount != null).map((row) => [row.payoutNumber, row.payoutNumberYear, row.payoutNumberSerial])],
    counters,
    /^В\d{2}\.\d{3,}$/,
    errors
  );
  verifyScope(
    "issued-work",
    [...works.map((row) => [row.issuedWorkNumber, row.issuedWorkNumberYear, row.issuedWorkNumberSerial]), ...expenses.map((row) => [row.issuedWorkNumber, row.issuedWorkNumberYear, row.issuedWorkNumberSerial])],
    counters,
    /^ВР\d{2}\.\d{3,}$/,
    errors
  );
  verifyScope(
    "other-expense",
    expenses.map((row) => [row.otherExpenseNumber, row.otherExpenseNumberYear, row.otherExpenseNumberSerial]),
    counters,
    /^ПТ\d{2}\.\d{3,}$/,
    errors
  );

  for (const executor of executors) {
    if (!executor.user) continue;
    if (!executor.contactEmail) {
      errors.push(`contactEmail не заполнен для связанного User: ${executor.id}`);
    }
    const active =
      executor.user.isActive && executor.status === "active" && executor.accessRevokedAt == null;
    if (active && !executor.accessEmail) {
      errors.push(`accessEmail не заполнен для активного доступа: ${executor.id}`);
    }
    if (!active && executor.accessEmail) {
      errors.push(`accessEmail заполнен без активного доступа: ${executor.id}`);
    }
  }
  return { ok: errors.length === 0, errors, snapshotRows: snapshotRuns.length };
}

function verifyScope(scope, values, counters, pattern, errors) {
  const numbers = values.map(([number]) => number).filter(Boolean);
  if (new Set(numbers).size !== numbers.length) errors.push(`Дубли номеров scope=${scope}`);
  if (numbers.some((number) => !pattern.test(number))) errors.push(`Неверный формат scope=${scope}`);
  const maxByYear = new Map();
  for (const [, year, serial] of values) {
    if (year == null || serial == null) continue;
    maxByYear.set(year, Math.max(maxByYear.get(year) ?? 0, serial));
  }
  for (const [year, max] of maxByYear) {
    const counter = counters.find((row) => row.scope === scope && row.year === year);
    if (!counter || counter.lastValue < max) errors.push(`Отстаёт NumberCounter ${scope}/${year}`);
  }
}

async function readCoreCounts() {
  const tables = ["users", "executors", "works", "payments", "other_expenses"];
  const result = {};
  for (const table of tables) result[table] = await rawCount(`SELECT COUNT(*) AS "count" FROM "${table}"`);
  return result;
}

async function rawCount(sql) {
  const rows = await prisma.$queryRawUnsafe(sql);
  return Number(rows[0]?.count ?? rows[0]?.["COUNT(*)"] ?? 0);
}

async function hasColumn(table, column) {
  const target = databaseTarget(getMigrationDatabaseUrl());
  if (target.provider === "postgresql") {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
      table,
      column
    );
    return rows.length > 0;
  }
  const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
  return rows.some((row) => row.name === column);
}

function assertCountsUnchanged(before, after) {
  for (const table of Object.keys(before)) {
    if (before[table] !== after[table]) {
      throw new Error(`Количество строк ${table} изменилось: ${before[table]} → ${after[table]}`);
    }
  }
}

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? Number(value) : value;
}
