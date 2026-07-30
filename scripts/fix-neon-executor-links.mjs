/**
 * Патч NDA/договор/старая смета/specialties в Postgres (Neon/VPS) через pg.
 *
 *   # dry-run (по умолчанию .env.production — у вас это Neon/дев)
 *   node scripts/fix-neon-executor-links.mjs
 *
 *   # запись в Neon (дев)
 *   node scripts/fix-neon-executor-links.mjs --run
 *
 *   # прод на VPS — свой env с DATABASE_URL/DIRECT_URL сервера
 *   node scripts/fix-neon-executor-links.mjs --env=.env.vps --run
 *   # или прямо на сервере (берёт .env рядом с проектом):
 *   ENV_FILE=.env node scripts/fix-neon-executor-links.mjs --run
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import pg from "pg";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const EXCEL_PATH =
  process.env.EXCEL_PATH ?? path.resolve(__dirname, "../../Смета_23.xlsx");

const DRY = !process.argv.includes("--run");
const envArg = process.argv.find((a) => a.startsWith("--env="));
const envFile = path.resolve(
  root,
  process.env.ENV_FILE ?? (envArg ? envArg.slice("--env=".length) : ".env.production")
);
if (!fs.existsSync(envFile)) {
  throw new Error(`Env-файл не найден: ${envFile}`);
}
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^\s*([\w]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) process.env[m[1]] = m[2];
}

const SPECIALTY_SEGMENTS = new Set([
  "IT",
  "Аналитика",
  "Видео",
  "Визуал",
  "Менеджмент",
  "Продвижение",
  "Сервисы",
  "Текст",
  "Транзитные платежи",
  "Экспертиза",
]);

function str(val) {
  if (val == null) return null;
  const s = String(val).trim();
  return s === "" || s === "—" || s === "-" ? null : s;
}

function normKey(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSpecialtySegments(raw) {
  if (raw == null) return [];
  return String(raw)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s && SPECIALTY_SEGMENTS.has(s));
}

function readExecutorsFromExcel() {
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets["БД_Исполнители"];
  if (!ws) throw new Error("Лист БД_Исполнители не найден");

  const raw = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    blankrows: true,
    cellDates: false,
  });

  let headerIdx = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].some((v) => v === "Исполнитель")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("Заголовок Исполнитель не найден");

  const headers = raw[headerIdx].map((h) => (h != null ? String(h).trim() : null));
  const linkFields = new Set(["договор", "NDA", "Старая смета"]);
  const linkCols = new Set(
    headers.map((h, j) => (h && linkFields.has(h) ? j : -1)).filter((j) => j >= 0)
  );

  const out = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.every((v) => v === null || v === "")) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      let value = row[j] ?? null;
      if (linkCols.has(j)) {
        const addr = XLSX.utils.encode_cell({ r: i, c: j });
        const cell = ws[addr];
        const target = cell?.l?.Target ?? cell?.l?.Rel?.Target;
        if (typeof target === "string" && target.trim()) value = target.trim();
      }
      obj[headers[j]] = value;
    }
    const name = str(obj["Исполнитель"]);
    if (!name) continue;
    const specialtyRaw = str(obj["Специальность"]);
    const specialtySegments = parseSpecialtySegments(specialtyRaw);
    out.push({
      name,
      specialty: specialtyRaw,
      specialties: specialtySegments.length ? JSON.stringify(specialtySegments) : null,
      contractFile: str(obj["договор"]),
      ndaFile: str(obj["NDA"]),
      oldEstimateUrl: str(obj["Старая смета"]),
    });
  }
  return out;
}

const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!dbUrl || (!dbUrl.startsWith("postgres://") && !dbUrl.startsWith("postgresql://"))) {
  throw new Error("Нет postgres URL в .env.production");
}

console.log("Excel:", EXCEL_PATH);
console.log("Env:", envFile);
console.log("Mode:", DRY ? "DRY RUN" : "WRITE");
console.log("DB:", dbUrl.replace(/:[^:@]+@/, ":****@").slice(0, 90));

const fromExcel = readExecutorsFromExcel();
console.log("Excel executors:", fromExcel.length);
console.log(
  "with NDA http:",
  fromExcel.filter((e) => e.ndaFile?.startsWith("http")).length,
  "with specialties:",
  fromExcel.filter((e) => e.specialties).length
);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  const { rows: existing } = await client.query(
    `select id, name, "contractFile", "ndaFile", "oldEstimateUrl", specialty, specialties from executors`
  );
  console.log("Neon executors:", existing.length);
  const byName = new Map(existing.map((e) => [normKey(e.name), e]));

  let updated = 0;
  let skipped = 0;
  let missing = 0;
  const samples = [];

  for (const e of fromExcel) {
    if (!e.contractFile && !e.ndaFile && !e.oldEstimateUrl && !e.specialty && !e.specialties) {
      continue;
    }
    const row = byName.get(normKey(e.name));
    if (!row) {
      missing++;
      continue;
    }
    const data = {};
    if (e.contractFile && e.contractFile !== row.contractFile) data.contractFile = e.contractFile;
    if (e.ndaFile && e.ndaFile !== row.ndaFile) data.ndaFile = e.ndaFile;
    if (e.oldEstimateUrl && e.oldEstimateUrl !== row.oldEstimateUrl) {
      data.oldEstimateUrl = e.oldEstimateUrl;
    }
    if (e.specialty && e.specialty !== row.specialty) data.specialty = e.specialty;
    if (e.specialties && e.specialties !== row.specialties) data.specialties = e.specialties;
    if (!Object.keys(data).length) {
      skipped++;
      continue;
    }

    if (samples.length < 5) {
      samples.push({
        name: e.name,
        before: {
          ndaFile: row.ndaFile,
          specialties: row.specialties,
          specialty: row.specialty,
        },
        after: data,
      });
    }

    if (!DRY) {
      const sets = [];
      const vals = [];
      let i = 1;
      for (const [k, v] of Object.entries(data)) {
        sets.push(`"${k}" = $${i++}`);
        vals.push(v);
      }
      vals.push(row.id);
      await client.query(`update executors set ${sets.join(", ")} where id = $${i}`, vals);
    }
    updated++;
  }

  console.log("samples:", JSON.stringify(samples, null, 2));
  console.log(
    DRY
      ? `\nDRY: would update ${updated}, skip ${skipped}, missing ${missing}`
      : `\nDONE: updated ${updated}, skip ${skipped}, missing ${missing}`
  );

  if (!DRY) {
    const andreeva = await client.query(
      `select name, specialty, specialties, "ndaFile" from executors where name like '%Андреева%'`
    );
    console.log("andreeva after:", andreeva.rows);
    const stats = await client.query(`
      select
        count(*) filter (where "ndaFile" like 'http%') as http_nda,
        count(*) filter (where "ndaFile" ilike '%.pdf' and "ndaFile" not like 'http%') as pdf_nda,
        count(*) filter (where specialties is not null and specialties <> '[]') as with_spec_json
      from executors
    `);
    console.log("stats:", stats.rows[0]);
  }
} finally {
  await client.end();
}
