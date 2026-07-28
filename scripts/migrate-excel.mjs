/**
 * migrate-excel.mjs
 *
 * РЕЖИМЫ:
 *   node scripts/migrate-excel.mjs                   → подробный preview (DRY RUN)
 *   node scripts/migrate-excel.mjs --run             → реальная запись в БД (дроп + вставка)
 *   node scripts/migrate-excel.mjs --run --production → читать .env.production, писать в прод БД
 *   node scripts/migrate-excel.mjs --preview-rows=20 → больше строк в таблицах
 */

import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── PROVIDER SWITCH ─────────────────────────────────────────────────────────

function switchSchemaProvider(provider, { generate = true } = {}) {
  const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
  let schema = fs.readFileSync(schemaPath, "utf8");
  const updated = schema.replace(
    /(datasource db \{[\s\S]*?provider\s*=\s*)"(sqlite|postgresql)"/,
    `$1"${provider}"`
  );
  if (updated !== schema) {
    fs.writeFileSync(schemaPath, updated);
    if (generate) {
      console.log(`  [prisma] provider переключён → ${provider}, генерирую клиент...`);
      execSync("npx prisma generate", {
        cwd: path.resolve(__dirname, ".."),
        stdio: "inherit",
      });
    } else {
      console.log(`  [prisma] provider восстановлен → ${provider} (без regenerate)`);
    }
  }
}

async function createPrismaClient() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const isPostgres = dbUrl.startsWith("postgresql://") || dbUrl.startsWith("postgres://");

  if (isPostgres) {
    const { PrismaClient } = await import("@prisma/client");
    const { Pool, neonConfig } = await import("@neondatabase/serverless").catch(() => null) ?? {};
    if (Pool && neonConfig) {
      const { PrismaNeon } = await import("@prisma/adapter-neon");
      const ws = await import("ws");
      neonConfig.webSocketConstructor = ws.default;
      const directUrl = process.env.DIRECT_URL ?? dbUrl;
      const pool = new Pool({ connectionString: directUrl });
      const adapter = new PrismaNeon(pool);
      return new PrismaClient({ adapter });
    }
    return new PrismaClient();
  }

  const { PrismaClient } = await import("@prisma/client");
  return new PrismaClient();
}

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const EXCEL_PATH =
  process.env.EXCEL_PATH ??
  path.resolve(__dirname, "../../Смета_23.xlsx");

// Папка с файлами личных смет (все *.xlsx в папке считаются LS файлами).
// По умолчанию — подпапка personal-sheets рядом с EXCEL_PATH.
const LS_FOLDER =
  process.env.LS_FOLDER ??
  path.join(path.dirname(EXCEL_PATH), "personal-sheets");

/** Лист LS для синка (архив не участвует). */
const LS_SHEET = "Текущий год";
const LS_TASKS_SHEET = "Задачи";

const TASK_STATUS_MAP = {
  поставлена: "pending",
  "в работе": "in_progress",
  "на паузе": "paused",
  "на проверке": "review",
  выполнена: "done",
  выполнено: "done",
};

const DRY_RUN    = !process.argv.includes("--run");
const PRODUCTION = process.argv.includes("--production");

// Загружаем .env.production или .env в process.env
(function loadEnv() {
  const root = path.resolve(__dirname, "..");
  const envFile = PRODUCTION
    ? (fs.existsSync(path.join(root, ".env.production"))
        ? path.join(root, ".env.production")
        : path.join(root, ".env"))
    : path.join(root, ".env");

  if (!fs.existsSync(envFile)) return;
  const raw = fs.readFileSync(envFile, "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([\w]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
  console.log(`  .env: ${path.basename(envFile)}`);
})();

const PREVIEW_ROWS = (() => {
  const arg = process.argv.find((a) => a.startsWith("--preview-rows="));
  return arg ? parseInt(arg.split("=")[1]) : 5;
})();

// ─── STATUS MAPS ─────────────────────────────────────────────────────────────

const EXECUTOR_TYPE_MAP = {
  "Постоянный": "permanent",
  "Внешний": "external",
  "Сервисы": "service",
  "Банк": "bank",
};

const STATUS_RU = {
  "Активный": "active",
  "Архивный": "archived",
};

const PROJECT_TYPE_MAP = {
  "Клиентский": "client",
  "Внутренний": "internal",
};

const WORK_STATUS_MAP = {
  "Выставлено": "submitted",
  "Проверено": "checked",
  "Оплачено": "paid",
  "Переработка": "rework",
};

const CHARGE_STATUS_MAP = {
  "В плане": "planned",
  "К оплате": "to_pay",
  "Оплачено": "paid",
  "Просрочено": "to_pay", // просрочка вычисляется по датам, отдельного статуса нет
};

const PAYMENT_STATUS_MAP = {
  "Запланировано": "planned",
  "Отправлено": "paid",
  "Оплачено": "paid",
};

const MONTH_MAP = {
  "01-Январь": 1,  "02-Февраль": 2,  "03-Март": 3,     "04-Апрель": 4,
  "05-Май": 5,     "06-Июнь": 6,     "07-Июль": 7,     "08-Август": 8,
  "09-Сентябрь": 9,"10-Октябрь": 10, "11-Ноябрь": 11,  "11-Нобярь": 11,
  "12-Декабрь": 12,
};

// ─── TABLE FORMATTER ─────────────────────────────────────────────────────────

function pad(str, len) {
  const s = String(str ?? "");
  if (s.length >= len) return s.slice(0, len - 1) + "…";
  return s.padEnd(len);
}

function printTable(rows, cols, { title = "", total = null, warnings = [] } = {}) {
  const widths = cols.map((c) => {
    const maxData = rows.reduce(
      (m, r) => Math.max(m, String(r[c.key] ?? "").length),
      c.label.length
    );
    return Math.min(Math.max(maxData, c.min ?? 4), c.max ?? 28);
  });

  const hBorder = "─" + widths.map((w) => "─".repeat(w + 2)).join("─┬─") + "─";
  const mBorder = "─" + widths.map((w) => "─".repeat(w + 2)).join("─┼─") + "─";
  const bBorder = "─" + widths.map((w) => "─".repeat(w + 2)).join("─┴─") + "─";

  const headerLine = " " + cols.map((c, i) => pad(c.label, widths[i])).join(" │ ") + " ";

  if (title) {
    const totalStr = total !== null ? `  (всего: ${total})` : "";
    console.log(`\n  ┌─ ${title}${totalStr}`);
  }
  console.log("  ┌" + hBorder + "┐");
  console.log("  │" + headerLine + "│");
  console.log("  ├" + mBorder + "┤");

  if (rows.length === 0) {
    const w = widths.reduce((s, w) => s + w + 3, 0) - 1;
    console.log("  │  (нет данных)" + " ".repeat(Math.max(0, w - 14)) + "│");
  } else {
    for (const row of rows) {
      const line =
        " " +
        cols.map((c, i) => {
          const val = row[c.key];
          let d;
          if (val === null || val === undefined) d = "—";
          else if (val instanceof Date) d = isNaN(val.getTime()) ? "—" : val.toLocaleDateString("ru-RU");
          else if (typeof val === "boolean") d = val ? "✓" : "✗";
          else d = String(val);
          return pad(d, widths[i]);
        }).join(" │ ") +
        " ";
      console.log("  │" + line + "│");
    }
  }
  console.log("  └" + bBorder + "┘");

  if (total !== null && total > rows.length)
    console.log(`     ⋯ ещё ${total - rows.length} строк скрыто (используй --preview-rows=N)`);

  for (const w of warnings)
    console.log(`  ⚠️  ${w}`);
}

function section(title) {
  const line = "═".repeat(62);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

// ─── EXCEL READER ─────────────────────────────────────────────────────────────
//
// Определяет строку заголовков по ключевой колонке (identifyBy).
// dataOffset: сколько строк пропустить ПОСЛЕ заголовка до данных (обычно 1,
//   для БД_Выставленные_работы = 2 — там строка аннотаций между заголовком и данными).
//
function readSheet(wb, sheetName, { identifyBy, dataOffset = 1 }) {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Лист "${sheetName}" не найден в файле`);

  const raw = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    blankrows: true,   // сохраняем индексы строк как в Excel
    cellDates: false,  // читаем даты как числа (серийные номера Excel) → parseDate конвертирует в UTC
  });

  // Ищем строку, в которой ТОЧНО есть identifyBy как значение ячейки
  let headerIdx = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].some((v) => v === identifyBy)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1)
    throw new Error(`Колонка "${identifyBy}" не найдена в листе "${sheetName}"`);

  const headers = raw[headerIdx].map((h) => (h != null ? String(h).trim() : null));
  const dataStartIdx = headerIdx + dataOffset;

  const rows = [];
  for (let i = dataStartIdx; i < raw.length; i++) {
    const row = raw[i];
    // Пропускаем полностью пустые строки
    if (!row || row.every((v) => v === null || v === "")) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) obj[headers[j]] = row[j] ?? null;
    }
    rows.push(obj);
  }
  return rows;
}

// ─── VALUE HELPERS ────────────────────────────────────────────────────────────

function mapV(val, map, fallback = null) {
  if (val == null) return fallback;
  return map[String(val).trim()] ?? fallback;
}

function str(val) {
  if (val == null) return null;
  const s = String(val).trim();
  return s === "" || s === "—" || s === "-" ? null : s;
}

function num(val) {
  if (val == null) return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}

function parseMonth(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (MONTH_MAP[s]) return MONTH_MAP[s];
  const n = parseInt(s);
  return isNaN(n) || n < 1 || n > 12 ? null : n;
}

function parseYear(val) {
  const n = parseInt(String(val ?? ""));
  return isNaN(n) || n < 2000 || n > 2100 ? null : n;
}

/** ISO-год для даты (неделя с понедельника; дата в янв может принадлежать прошлому году и наоборот) */
function isoWeekYear(date) {
  if (!date) return null;
  const d = new Date(date);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  return d.getFullYear();
}

/** Количество ISO-недель в году (52 или 53). Использует Dec 28 — всегда в последней неделе. */
function lastISOWeekOfYear(year) {
  const dec28 = new Date(Date.UTC(year, 11, 28));
  const day = dec28.getUTCDay() || 7;
  const thu = new Date(dec28);
  thu.setUTCDate(dec28.getUTCDate() + 4 - day);
  const jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  return Math.ceil((((thu - jan1) / 86400000) + 1) / 7);
}

/**
 * Вычисляет {year, week} для строки SpendingPlanLine по дате и exec-периоду.
 * Правило:
 *   – Если дата есть: year = getFullYear(d). Если дата в декабре и ISO-неделя = 1 →
 *     work clamp: week = lastISOWeekOfYear(year).
 *   – Если даты нет: year из executionYear, но если execution = декабрь и week <= 4 →
 *     payment скорее всего в следующем году.
 */
function planLineWeekYear(d, rawWeek, executionYear, executionMonth) {
  let year, week;
  if (d) {
    year = d.getFullYear();
    week = rawWeek;
    // 31.12 → ISO неделя 1 следующего года; кладём в последнюю неделю этого года
    if (week === 1 && d.getUTCMonth() === 11) {
      week = lastISOWeekOfYear(year);
    }
  } else {
    // Нет даты — определяем год по месяцу выполнения + неделе
    year = executionYear;
    week = rawWeek;
    // Декабрьская работа + ранняя неделя оплаты → выплата в следующем году
    if (executionMonth === 12 && week <= 4) {
      year = executionYear + 1;
    }
  }
  return { year, week };
}

/** Нормализует дату в строку YYYY-MM-DD по московскому времени (UTC+3),
 *  чтобы избежать ±1 день из-за timezone при сравнении ключей выплат. */
function toMoscowDateKey(date) {
  if (!date) return null;
  const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
  return new Date(date.getTime() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

function parseDate(val) {
  if (val == null) return null;
  // Числовой серийный номер Excel → UTC полночь (без сдвига часового пояса)
  if (typeof val === "number" && val > 1) {
    // Excel epoch: 25569 дней от 01.01.1900 до 01.01.1970 (с учётом бага 1900 года)
    const ms = Math.round((val - 25569) * 86400) * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    // Нормализуем до UTC полночи по локальным компонентам даты
    return new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate()));
  }
  if (typeof val === "string" && val.trim() !== "") {
    // Поддержка формата ДД.ММ.ГГГГ (из Google Sheets / некоторых Excel ячеек)
    const m = val.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) {
      return new Date(Date.UTC(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])));
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function splitItems(val) {
  if (!val) return [];
  return String(val).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

// Нормализация имени для lookup-сравнения: trim + lowercase + схлопываем пробелы
function normKey(s) {
  if (!s) return "";
  return String(s).trim().toLowerCase().replace(/\s+/g, " ");
}

function normEmail(email) {
  return String(email).trim().toLowerCase();
}

// Транслитерация для email
function translit(s) {
  const t = { А:"a",Б:"b",В:"v",Г:"g",Д:"d",Е:"e",Ё:"yo",Ж:"zh",З:"z",И:"i",
               Й:"y",К:"k",Л:"l",М:"m",Н:"n",О:"o",П:"p",Р:"r",С:"s",Т:"t",
               У:"u",Ф:"f",Х:"kh",Ц:"ts",Ч:"ch",Ш:"sh",Щ:"sch",Ъ:"",Ы:"y",
               Ь:"",Э:"e",Ю:"yu",Я:"ya" };
  return s.split("").map((c) => t[c.toUpperCase()] ?? c.toLowerCase())
          .join("").replace(/[^a-z0-9.]/g, "");
}

function makeEmail(fullName, idx) {
  const [last, first] = fullName.trim().split(/\s+/);
  const base = first
    ? `${translit(last)}.${translit(first)}`
    : `${translit(last)}`;
  return `${base}.${idx}@noemail.local`;
}

function generatePassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// Составное имя клиента: "Департамент – Компания" (как TEXTJOIN в Excel)
function buildClientName(company, department) {
  return department ? `${department} – ${company}` : company;
}

// Составное имя проекта: "Название – Клиент" (как вычисляется в Prisma)
function buildProjectName(shortName, clientName) {
  return shortName && clientName ? `${shortName} – ${clientName}` : shortName ?? clientName ?? "";
}

// ─── EXTRACTORS ───────────────────────────────────────────────────────────────

/** Руководители проектов из БД_Ответственные (имя + список проектов). */
function extractResponsibles(wb) {
  const rows = readSheet(wb, "БД_Ответственные", { identifyBy: "Имя" });
  return rows
    .filter((r) => str(r["Имя"]))
    .map((r) => {
      const projectNames = splitItems(r["Проекты как руководитель"]);
      return {
        fullName: str(r["Имя"]),
        isActive: str(r["Статус"]) === "Активный",
        projectNames,
      };
    })
    .filter((r) => r.projectNames.length > 0);
}

function extractUsers(wb, { skipNames = new Set() } = {}) {
  const rows = readSheet(wb, "БД_Ответственные", { identifyBy: "Имя" });
  return rows
    .filter((r) => str(r["Имя"]))
    .filter((r) => splitItems(r["Проекты как руководитель"]).length > 0)
    .filter((r) => !skipNames.has(normKey(str(r["Имя"]))))
    .map((r, idx) => ({
      fullName: str(r["Имя"]),
      email: makeEmail(str(r["Имя"]), idx),
      password: "$2b$10$placeholder_needs_manual_reset",
      role: "responsible",
      isActive: str(r["Статус"]) === "Активный",
    }));
}

function extractBankAccounts(wb) {
  const rows = readSheet(wb, "БД_Банковские счета", { identifyBy: "Счёт" });
  return rows
    .filter((r) => str(r["Счёт"]))
    .map((r) => ({
      name: str(r["Счёт"]),
      status: mapV(str(r["Статус"]), STATUS_RU, "active"),
    }));
}

function extractProjects(wb, userMap, clientMap, knownExecutorNames = new Set()) {
  const rows = readSheet(wb, "БД_Проекты", { identifyBy: "Проект" });
  const projects = [];
  const warnings = [];

  for (const r of rows) {
    const shortName = str(r["Название проекта"]);
    const clientLookup = str(r["Клиент"]); // уже вычисленное имя клиента из Excel
    if (!shortName) continue;

    // Ищем клиента в нашей clientMap — он уже вычислен через buildClientName
    const clientId = clientLookup ? (clientMap[normKey(clientLookup)] ?? null) : null;
    if (clientLookup && !clientId)
      warnings.push(`Проект "${shortName}": клиент "${clientLookup}" не найден`);

    // Составляем имя как делается в системе: "shortName – clientName"
    const name = buildProjectName(shortName, clientLookup);

    const responsibleName = str(r["Руководитель проекта"]);
    const responsibleUserId = responsibleName ? (userMap[normKey(responsibleName)] ?? null) : null;
    // Не предупреждаем если руководитель — исполнитель с email (ссылка фиксируется в шаге [6/14])
    if (responsibleName && !responsibleUserId && !knownExecutorNames.has(normKey(responsibleName)))
      warnings.push(`Проект "${name}": руководитель "${responsibleName}" не найден`);

    projects.push({
      name,          // computed: "Название – Клиент"
      shortName,
      type: mapV(str(r["Тип проекта"]), PROJECT_TYPE_MAP, "internal"),
      status: mapV(str(r["Статус"]), STATUS_RU, "active"),
      responsibleUserId,
      clientId,
      _clientName: clientLookup,
      _responsibleName: responsibleName,
    });
  }
  return { projects, warnings };
}

function extractWorkTypes(wb) {
  const rows = readSheet(wb, "БД_Виды_работ", { identifyBy: "Вид работ" });
  return rows
    .filter((r) => str(r["Вид работ"]))
    .map((r) => ({
      name: str(r["Вид работ"]),
      segment: str(r["Сегмент"]) ?? "Без категории",
      status: mapV(str(r["Статус"]), STATUS_RU, "active"),
    }));
}

function extractClients(wb) {
  const rows = readSheet(wb, "БД_Клиенты", { identifyBy: "Клиент" });
  return rows
    .filter((r) => str(r["Компания"]))
    .map((r) => {
      const company = str(r["Компания"]);
      const department = str(r["Департамент"]);
      return {
        name: buildClientName(company, department),
        company,
        department: department ?? "",
        status: "active",
        _rawStatusProjects: str(r["Статус проектов"]),
        _revenue: num(r["Выручка"]),
      };
    });
}

/** Переводит русское значение «Статус в компании» в английский ключ для БД */
function mapCompanyStatus(raw) {
  if (!raw) return null;
  const parts = raw.split(/[,/]/).map((s) => s.trim().toLowerCase());
  const mapped = [];
  for (const p of parts) {
    if (p.includes("ядро") || p === "core")  mapped.push("core");
    else if (p.includes("орбита") || p === "orbit") mapped.push("orbit");
  }
  if (!mapped.length) return null;
  return [...new Set(mapped)].join(","); // "core" | "orbit" | "core,orbit"
}

function extractExecutors(wb, userMap, bankMap, workTypeMap) {
  const rows = readSheet(wb, "БД_Исполнители", { identifyBy: "Исполнитель" });
  const executors = [];
  const executorWorkTypes = [];
  const projectExecutors = [];
  const warnings = [];

  for (const r of rows) {
    const name = str(r["Исполнитель"]);
    if (!name) continue;

    // Источник оплаты — мультиселект "Счёт Проектный, ОПЕРАЦИОННЫЙ СЧЕТ" → берём первый
    const bankRaw = str(r["Источник оплаты"]);
    const bankName = bankRaw ? bankRaw.split(/[,\n]/)[0].trim() : null;
    if (bankName && !bankMap[normKey(bankName)])
      warnings.push(`Исполнитель "${name}": счёт "${bankName}" не найден`);

    const respName = str(r["Ответственный"]);

    const workTypeNames = splitItems(r["Виды работ"]);
    for (const wt of workTypeNames) {
      if (!workTypeMap[normKey(wt)])
        warnings.push(`Исполнитель "${name}": вид работ "${wt}" не найден`);
      executorWorkTypes.push({ executorName: name, workTypeName: wt });
    }

    const projectNames = splitItems(r["Проекты"]);
    for (const p of projectNames)
      projectExecutors.push({ executorName: name, projectName: p });

    const accessField = str(r["Доступ к смете"]);
    const legacyEmail = str(r["email"]) || str(r["Email"]) || null;
    const contactEmail = str(r["Контакт email"]) || legacyEmail;
    const accessEmail =
      str(r["Email для доступа"]) || (accessField === "закрыт" ? null : legacyEmail);

    executors.push({
      name,
      companyStatus: mapCompanyStatus(str(r["Статус в компании"])),
      type: mapV(str(r["Тип"]), EXECUTOR_TYPE_MAP, "external"),
      recipientType: str(r["Тип получателя"]),
      specialty: str(r["Специальность"]),
      contractFile: str(r["договор"]),
      ndaFile: str(r["NDA"]),
      inTgChat: str(r["В чате ТГ"])?.toLowerCase() === "да",
      contacts: str(r["Контакт общее"]) || str(r["Контакт"]),
      contactEmail,
      accessEmail,
      requisites: str(r["Реквизиты"]),
      note: str(r["Примечание"]),
      status: mapV(str(r["Статус исполнителя"]), STATUS_RU, "active"),
      accessRevokedAt: accessField === "закрыт" ? new Date("2024-01-01") : null,
      oldEstimateUrl: str(r["Старая смета"]),
      _email: accessEmail,
      _bankName: bankName,
      _responsibleName: respName,
      _workTypeNames: workTypeNames,
      _projectNames: projectNames,
    });
  }
  return { executors, executorWorkTypes, projectExecutors, warnings };
}

function extractOrders(wb, projectMap) {
  const rows = readSheet(wb, "БД_Заказы", { identifyBy: "Номер заказа" });
  const orders = [];
  const warnings = [];

  for (const r of rows) {
    const raw = str(r["Номер заказа"]);
    if (!raw || !raw.startsWith("З")) continue;

    const projectName  = str(r["Проект"]);
    const projectId = projectName ? (projectMap[normKey(projectName)] ?? null) : null;
    if (projectName && !projectId)
      warnings.push(`Заказ ${raw}: проект "${projectName}" не найден`);

    orders.push({
      orderNumber: raw,        // сохраняем "З001" как есть
      description: str(r["Описание заказа"]) || null,
      contractNumber: str(r["Номер договора/допсоглашения"]),
      status: mapV(str(r["Статус"]), STATUS_RU, "active"),
      projectId,
      _rawNumber: raw,
      _projectName: projectName,
    });
  }
  return { orders, warnings };
}

function extractCharges(wb, bankMap, orderMap) {
  const rows = readSheet(wb, "БД_Начисления", { identifyBy: "Банковский счет" });
  const charges = [];
  const warnings = [];

  // Предварительный подсчёт: одинаковый invoiceNumber у нескольких начислений → null (один счёт, несколько строк)
  const invCount = {};
  for (const r of rows) {
    const rawInv = r["№ счета"];
    if (rawInv != null && rawInv !== "") {
      const key = typeof rawInv === "number" ? String(Math.round(rawInv)) : String(rawInv).trim();
      if (key) invCount[key] = (invCount[key] ?? 0) + 1;
    }
  }

  const seenCharge = new Set();
  const seenInvoice = new Set();

  for (const r of rows) {
    const chargeNumber = str(r["Номер Начисления"]);
    if (!chargeNumber) continue;
    if (seenCharge.has(chargeNumber)) {
      warnings.push(`Дубль chargeNumber "${chargeNumber}" — пропущен`);
      continue;
    }

    // invoiceNumber: пусто → null, дубль (один счёт на несколько позиций) → null
    const rawInv = r["№ счета"];
    const rawKey =
      rawInv == null || rawInv === ""
        ? null
        : typeof rawInv === "number"
        ? String(Math.round(rawInv))
        : String(rawInv).trim() || null;
    const invoiceNumber = rawKey && invCount[rawKey] === 1 ? rawKey : null;

    const bankName = str(r["Банковский счет"]);
    if (bankName && !bankMap[normKey(bankName)])
      warnings.push(`Начисление ${chargeNumber}: счёт "${bankName}" не найден`);

    const orderRef = str(r["Номер Заказа"]);
    const orderId = orderRef ? (orderMap[orderRef] ?? null) : null;
    if (orderRef && !orderId)
      warnings.push(`Начисление ${chargeNumber}: заказ "${orderRef}" не найден`);

    const rawStatus = str(r["Статус"]);
    if (invoiceNumber && seenInvoice.has(invoiceNumber)) {
      warnings.push(`Начисление ${chargeNumber}: дубль invoiceNumber "${invoiceNumber}" — пропущен`);
      continue;
    }
    seenCharge.add(chargeNumber);
    if (invoiceNumber) seenInvoice.add(invoiceNumber);

    charges.push({
      chargeNumber,
      invoiceNumber,
      amount: num(r["Сумма"]) ?? 0,
      issuedPlanAt: parseDate(r["Выставлен - план"]),
      issuedAt: parseDate(r["Выставлен - факт"]),
      paidPlanAt: parseDate(r["Оплачен – план"]),
      paidAt: parseDate(r["Оплачен – факт"]),
      paymentPurpose: str(r["Назначение платежа"]),
      status: mapV(rawStatus, CHARGE_STATUS_MAP, "planned"),
      documents: str(r["Документы"]),
      bankAccountId: bankMap[normKey(bankName)] ?? null,
      orderId,
      _bankName: bankName,
      _orderRef: orderRef,
      _rawStatus: rawStatus,
    });
  }
  return { charges, warnings };
}

function extractSpendingPlan(wb, projectMap, executorMap, workTypeMap) {
  const rows = readSheet(wb, "БД_План_расходов_полный", { identifyBy: "Год оплаты - план" });
  const lines = [];
  const warnings = [];

  for (const r of rows) {
    const yearRaw     = r["Год оплаты - план"];
    const weekRaw     = str(r["Неделя оплаты - план"]);
    const projectName = str(r["Проект"]);
    const amount      = num(r["Сумма"]) ?? 0;
    const workTypeName = str(r["Вид работ"]);
    const executorName = str(r["Исполнитель"]);

    if (!yearRaw || !projectName || !amount) continue;

    let year = parseInt(String(yearRaw));
    const week = weekRaw ? parseInt(weekRaw.replace(/\D/g, "")) : 0;
    if (!year || !week) continue;
    // Коррекция: неделя не может быть больше последней недели года (напр. нед.53 в 2027,
    // хотя 2027 имеет только 52 недели — значит имеется в виду 2026).
    if (week > lastISOWeekOfYear(year)) year -= 1;

    // Лист читается только для справки в preview — в БД не записывается
    // Недели ≤ 25 берутся из работ, поэтому предупреждения для них не нужны
    if (week > 25) {
      if (!projectMap[normKey(projectName)])
        warnings.push(`План расходов: проект "${projectName}" не найден`);
      if (workTypeName && normKey(workTypeName) !== "пока не известен" && !workTypeMap[normKey(workTypeName)])
        warnings.push(`План расходов: вид работ "${workTypeName}" не найден`);
      if (executorName && normKey(executorName) !== "пока не известен" && !executorMap[normKey(executorName)])
        warnings.push(`План расходов: исполнитель "${executorName}" не найден`);
    }

    lines.push({
      year,
      week,
      amount,
      _projectName:  projectName,
      _workTypeName: workTypeName,
      _executorName: executorName,
    });
  }
  return { lines, warnings };
}

/**
 * Ключ периода выполнения (год-месяц) из строки LS.
 */
function lsExecutionPeriodKey(r, hdrRow) {
  const yrCol = hdrRow.findIndex((h) => String(h || "").startsWith("Год выполнения"));
  const moCol = hdrRow.findIndex((h) => String(h || "").startsWith("Месяц выполнения"));
  const yr = yrCol >= 0 ? parseYear(r[yrCol]) : null;
  const mo = moCol >= 0 ? parseMonth(r[moCol]) : null;
  if (yr == null || mo == null) return null;
  return `${yr}-${String(mo).padStart(2, "0")}`;
}

function lsSerialDateMatch(a, b) {
  return a != null && b != null && Math.abs(Number(a) - Number(b)) <= 0;
}

function lsAmountsClose(a, b, tol = 1) {
  return a != null && b != null && Math.abs(Number(a) - Number(b)) <= tol;
}

/** Год из ключа «YYYY-MM». */
function lsExecutionYear(monthKey) {
  if (!monthKey) return null;
  const yr = monthKey.slice(0, 4);
  return /^\d{4}$/.test(yr) ? yr : null;
}

/**
 * Каскад линковки LS: year-batch → month-sum → paid → plan → single.
 * year-batch — cross-month в одном году (Браун); month/paid — частичные выплаты (Шошин, Дьяков).
 */
function lsLinkWorksToPayment(pending, payMonthKey, payAmount, payPaid, payPlanned) {
  if (!pending.length || payAmount == null || payAmount <= 0) return [];

  const payYear = lsExecutionYear(payMonthKey);
  const pool = payMonthKey != null
    ? pending.filter((w) => w.monthKey === payMonthKey)
    : [];
  const yearBatch = payYear != null
    ? pending.filter((w) => lsExecutionYear(w.monthKey) === payYear)
    : [];

  const yearSum = yearBatch.reduce((s, w) => s + (w.amount ?? 0), 0);
  const poolSum = pool.reduce((s, w) => s + (w.amount ?? 0), 0);

  if (yearBatch.length && lsAmountsClose(yearSum, payAmount)) return yearBatch;
  if (pool.length && lsAmountsClose(poolSum, payAmount)) return pool;

  const byPaid = pool.filter((w) => lsSerialDateMatch(w.paidSerial, payPaid));
  const byPlan = pool.filter((w) => lsSerialDateMatch(w.plannedSerial, payPlanned));
  if (byPaid.length) return byPaid;
  if (byPlan.length) return byPlan;
  if (pool.length === 1) return pool;
  return [];
}

/** «Штанько (Слободина) Евгения Личная смета_.xlsx» → «Штанько Евгения» */
function executorNameFromLsFile(filename) {
  return String(filename)
    .replace(/\.xlsx$/i, "")
    .replace(/ Личная смета_.*$/i, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapTaskStatus(raw) {
  const k = String(raw ?? "")
    .trim()
    .toLowerCase();
  return TASK_STATUS_MAP[k] ?? "pending";
}

function excelSerialToDate(serial) {
  if (serial == null) return null;
  if (serial instanceof Date) return serial;
  if (typeof serial === "number") {
    return new Date(Math.round((serial - 25569) * 86400 * 1000));
  }
  const s = String(serial).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Задачи исполнителей из листа «Задачи» LS-файлов.
 * @returns {Map<string, Array<{title:string,status:string,plannedDoneAt:Date|null,result:string|null,comment:string|null}>>}
 */
function buildTasksFromLS(lsFolder) {
  const byExecutor = new Map();
  let files = [];
  try {
    files = fs.readdirSync(lsFolder).filter((f) => f.toLowerCase().endsWith(".xlsx"));
  } catch {
    return byExecutor;
  }

  for (const f of files) {
    const execName = executorNameFromLsFile(f);
    if (!execName) continue;
    const key = normKey(execName);
    try {
      const wb = XLSX.readFile(path.join(lsFolder, f));
      if (!wb.SheetNames.includes(LS_TASKS_SHEET)) continue;
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[LS_TASKS_SHEET], { header: 1, defval: null });
      const tasks = [];
      for (const r of rows.slice(1)) {
        const title = r[0] != null ? String(r[0]).trim() : "";
        if (!title) continue;
        tasks.push({
          title,
          status: mapTaskStatus(r[1]),
          plannedDoneAt: excelSerialToDate(r[2]),
          result: r[3] != null ? String(r[3]).trim() || null : null,
          comment: r[4] != null ? String(r[4]).trim() || null : null,
        });
      }
      if (tasks.length) byExecutor.set(key, tasks);
    } catch (e) {
      console.warn(`  ⚠ LS задачи: пропуск ${f}: ${e.message}`);
    }
  }
  return byExecutor;
}

/**
 * Читает файлы личных смет из lsFolder (лист «Текущий год»)
 * и строит карту привязки work_srcUid → payment_srcUid (year → month → paid/plan).
 * Тип строки: «ls» = работа, «pay» = выплата. Выплаты с суммой 0 пропускаются.
 */
function buildWorkPaymentMap(lsFolder) {
  /** @type {Map<string,string>} work_uid → payment_uid */
  const map = new Map();
  /** @type {Map<string,{techTask:string|null,volume:number|null,rate:number|null}>} work_uid → meta */
  const workMeta = new Map();
  let files = [];
  try {
    files = fs.readdirSync(lsFolder)
      .filter((f) => f.toLowerCase().endsWith(".xlsx"))
      .map((f) => path.join(lsFolder, f));
  } catch {
    return { map, workMeta };
  }

  for (const filePath of files) {
    try {
      const lsWb = XLSX.readFile(filePath);
      if (!lsWb.SheetNames.includes(LS_SHEET)) continue;
      {
        const ws = lsWb.Sheets[LS_SHEET];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

        // Ищем строку заголовка с __SRC_UID
        let uidCol = -1;
        let headerIdx = -1;
        for (let i = 0; i < Math.min(10, rows.length); i++) {
          const idx = rows[i]?.indexOf("__SRC_UID");
          if (idx !== undefined && idx >= 0) { uidCol = idx; headerIdx = i; break; }
        }
        if (uidCol < 0) continue;

        const hdrRow = rows[headerIdx];
        const paidAtCol    = hdrRow ? hdrRow.indexOf("Дата оплаты")       : -1;
        const plannedAtCol = hdrRow ? hdrRow.indexOf("Дата оплаты план") : -1;
        const payAmtCol    = hdrRow ? hdrRow.indexOf("Выплата")           : -1;
        const workAmtCol   = hdrRow ? hdrRow.findIndex((h) => String(h || "").startsWith("Сумма к выплате")) : -1;
        const techTaskCol = hdrRow ? hdrRow.indexOf("Техническое задание*") : -1;
        const reportCol   = hdrRow ? hdrRow.indexOf("Отчёт")               : -1;
        const volumeCol   = hdrRow ? hdrRow.indexOf("Объём работ")          : -1;
        const rateCol     = hdrRow ? hdrRow.indexOf("Ставка")               : -1;

        // pending: работы с прошлой выплаты; каскад year-batch → month pool → paid/plan.
        const pending = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r[uidCol]) continue;
          const uid = String(r[uidCol]);
          if (uid.startsWith("ls|")) {
            pending.push({
              uid,
              monthKey: lsExecutionPeriodKey(r, hdrRow),
              paidSerial:    paidAtCol    >= 0 ? (r[paidAtCol]    ?? null) : null,
              plannedSerial: plannedAtCol >= 0 ? (r[plannedAtCol] ?? null) : null,
              amount: workAmtCol >= 0 ? num(r[workAmtCol]) : null,
            });
            // Собираем ТЗ, отчёт, объём, ставку из LS файла
            const techTask = techTaskCol >= 0 ? (r[techTaskCol] != null ? String(r[techTaskCol]) : null) : null;
            const report   = reportCol   >= 0 ? (r[reportCol]   != null ? String(r[reportCol])   : null) : null;
            const volume   = volumeCol >= 0 ? (r[volumeCol] != null ? Number(r[volumeCol]) : null) : null;
            const rate     = rateCol   >= 0 ? (r[rateCol]   != null ? Number(r[rateCol])   : null) : null;
            if (techTask || report || volume != null || rate != null) {
              workMeta.set(uid, { techTask, report, volume: isNaN(volume) ? null : volume, rate: isNaN(rate) ? null : rate });
            }
          } else if (uid.startsWith("pay|")) {
            const payAmount = payAmtCol >= 0 ? num(r[payAmtCol]) : null;
            if (payAmount != null && payAmount > 0) {
              const payMonthKey = lsExecutionPeriodKey(r, hdrRow);
              const payPaid    = paidAtCol    >= 0 ? (r[paidAtCol]    ?? null) : null;
              const payPlanned = plannedAtCol >= 0 ? (r[plannedAtCol] ?? null) : null;
              for (const w of lsLinkWorksToPayment(pending, payMonthKey, payAmount, payPaid, payPlanned)) {
                map.set(w.uid, uid);
              }
            }
            pending.length = 0;
          }
        }
      }
    } catch (e) {
      console.warn(`  ⚠ ЛС файл пропущен: ${path.basename(filePath)}: ${e.message}`);
    }
  }
  return { map, workMeta };
}

function extractWorks(wb, executorMap, projectMap, workTypeMap) {
  // dataOffset=2: после строки заголовков есть строка аннотаций перед данными
  const rows = readSheet(wb, "БД_Выставленные_работы", {
    identifyBy: "Исполнитель",
    dataOffset: 2,
  });
  const works = [];
  const otherExpenses = [];
  const warnings = new Set();

  for (const r of rows) {
    const executorName = str(r["Исполнитель"]);
    const projectName  = str(r["Проект"]);
    const workTypeName = str(r["Вид работ"]);
    const amount = num(r["Сумма к выплате"]);
    const sourceType = str(r["Тип сметы"]);

    if (!executorName || !projectName || amount == null) continue;

    if (!executorMap[normKey(executorName)])
      warnings.add(`Работа: исполнитель "${executorName}" не найден`);
    if (!projectMap[normKey(projectName)])
      warnings.add(`Работа: проект "${projectName}" не найден`);

    const rawStatus = str(r["Статус"]);
    const weekRaw = str(r["Неделя оплаты план-факт"]);
    const week = weekRaw ? parseInt(weekRaw.replace(/\D/g, "")) : null;
    const common = {
      executorId: executorMap[normKey(executorName)] ?? null,
      projectId:  projectMap[normKey(projectName)]  ?? null,
      workTypeId: workTypeName ? (workTypeMap[normKey(workTypeName)] ?? null) : null,
      executionYear:  parseYear(r["Год выполнения"])          ?? new Date().getFullYear(),
      executionMonth: parseMonth(r["Месяц выполнения работ"]) ?? 1,
      amount,
      workStatus: mapV(rawStatus, WORK_STATUS_MAP, "submitted"),
      comment:     str(r["Комментарий"]),
      checkedAt:   parseDate(r["Дата проверки"]),
      paidAt:      parseDate(r["Дата оплаты"]),
      plannedPayAt: parseDate(r["Дата оплаты план"] ?? r["Дата оплаты - план"]),
      _executorName: executorName,
      _projectName:  projectName,
      _workTypeName: workTypeName,
      _sourceType:   sourceType,
      _rawStatus:    rawStatus,
      _week:         week,
      _srcUid:       str(r["__SRC_UID"]),
    };

    if (sourceType === "Прочие траты") {
      // Выплатная часть прочей траты выводится из статуса работы (как в приложении):
      // paid → выплата «Оплачено», checked → «Запланировано», иначе выплаты ещё нет.
      let paymentStatus = null;
      let paymentAmount = null;
      if (common.workStatus === "paid") { paymentStatus = "paid"; paymentAmount = amount; }
      else if (common.workStatus === "checked") { paymentStatus = "planned"; paymentAmount = amount; }
      otherExpenses.push({
        ...common,
        description: `${workTypeName ?? "Работа"} — ${executorName}`,
        paymentAmount,
        paymentStatus,
      });
    } else {
      works.push(common);
    }
  }
  return { works, otherExpenses, warnings: [...warnings] };
}

function extractPayments(wb, executorMap, bankMap) {
  const rows = readSheet(wb, "БД_Выплаты", { identifyBy: "Исполнитель" });
  const payments = [];
  // Прочие траты из БД_Выплаты: не создаём Payment-запись, а обновляем otherExpense
  // Карта: srcUid → { paidAt, paymentStatus, bankAccountId }
  const otherExpensePayments = {};
  const warnings = new Set();

  for (const r of rows) {
    const executorName = str(r["Исполнитель"]);
    if (!executorName) continue;
    if (!executorMap[normKey(executorName)])
      warnings.add(`Выплата: исполнитель "${executorName}" не найден`);

    const bankName = str(r["Источник перевода"]);
    if (bankName && !bankMap[normKey(bankName)])
      warnings.add(`Выплата (${executorName}): счёт "${bankName}" не найден`);

    const rawStatus = str(r["Статус"]);
    const tipSm = str(r["Тип сметы"]);
    const srcUid = str(r["__SRC_UID"]);

    if (tipSm === "Прочие траты") {
      // Сохраняем данные оплаты для обновления otherExpense
      if (srcUid) {
        otherExpensePayments[srcUid] = {
          paidAt:        parseDate(r["Дата оплаты"]),
          plannedPayAt:  parseDate(r["Дата оплаты план"]),
          paymentStatus: mapV(rawStatus, PAYMENT_STATUS_MAP, "planned"),
          bankAccountId: bankMap[normKey(bankName)] ?? null,
          paymentAmount: num(r["Выплата"]) ?? 0,
        };
      }
      continue; // не создаём payment-запись
    }

    payments.push({
      executorId:    executorMap[normKey(executorName)] ?? null,
      periodYear:    parseYear(r["Год выполнения"])          ?? new Date().getFullYear(),
      periodMonth:   parseMonth(r["Месяц выполнения работ"]) ?? 1,
      amount:        num(r["Выплата"]) ?? 0,
      paymentStatus: mapV(rawStatus, PAYMENT_STATUS_MAP, "planned"),
      plannedPayAt:  parseDate(r["Дата оплаты план"]),
      paidAt:        parseDate(r["Дата оплаты"]),
      bankAccountId: bankMap[normKey(bankName)] ?? null,
      comment:       str(r["Комментарий"]),
      _executorName: executorName,
      _bankName:     bankName,
      _rawStatus:    rawStatus,
      _srcUid:       srcUid,
    });
  }
  return { payments, otherExpensePayments, warnings: [...warnings] };
}

// ─── PREVIEW PRINTERS ─────────────────────────────────────────────────────────

function previewUsers(users) {
  section("1. ПОЛЬЗОВАТЕЛИ  ←  БД_Ответственные");
  const byActive = users.reduce((a, u) => { a[u.isActive ? "active" : "inactive"]++; return a; }, { active:0, inactive:0 });
  console.log(`  active: ${byActive.active}   inactive: ${byActive.inactive}`);
  printTable(users.slice(0, PREVIEW_ROWS), [
    { key: "fullName", label: "fullName",         max: 28 },
    { key: "email",    label: "email (computed)",  max: 36 },
    { key: "role",     label: "role",              max: 12 },
    { key: "isActive", label: "isActive",          max: 8  },
  ], { title: "users", total: users.length });
}

function previewBankAccounts(accounts) {
  section("2. БАНКОВСКИЕ СЧЕТА  ←  БД_Банковские счета");
  const byStatus = accounts.reduce((a, b) => { a[b.status]++; return a; }, { active:0, archived:0 });
  console.log(`  active: ${byStatus.active}   archived: ${byStatus.archived}`);
  printTable(accounts.slice(0, PREVIEW_ROWS), [
    { key: "name",   label: "name",   max: 42 },
    { key: "status", label: "status", max: 10 },
  ], { title: "bank_accounts", total: accounts.length });
}

function previewWorkTypes(wts) {
  section("3. ВИДЫ РАБОТ  ←  БД_Виды_работ");
  const byStatus = wts.reduce((a, w) => { a[w.status]++; return a; }, { active:0, archived:0 });
  console.log(`  active: ${byStatus.active}   archived: ${byStatus.archived}`);
  printTable(wts.slice(0, PREVIEW_ROWS), [
    { key: "name",    label: "name",    max: 30 },
    { key: "segment", label: "segment", max: 20 },
    { key: "status",  label: "status",  max: 10 },
  ], { title: "work_types", total: wts.length });
}

function previewClients(clients) {
  section("4. КЛИЕНТЫ  ←  БД_Клиенты");
  const preview = clients.slice(0, PREVIEW_ROWS).map((c) => ({
    ...c,
    _revenue: c._revenue ? `${Math.round(c._revenue / 1000)}k ₽` : "—",
  }));
  printTable(preview, [
    { key: "name",               label: "name (computed)",    max: 32 },
    { key: "company",            label: "company",            max: 22 },
    { key: "department",         label: "dept",               max: 12 },
    { key: "_rawStatusProjects", label: "статус проектов",    max: 24 },
    { key: "_revenue",           label: "выручка",            max: 12 },
  ], { title: "clients", total: clients.length });
}

function previewProjects({ projects, warnings }) {
  section("5. ПРОЕКТЫ  ←  БД_Проекты");
  const byStatus = projects.reduce((a, p) => { a[p.status]++; return a; }, { active:0, archived:0 });
  const byType   = projects.reduce((a, p) => { a[p.type]++; return a; }, { client:0, internal:0 });
  console.log(`  active: ${byStatus.active}  archived: ${byStatus.archived}   │   client: ${byType.client}  internal: ${byType.internal}`);
  printTable(projects.slice(0, PREVIEW_ROWS), [
    { key: "name",             label: "name (computed)",     max: 42 },
    { key: "shortName",        label: "shortName",           max: 20 },
    { key: "type",             label: "type",                max: 10 },
    { key: "status",           label: "status",              max: 10 },
    { key: "_clientName",      label: "client →",            max: 24 },
    { key: "_responsibleName", label: "responsible →",       max: 20 },
  ], { title: "projects", total: projects.length, warnings: warnings.slice(0, 5) });
  if (warnings.length > 5) console.log(`     ⋯ ещё ${warnings.length - 5} предупреждений`);
}

function previewExecutors({ executors, executorWorkTypes, projectExecutors, warnings }) {
  section("6. ИСПОЛНИТЕЛИ  ←  БД_Исполнители");
  const byType   = executors.reduce((a, e) => { a[e.type] = (a[e.type]??0)+1; return a; }, {});
  const byStatus = executors.reduce((a, e) => { a[e.status]++; return a; }, { active:0, archived:0 });
  console.log("  Типы: " + Object.entries(byType).map(([k,v]) => `${k}: ${v}`).join("  │  "));
  console.log(`  active: ${byStatus.active}   archived: ${byStatus.archived}`);

  const preview = executors.slice(0, PREVIEW_ROWS).map((e) => ({
    ...e,
    _wtShort: e._workTypeNames.slice(0, 2).join(", ") + (e._workTypeNames.length > 2 ? ` +${e._workTypeNames.length-2}` : ""),
    _projCount: e._projectNames.length,
  }));
  printTable(preview, [
    { key: "name",          label: "name",           max: 28 },
    { key: "type",          label: "type",           max: 12 },
    { key: "companyStatus", label: "companyStatus",  max: 14 },
    { key: "status",        label: "status",         max: 10 },
    { key: "recipientType", label: "recipientType",  max: 20 },
    { key: "_bankName",     label: "bankAccount →",  max: 24 },
    { key: "_wtShort",      label: "workTypes",      max: 28 },
    { key: "_projCount",    label: "#proj",          max: 5  },
  ], { title: "executors", total: executors.length, warnings: warnings.slice(0, 5) });
  if (warnings.length > 5) console.log(`     ⋯ ещё ${warnings.length - 5} предупреждений`);
  console.log(`  ↳ executor_work_types: ${executorWorkTypes.length} связей`);
  console.log(`  ↳ project_executors:   ${projectExecutors.length} связей`);
  const pmCount = executors.filter((e) => e._isProjectManager).length;
  if (pmCount) console.log(`  ↳ руководители проектов (isResponsible): ${pmCount}`);
}

function previewOrders({ orders, warnings }) {
  section("7. ЗАКАЗЫ  ←  БД_Заказы");
  printTable(orders.slice(0, PREVIEW_ROWS), [
    { key: "orderNumber",    label: "№",             max: 6  },
    { key: "_rawNumber",     label: "raw",           max: 8  },
    { key: "description",    label: "description",   max: 30 },
    { key: "_projectName",   label: "project →",     max: 36 },
    { key: "contractNumber", label: "contract#",     max: 20 },
    { key: "status",         label: "status",        max: 10 },
  ], { title: "orders", total: orders.length, warnings });
}

function previewCharges({ charges, warnings }) {
  section("8. НАЧИСЛЕНИЯ  ←  БД_Начисления");
  const byStatus = charges.reduce((a, c) => { a[c.status]=(a[c.status]??0)+1; return a; }, {});
  const total = charges.reduce((s, c) => s + c.amount, 0);
  console.log("  Статусы: " + Object.entries(byStatus).map(([k,v]) => `${k}: ${v}`).join("  │  "));
  console.log(`  Общая сумма: ${total.toLocaleString("ru-RU")} ₽`);

  // Проверка дублей внутри Excel-данных
  const seenCharge = new Map(), seenInvoice = new Map();
  const dupWarnings = [];
  for (const c of charges) {
    if (seenCharge.has(c.chargeNumber))
      dupWarnings.push(`Дубль chargeNumber "${c.chargeNumber}" (строки ${seenCharge.get(c.chargeNumber)} и текущая)`);
    else seenCharge.set(c.chargeNumber, c.chargeNumber);

    if (c.invoiceNumber && seenInvoice.has(c.invoiceNumber))
      dupWarnings.push(`Дубль invoiceNumber "${c.invoiceNumber}" (уже встречался, пропустится при --run)`);
    else if (c.invoiceNumber) seenInvoice.set(c.invoiceNumber, true);
  }
  if (dupWarnings.length) {
    console.log(`\n  ⚠️  Дубли в начислениях (${dupWarnings.length}):`);
    for (const w of dupWarnings) console.log(`     · ${w}`);
  }

  printTable(charges.slice(0, PREVIEW_ROWS), [
    { key: "chargeNumber",  label: "chargeNum",   max: 8  },
    { key: "invoiceNumber", label: "invoiceNum",  max: 14 },
    { key: "_bankName",     label: "bankAcc →",   max: 22 },
    { key: "_orderRef",     label: "order →",     max: 8  },
    { key: "amount",        label: "сумма ₽",     max: 14 },
    { key: "issuedAt",      label: "issuedAt",    max: 12 },
    { key: "paidAt",        label: "paidAt",      max: 12 },
    { key: "_rawStatus",    label: "статус Excel",max: 14 },
    { key: "status",        label: "→ DB",        max: 10 },
  ], { title: "charges", total: charges.length, warnings: warnings.slice(0, 5) });
  if (warnings.length > 5) console.log(`     ⋯ ещё ${warnings.length-5} предупреждений`);
}

function previewWorks({ works, otherExpenses, warnings }) {
  section("9. РАБОТЫ  ←  БД_Выставленные_работы");

  // works
  const wByStatus = works.reduce((a, w) => { a[w.workStatus]=(a[w.workStatus]??0)+1; return a; }, {});
  const wTotal = works.reduce((s, w) => s + w.amount, 0);
  console.log(`  → works (Личная смета):    ${works.length} строк   сумма: ${wTotal.toLocaleString("ru-RU")} ₽`);
  console.log("    " + Object.entries(wByStatus).map(([k,v]) => `${k}: ${v}`).join("  │  "));
  printTable(works.slice(0, PREVIEW_ROWS), [
    { key: "_executorName",  label: "executor →",   max: 24 },
    { key: "_projectName",   label: "project →",    max: 32 },
    { key: "_workTypeName",  label: "workType →",   max: 22 },
    { key: "executionYear",  label: "год",          max: 6  },
    { key: "executionMonth", label: "мес",          max: 4  },
    { key: "amount",         label: "сумма ₽",      max: 12 },
    { key: "_rawStatus",     label: "статус Excel", max: 12 },
    { key: "workStatus",     label: "→ DB",         max: 10 },
  ], { title: "works", total: works.length });

  // other_expenses
  const oByStatus = otherExpenses.reduce((a, o) => { a[o.workStatus]=(a[o.workStatus]??0)+1; return a; }, {});
  const oTotal = otherExpenses.reduce((s, o) => s + o.amount, 0);
  console.log(`\n  → other_expenses (Прочие траты): ${otherExpenses.length} строк   сумма: ${oTotal.toLocaleString("ru-RU")} ₽`);
  console.log("    " + Object.entries(oByStatus).map(([k,v]) => `${k}: ${v}`).join("  │  "));
  printTable(otherExpenses.slice(0, PREVIEW_ROWS), [
    { key: "_executorName",  label: "executor →",   max: 24 },
    { key: "_projectName",   label: "project →",    max: 32 },
    { key: "_workTypeName",  label: "workType →",   max: 22 },
    { key: "executionYear",  label: "год",          max: 6  },
    { key: "executionMonth", label: "мес",          max: 4  },
    { key: "amount",         label: "сумма ₽",      max: 12 },
    { key: "workStatus",     label: "→ DB",         max: 10 },
  ], { title: "other_expenses", total: otherExpenses.length });

  if (warnings.length > 0) {
    const shown = warnings.slice(0, 8);
    console.log(`\n  ⚠️  Несовпадения в lookup (${warnings.length}):`);
    for (const w of shown) console.log(`     · ${w}`);
    if (warnings.length > 8) console.log(`     ⋯ ещё ${warnings.length-8}`);
  }
}

function previewPayments({ payments, warnings }) {
  section("10. ВЫПЛАТЫ  ←  БД_Выплаты");
  const byStatus = payments.reduce((a, p) => { a[p.paymentStatus]=(a[p.paymentStatus]??0)+1; return a; }, {});
  const paidSum  = payments.filter((p) => p.paymentStatus === "paid").reduce((s, p) => s + p.amount, 0);
  console.log("  Статусы: " + Object.entries(byStatus).map(([k,v]) => `${k}: ${v}`).join("  │  "));
  console.log(`  Выплачено (paid): ${paidSum.toLocaleString("ru-RU")} ₽`);
  printTable(payments.slice(0, PREVIEW_ROWS), [
    { key: "_executorName",  label: "executor →",     max: 26 },
    { key: "periodYear",     label: "год",            max: 6  },
    { key: "periodMonth",    label: "мес",            max: 4  },
    { key: "amount",         label: "сумма ₽",        max: 14 },
    { key: "_rawStatus",     label: "статус Excel",   max: 14 },
    { key: "paymentStatus",  label: "→ DB",           max: 10 },
    { key: "paidAt",         label: "paidAt",         max: 12 },
    { key: "_bankName",      label: "bankAcc →",      max: 24 },
  ], { title: "payments", total: payments.length, warnings: warnings.slice(0, 5) });
  if (warnings.length > 5) console.log(`     ⋯ ещё ${warnings.length-5} предупреждений`);
}

function previewSpendingPlan({ lines, warnings }, worksData) {
  const fromWorks = worksData.works.filter(w => w._week && w._week <= 25).length;
  const fromOther = worksData.otherExpenses.filter(o => o._week && o._week <= 25).length;
  const fromSheet = lines.filter(l => l.week && l.week > 25).length;
  section("11. ПЛАН РАСХОДОВ  ←  работы + прочие траты (нед. ≤ 25) + БД_План_расходов_полный (нед. > 25)");
  console.log(`  ℹ️  Нед. 1–25: из выставленных работ (${fromWorks} строк) + прочие траты (${fromOther} строк).`);
  console.log(`  ℹ️  Нед. 26+:  из БД_План_расходов_полный (${fromSheet} строк).`);
  const total = lines.filter(l => l.week > 25).reduce((s, l) => s + l.amount, 0);
  console.log(`  (из листа БД_План_расходов_полный нед. > 25: ${fromSheet} строк, ${total.toLocaleString("ru-RU")} ₽)`);

  const poka = lines.filter((l) => (l._executorName ?? "").toLowerCase().includes("пока не известен")).length;
  const noWt = lines.filter((l) => !l._workTypeName).length;
  console.log(`  "Пока не известен": ${poka}  |  Без вида работ: ${noWt}`);

  printTable(lines.slice(0, PREVIEW_ROWS), [
    { key: "year",          label: "год",           max: 6  },
    { key: "week",          label: "нед",           max: 4  },
    { key: "_projectName",  label: "проект →",      max: 38 },
    { key: "_workTypeName", label: "вид работ →",   max: 20 },
    { key: "_executorName", label: "исполнитель →", max: 26 },
    { key: "amount",        label: "сумма ₽",       max: 12 },
  ], { title: "spending_plan_lines", total: lines.length });

  if (warnings.length > 0) {
    const shown = warnings.slice(0, 8);
    console.log(`\n  ⚠️  Несовпадения (${warnings.length}):`);
    for (const w of shown) console.log(`     · ${w}`);
    if (warnings.length > 8) console.log(`     ⋯ ещё ${warnings.length - 8}`);
  }
}

function previewTasks(lsTasksByExecutor, executorsData) {
  section("14. ЗАДАЧИ  ←  LS «Задачи»");
  const smeta = executorsData.executors.filter((e) => e._email && e.type !== "service");
  let total = 0;
  let withLs = 0;
  const noLs = [];
  for (const e of smeta) {
    const tasks = lsTasksByExecutor.get(normKey(e.name));
    if (tasks?.length) {
      withLs++;
      total += tasks.length;
    } else {
      noLs.push(e.name);
    }
  }
  console.log(
    `  → tasks: ${total} строк для ${withLs}/${smeta.length} исполнителей со сметой (onboardingSeeded=true у всех ${smeta.length})`,
  );
  if (noLs.length) {
    console.log(`  ℹ️  Без LS-файла (пустая вкладка «Задачи»): ${noLs.join(", ")}`);
  }
  const sampleKey = [...lsTasksByExecutor.keys()][0];
  if (sampleKey) {
    const sample = lsTasksByExecutor.get(sampleKey)?.slice(0, PREVIEW_ROWS) ?? [];
    printTable(
      sample.map((t) => ({
        _executor: sampleKey,
        title: t.title.slice(0, 48),
        status: t.status,
        result: t.result?.slice(0, 24) ?? "",
      })),
      [
        { key: "_executor", label: "executor →", max: 22 },
        { key: "title", label: "задача", max: 40 },
        { key: "status", label: "→ DB", max: 12 },
        { key: "result", label: "результат", max: 24 },
      ],
      { title: "tasks (sample)", total },
    );
  }
}

function printSummary(all) {
  section("ИТОГО К ИМПОРТУ");
  const rows = [
    { e: "users",               n: all.users.length,               note: "пользователи (ответственные)" },
    { e: "bank_accounts",       n: all.bankAccounts.length,        note: "банковские счета" },
    { e: "work_types",          n: all.workTypes.length,           note: "виды работ" },
    { e: "clients",             n: all.clients.length,             note: "клиенты" },
    { e: "projects",            n: all.projects.projects.length,   note: "проекты" },
    { e: "executors",           n: all.executors.executors.length, note: "исполнители" },
    { e: "executor_work_types", n: all.executors.executorWorkTypes.length, note: "executor ↔ work_type" },
    { e: "project_executors",   n: all.executors.projectExecutors.length,  note: "project ↔ executor" },
    { e: "orders",              n: all.orders.orders.length,       note: "заказы" },
    { e: "charges",             n: all.charges.charges.length,     note: "начисления" },
    { e: "works",               n: all.works.works.length,          note: "выставленные работы" },
    { e: "other_expenses",      n: all.works.otherExpenses.length,  note: "прочие траты" },
    { e: "payments",            n: all.payments.payments.length,    note: "выплаты" },
    { e: "spending_plan_lines", n: all.works.works.filter(w => w._week && w._week <= 25).length + all.works.otherExpenses.filter(o => o._week && o._week <= 25).length + all.spendingPlan.lines.filter(l => l.week && l.week > 25).length, note: "план расходов (работы+прочие трат нед. ≤ 25 + план нед. > 25)" },
    { e: "tasks",             n: all.tasksCount ?? 0,            note: "задачи из LS (исполнители со сметой)" },
  ];
  printTable(rows, [
    { key: "e",    label: "Таблица",   max: 26 },
    { key: "n",    label: "Строк",     max: 8  },
    { key: "note", label: "Описание",  max: 36 },
  ]);

  // ── Детальный отчёт по несовпадениям ────────────────────────────────────────

  const allWarnings = [
    { section: "projects",      items: all.projects.warnings   ?? [] },
    { section: "executors",     items: all.executors.warnings  ?? [] },
    { section: "orders",        items: all.orders.warnings     ?? [] },
    { section: "charges",       items: all.charges.warnings    ?? [] },
    { section: "works",         items: all.works.warnings      ?? [] },
    { section: "payments",      items: all.payments.warnings   ?? [] },
    { section: "spendingPlan",  items: all.spendingPlan.warnings ?? [] },
  ];

  const totalWarnings = allWarnings.reduce((s, g) => s + g.items.length, 0);

  if (totalWarnings === 0) {
    console.log("\n  ✅  Несовпадений не найдено — все lookup-ссылки корректны.");
  } else {
    const line = "─".repeat(62);
    console.log(`\n${line}`);
    console.log(`  ⚠️  НЕСОВПАДЕНИЯ В LOOKUP  (всего: ${totalWarnings})`);
    console.log(line);

    // Категоризируем предупреждения по типу ссылки
    const byKind = {};
    for (const group of allWarnings) {
      for (const msg of group.items) {
        // Определяем тип: "счёт", "проект", "исполнитель", "заказ", "руководитель", "вид работ"
        let kind = "прочее";
        if (/счёт/i.test(msg))         kind = "bankAccount";
        else if (/исполнитель/i.test(msg)) kind = "executor";
        else if (/проект/i.test(msg))   kind = "project";
        else if (/руководитель/i.test(msg)) kind = "responsible";
        else if (/вид работ/i.test(msg)) kind = "workType";
        else if (/заказ/i.test(msg))    kind = "order";

        if (!byKind[kind]) byKind[kind] = [];
        byKind[kind].push({ section: group.section, msg });
      }
    }

    const kindLabels = {
      bankAccount: "Банковские счета не найдены",
      executor:    "Исполнители не найдены",
      project:     "Проекты не найдены",
      responsible: "Руководители не найдены",
      workType:    "Виды работ не найдены",
      order:       "Заказы не найдены",
      прочее:      "Прочие",
    };

    for (const [kind, items] of Object.entries(byKind)) {
      console.log(`\n  ▸ ${kindLabels[kind] ?? kind}  (${items.length})`);

      // Дедуплицируем и группируем уникальные значения
      const unique = [...new Map(items.map((i) => [i.msg, i])).values()];
      const tableRows = unique.slice(0, 20).map((i) => ({
        section: i.section,
        msg: i.msg,
      }));

      printTable(tableRows, [
        { key: "section", label: "откуда",    max: 12 },
        { key: "msg",     label: "сообщение", max: 72 },
      ]);

      if (unique.length > 20)
        console.log(`     ⋯ ещё ${unique.length - 20} уникальных`);
    }
  }

  // ── Итог ────────────────────────────────────────────────────────────────────
  const line2 = "═".repeat(62);
  console.log(`\n${line2}`);
  if (DRY_RUN) {
    console.log(`  ℹ️  Режим: DRY RUN. БД не изменена.`);
    console.log(`  ▶  Dev:        node scripts/migrate-excel.mjs --run`);
    console.log(`  ▶  Production: node scripts/migrate-excel.mjs --run --production`);
  } else {
    console.log(`  ✅  Режим: ЗАПИСЬ В БД`);
  }
  console.log(line2);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const line = "═".repeat(62);
  console.log(line);
  const mode = DRY_RUN ? "DRY RUN — БД НЕ ИЗМЕНЕНА" : `⚡ ЗАПИСЬ В БД${PRODUCTION ? " [PRODUCTION]" : " [DEV]"}`;
  console.log(`  КПД EXCEL → DB  [${mode}]`);
  console.log(line);
  console.log(`  Файл:          ${EXCEL_PATH}`);
  console.log(`  preview-rows:  ${PREVIEW_ROWS}`);
  console.log("\n  Загрузка файла...");

  const wb = XLSX.readFile(EXCEL_PATH);
  console.log(`  Листов: ${wb.SheetNames.length}\n`);

  // ── Извлекаем данные (порядок важен — каждый шаг строит lookup для следующего) ──

  const responsibles = extractResponsibles(wb);
  const responsiblesByName = Object.fromEntries(
    responsibles.map((r) => [normKey(r.fullName), r]),
  );

  const bankAccounts = extractBankAccounts(wb);
  const workTypes    = extractWorkTypes(wb);
  const clients      = extractClients(wb);

  const bankMap    = Object.fromEntries(bankAccounts.map((b, i) => [normKey(b.name),     `b${i}`]));
  const workTypeMap = Object.fromEntries(workTypes.map((w, i)   => [normKey(w.name),     `wt${i}`]));
  const clientMap  = Object.fromEntries(clients.map((c, i)      => [normKey(c.name),     `cl${i}`]));

  // Исполнители с email получат User в шаге 6 — не дублируем User из БД_Ответственные.
  const executorsDataPre = extractExecutors(wb, {}, bankMap, workTypeMap);
  const executorNamesWithEmail = new Set(
    executorsDataPre.executors.filter((e) => e._email).map((e) => normKey(e.name)),
  );
  const users = extractUsers(wb, { skipNames: executorNamesWithEmail });

  const userMap = Object.fromEntries(users.map((u, i) => [normKey(u.fullName), `u${i}`]));

  const executorsData = extractExecutors(wb, userMap, bankMap, workTypeMap);

  const projectsData  = extractProjects(wb, userMap, clientMap, executorNamesWithEmail);
  const pmProjectCountByName = {};
  for (const p of projectsData.projects) {
    if (!p._responsibleName) continue;
    const k = normKey(p._responsibleName);
    pmProjectCountByName[k] = (pmProjectCountByName[k] || 0) + 1;
  }
  for (const e of executorsData.executors) {
    const pm = responsiblesByName[normKey(e.name)];
    const projectCount = pmProjectCountByName[normKey(e.name)] || 0;
    e._isProjectManager = projectCount > 0 && e.type === "permanent";
    e._responsibleActive = pm?.isActive ?? true;
    e._pmProjectNames = pm?.projectNames ?? [];
  }
  const executorMap = Object.fromEntries(executorsData.executors.map((e, i) => [normKey(e.name), `ex${i}`]));

  const projectMap    = Object.fromEntries(projectsData.projects.map((p, i) => [normKey(p.name), `pr${i}`]));

  const ordersData  = extractOrders(wb, projectMap);
  const orderMap    = Object.fromEntries(ordersData.orders.map((o, i) => [o._rawNumber, `ord${i}`]));

  const chargesData   = extractCharges(wb, bankMap, orderMap);
  const worksData     = extractWorks(wb, executorMap, projectMap, workTypeMap);
  const paymentsData  = extractPayments(wb, executorMap, bankMap);
  const spendingPlanData = extractSpendingPlan(wb, projectMap, executorMap, workTypeMap);

  const lsTasksByExecutor = buildTasksFromLS(LS_FOLDER);
  let tasksCount = 0;
  for (const e of executorsData.executors) {
    if (!e._email || e.type === "service") continue;
    tasksCount += lsTasksByExecutor.get(normKey(e.name))?.length ?? 0;
  }

  const all = { users, responsibles, bankAccounts, workTypes, clients,
    projects: projectsData, executors: executorsData,
    orders: ordersData, charges: chargesData,
    works: worksData, payments: paymentsData,
    spendingPlan: spendingPlanData, tasksCount };

  // ── Preview ─────────────────────────────────────────────────────────────────
  previewUsers(users);
  previewBankAccounts(bankAccounts);
  previewWorkTypes(workTypes);
  previewClients(clients);
  previewProjects(projectsData);
  previewExecutors(executorsData);
  previewOrders(ordersData);
  previewCharges(chargesData);
  previewWorks(worksData);
  previewPayments(paymentsData);
  previewSpendingPlan(spendingPlanData, all.works);
  previewTasks(lsTasksByExecutor, executorsData);
  printSummary(all);

  // ── Реальная запись ──────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    // Подтверждение если --production
    if (PRODUCTION) {
      console.log("\n  ⚠️  ВНИМАНИЕ: запись в PRODUCTION БД (NeonDB)");
      console.log(`  DATABASE_URL: ${(process.env.DATABASE_URL ?? "").slice(0, 50)}...`);
      console.log("  БД будет ПОЛНОСТЬЮ ОЧИЩЕНА перед записью.");
      console.log("  Нажми Ctrl+C чтобы отменить, или подожди 5 секунд...\n");
      await new Promise((r) => setTimeout(r, 5000));
    }

    console.log("\n  Начинаем запись в БД...");

    const dbUrl = process.env.DATABASE_URL ?? "";
    const isPostgres = dbUrl.startsWith("postgresql://") || dbUrl.startsWith("postgres://");

    // Регистрируем восстановление провайдера при выходе процесса
    if (isPostgres) {
      switchSchemaProvider("postgresql");
      process.on("exit", () => switchSchemaProvider("sqlite", { generate: false }));
    }

    let prisma = await createPrismaClient();

    try {
      await dropAll(prisma);
      // Neon может закрыть соединение после TRUNCATE — переподключаемся
      await prisma.$disconnect();
      await new Promise((r) => setTimeout(r, 2000));
      prisma = await createPrismaClient();
      await prisma.$queryRaw`SELECT 1`;
      await runMigration(prisma, all);
      console.log("\n  ✅ Миграция завершена!");
    } finally {
      await prisma.$disconnect();
    }
  }
}

// ─── ОЧИСТКА БД (обратный порядок FK) ────────────────────────────────────────

async function dropAll(prisma) {
  console.log("  [0/14] Очистка БД...");
  const dbUrl = process.env.DATABASE_URL ?? "";
  const isPg = dbUrl.startsWith("postgresql://") || dbUrl.startsWith("postgres://");

  if (isPg) {
    // PostgreSQL: TRUNCATE CASCADE одним запросом
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        works, other_expenses, payments,
        charges, orders, spending_plan_lines,
        project_executors, executor_work_types, executors,
        projects, clients,
        work_types, bank_accounts, users
      CASCADE
    `);
  } else {
    // SQLite: удаляем в обратном порядке FK
    await prisma.work.deleteMany();
    await prisma.otherExpense.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.order.deleteMany();
    await prisma.spendingPlanLine.deleteMany();
    await prisma.projectExecutor.deleteMany();
    await prisma.executorWorkType.deleteMany();
    await prisma.executor.deleteMany();
    await prisma.project.deleteMany();
    await prisma.client.deleteMany();
    await prisma.workType.deleteMany();
    await prisma.bankAccount.deleteMany();
    await prisma.user.deleteMany();
  }
  console.log("  [0/14] БД очищена ✓");
}

// ─── BATCH INSERT (после TRUNCATE — без upsert/findFirst) ───────────────────

const BATCH_SIZE = 1000;

async function createManyBatched(model, rows, { skipDuplicates = false } = {}) {
  if (!rows.length) return 0;
  let n = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const r = await model.createMany({ data: chunk, skipDuplicates });
    n += r.count;
  }
  return n;
}

async function createManyAndReturnBatched(model, rows, { retries = 3 } = {}) {
  if (!rows.length) return [];
  const out = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const created = await model.createManyAndReturn({ data: chunk });
        out.push(...created);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt < retries && /closed the connection|ECONNRESET|connection/i.test(msg)) {
          console.log(`  ⚠️  Обрыв соединения, повтор ${attempt}/${retries}...`);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
        throw e;
      }
    }
    if (lastErr) throw lastErr;
  }
  return out;
}

// ─── РЕАЛЬНАЯ ЗАПИСЬ (только при --run) ──────────────────────────────────────

async function runMigration(prisma, all) {
  const responsiblesByName = Object.fromEntries(
    (all.responsibles ?? []).map((r) => [normKey(r.fullName), r]),
  );
  const t0 = Date.now();
  const step = (label, fn) => fn().then((n) => {
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    const count = typeof n === "number" ? ` (${n})` : "";
    console.log(`  ${label}${count} — ${sec}s`);
    return n;
  });

  // 1. users
  const userIds = {};
  const userIdsByEmail = {};
  await step("[1/14] users", async () => {
    const created = await createManyAndReturnBatched(
      prisma.user,
      all.users.map((u) => ({
        email: u.email,
        password: u.password,
        fullName: u.fullName,
        role: u.role,
        isActive: u.isActive,
      }))
    );
    for (const r of created) {
      userIds[normKey(r.fullName)] = r.id;
      userIdsByEmail[normEmail(r.email)] = r.id;
    }
    return created.length;
  });

  // 2. bank_accounts
  const bankIds = {};
  await step("[2/14] bank_accounts", async () => {
    const created = await createManyAndReturnBatched(
      prisma.bankAccount,
      all.bankAccounts.map((b) => ({ name: b.name, status: b.status }))
    );
    for (const r of created) bankIds[normKey(r.name)] = r.id;
    return created.length;
  });

  // 3. work_types
  const wtIds = {};
  const UNKNOWN_WT_NAME = "Пока не известен";
  await step("[3/14] work_types", async () => {
    const created = await createManyAndReturnBatched(
      prisma.workType,
      all.workTypes.map((w) => ({ name: w.name, segment: w.segment, status: w.status }))
    );
    for (const r of created) wtIds[normKey(r.name)] = r.id;

    // Создаём «Пока не известен» только если ещё нет (нужен для плана расходов)
    if (!wtIds[normKey(UNKNOWN_WT_NAME)]) {
      const wt = await prisma.workType.upsert({
        where: { name: UNKNOWN_WT_NAME },
        update: {},
        create: { name: UNKNOWN_WT_NAME, segment: "Прочее", status: "active" },
      });
      wtIds[normKey(UNKNOWN_WT_NAME)] = wt.id;
      console.log(`     ↳ создан вид работ "${UNKNOWN_WT_NAME}" (id: ${wt.id})`);
    }

    return created.length;
  });

  // 4. clients
  const clientIds = {};
  await step("[4/14] clients", async () => {
    const created = await createManyAndReturnBatched(
      prisma.client,
      all.clients.map((c) => ({
        name: c.name,
        company: c.company,
        department: c.department,
        status: c.status,
      }))
    );
    for (const r of created) clientIds[normKey(r.name)] = r.id;
    return created.length;
  });

  // 5. projects
  const projectIds = {};
  await step("[5/14] projects", async () => {
    const rows = all.projects.projects.map((p) => ({
      name: p.name,
      shortName: p.shortName,
      type: p.type,
      status: p.status,
      clientId: p._clientName ? (clientIds[normKey(p._clientName)] ?? null) : null,
      responsibleUserId: p._responsibleName ? (userIds[normKey(p._responsibleName)] ?? null) : null,
    }));
    const created = await createManyAndReturnBatched(prisma.project, rows);
    for (let i = 0; i < created.length; i++) {
      projectIds[normKey(all.projects.projects[i].name)] = created[i].id;
    }
    return created.length;
  });

  // 6. executors + links
  const executorIds = {};
  const credentialsLines = [];
  await step("[6/14] executors + links", async () => {
    const bcrypt = await import("bcryptjs");

    // Аккаунты только для исполнителей с заполненным email (доступ к личной смете)
    const emailToUserId = { ...userIdsByEmail };
    const seenEmails = new Set(Object.keys(userIdsByEmail));
    const toCreate = [];
    for (const e of all.executors.executors) {
      if (!e._email) continue;
      const emailKey = normEmail(e._email);
      if (seenEmails.has(emailKey)) continue;
      seenEmails.add(emailKey);
      toCreate.push(e);
    }
    if (toCreate.length > 0) {
      const userRows = await Promise.all(
        toCreate.map(async (e) => {
          const pwd = generatePassword();
          const hash = await bcrypt.hash(pwd, 10);
          credentialsLines.push(`${e._email.trim()}:${pwd}`);
          return {
            email: e._email.trim(),
            password: hash,
            fullName: e.name,
            role: "executor",
            isActive: e.status === "active",
          };
        })
      );
      const createdUsers = await createManyAndReturnBatched(prisma.user, userRows);
      for (const u of createdUsers) emailToUserId[normEmail(u.email)] = u.id;
    }

    // userId уникален — один аккаунт только у первого исполнителя с этим email
    const usedUserIds = new Set();
    const created = await createManyAndReturnBatched(
      prisma.executor,
      all.executors.executors.map((e) => {
        let userId = null;
        if (e._email) {
          const uid = emailToUserId[normEmail(e._email)] ?? null;
          if (uid && !usedUserIds.has(uid)) {
            userId = uid;
            usedUserIds.add(uid);
          }
        }
        return {
        name: e.name,
        type: e.type,
        companyStatus: e.companyStatus,
        recipientType: e.recipientType,
        specialty: e.specialty,
        contractFile: e.contractFile,
        ndaFile: e.ndaFile,
        inTgChat: e.inTgChat ?? false,
        contacts: e.contacts,
        contactEmail: e.contactEmail,
        accessEmail: e.accessEmail,
        requisites: e.requisites,
        note: e.note,
        status: e.status,
        accessRevokedAt: e.accessRevokedAt,
        oldEstimateUrl: e.oldEstimateUrl,
        userId,
        isResponsible: false,
        responsibleActive: true,
        defaultBankAccountId: e._bankName ? (bankIds[normKey(e._bankName)] ?? null) : null,
        responsibleUserId: e._responsibleName ? (userIds[normKey(e._responsibleName)] ?? null) : null,
      };
      })
    );
    const executorUserIds = {};
    const executorIdByName = {};
    for (const r of created) {
      executorIds[normKey(r.name)] = r.id;
      executorIdByName[normKey(r.name)] = r.id;
      if (r.userId) executorUserIds[normKey(r.name)] = r.userId;
    }

    // Руководитель проекта = User исполнителя (не отдельный User из БД_Ответственные).
    const pmCountByUserId = new Map();
    let pmProjectsUpdated = 0;
    for (const p of all.projects.projects) {
      if (!p._responsibleName) continue;
      const nameKey = normKey(p._responsibleName);
      const pid = projectIds[normKey(p.name)];
      if (!pid) continue;
      const uid = executorUserIds[nameKey] ?? userIds[nameKey] ?? null;
      if (!uid) continue;
      pmCountByUserId.set(uid, (pmCountByUserId.get(uid) || 0) + 1);
      if (executorUserIds[nameKey]) {
        await prisma.project.update({ where: { id: pid }, data: { responsibleUserId: uid } });
        pmProjectsUpdated++;
      }
    }
    if (pmProjectsUpdated) console.log(`     ↳ project PM links: ${pmProjectsUpdated}`);

    // isResponsible только если ≥1 проект как РП (по БД_Проекты).
    let pmExecutors = 0;
    for (const e of all.executors.executors) {
      const nameKey = normKey(e.name);
      const execId = executorIdByName[nameKey];
      const uid = executorUserIds[nameKey];
      if (!execId || !uid || e.type !== "permanent") continue;
      const count = pmCountByUserId.get(uid) || 0;
      if (count <= 0) continue;
      const pm = responsiblesByName[nameKey];
      await prisma.executor.update({
        where: { id: execId },
        data: {
          isResponsible: true,
          responsibleActive: pm?.isActive ?? true,
        },
      });
      pmExecutors++;
    }
    if (pmExecutors) console.log(`     ↳ isResponsible: ${pmExecutors}`);

    const ewtRows = [];
    for (const lnk of all.executors.executorWorkTypes) {
      const eId = executorIds[normKey(lnk.executorName)];
      const wId = wtIds[normKey(lnk.workTypeName)];
      if (eId && wId) ewtRows.push({ executorId: eId, workTypeId: wId });
    }
    const peRows = [];
    for (const lnk of all.executors.projectExecutors) {
      const eId = executorIds[normKey(lnk.executorName)];
      const pId = projectIds[normKey(lnk.projectName)];
      if (eId && pId) peRows.push({ projectId: pId, executorId: eId });
    }
    await createManyBatched(prisma.executorWorkType, ewtRows, { skipDuplicates: true });
    await createManyBatched(prisma.projectExecutor, peRows, { skipDuplicates: true });
    return created.length;
  });

  // 7. orders
  const orderIds = {};
  await step("[7/14] orders", async () => {
    const rows = [];
    const keys = [];
    for (const o of all.orders.orders) {
      const projectId = o._projectName ? (projectIds[normKey(o._projectName)] ?? null) : null;
      if (!projectId) continue;
      rows.push({
        orderNumber: o.orderNumber,
        description: o.description,
        projectId,
        contractNumber: o.contractNumber,
        status: o.status,
      });
      keys.push(o._rawNumber);
    }
    const created = await createManyAndReturnBatched(prisma.order, rows);
    for (let i = 0; i < created.length; i++) orderIds[keys[i]] = created[i].id;
    return created.length;
  });

  // 8. charges
  await step("[8/14] charges", async () => {
    const seenCharge = new Set();
    const seenInvoice = new Set();
    const rows = [];
    let skipped = 0;
    for (const c of all.charges.charges) {
      if (seenCharge.has(c.chargeNumber)) {
        skipped++;
        continue;
      }
      if (c.invoiceNumber && seenInvoice.has(c.invoiceNumber)) {
        skipped++;
        continue;
      }
      seenCharge.add(c.chargeNumber);
      if (c.invoiceNumber) seenInvoice.add(c.invoiceNumber);
      rows.push({
        chargeNumber: c.chargeNumber,
        invoiceNumber: c.invoiceNumber,
        bankAccountId: c._bankName ? (bankIds[normKey(c._bankName)] ?? null) : null,
        orderId: c._orderRef ? (orderIds[c._orderRef] ?? null) : null,
        amount: c.amount,
        issuedPlanAt: c.issuedPlanAt,
        issuedAt: c.issuedAt,
        paidPlanAt: c.paidPlanAt,
        paidAt: c.paidAt,
        paymentPurpose: c.paymentPurpose,
        status: c.status,
        documents: c.documents,
      });
    }
    if (skipped) console.log(`     ⚠️  Пропущено ${skipped} дублей начислений`);
    return createManyBatched(prisma.charge, rows);
  });

  // Карта позиционной привязки из LS файлов личных смет: work_srcUid → payment_srcUid
  // + метаданные работ (ТЗ, объём, ставка) из LS файлов
  const { map: workPaymentMap, workMeta: lsWorkMeta } = buildWorkPaymentMap(LS_FOLDER);
  console.log(`  ЛС файлы: ${workPaymentMap.size} работ позиционно привязаны к выплатам, ${lsWorkMeta.size} с метаданными`);

  // 9. payments
  // paymentIdBySrcUid: payment_srcUid (из LS файлов) → id — основной ключ
  // paymentIds:        "nameKey|y|mo|dateStr" и "nameKey|y|mo" → id — запасной ключ по дате
  const paymentIdBySrcUid = {};
  const paymentIds = {};
  await step("[9/14] payments", async () => {
    const rows = [];
    const meta = [];
    for (const p of all.payments.payments) {
      const executorId = p._executorName ? (executorIds[normKey(p._executorName)] ?? null) : null;
      if (!executorId) continue;
      rows.push({
        executorId,
        periodYear: p.periodYear,
        periodMonth: p.periodMonth,
        amount: p.amount,
        paymentStatus: p.paymentStatus,
        plannedPayAt: p.plannedPayAt,
        paidAt: p.paidAt,
        bankAccountId: p._bankName ? (bankIds[normKey(p._bankName)] ?? null) : null,
        comment: p.comment,
      });
      meta.push({
        nameKey: normKey(p._executorName),
        year: p.periodYear,
        month: p.periodMonth,
        paidAt: toMoscowDateKey(p.paidAt) ?? toMoscowDateKey(p.plannedPayAt),
        srcUid: p._srcUid ?? null,
      });
    }
    const created = await createManyAndReturnBatched(prisma.payment, rows);
    for (let i = 0; i < created.length; i++) {
      const m = meta[i];
      const id = created[i].id;
      // UID-ключ (основной, из LS файлов)
      if (m.srcUid) paymentIdBySrcUid[m.srcUid] = id;
      // Ключ по дате (запасной): не перезаписываем при коллизии дат
      if (m.paidAt) {
        const dateKey = `${m.nameKey}|${m.year}|${m.month}|${m.paidAt}`;
        if (!paymentIds[dateKey]) paymentIds[dateKey] = id;
      }
      const fallbackKey = `${m.nameKey}|${m.year}|${m.month}`;
      if (!paymentIds[fallbackKey]) paymentIds[fallbackKey] = id;
    }
    return created.length;
  });

  // 10. works
  await step("[10/14] works", async () => {
    // Ответственный по умолчанию = РП проекта (KPD-284): берём исполнителя
    // по имени руководителя проекта (РП — постоянный исполнитель).
    const projResponsibleName = {};
    for (const p of all.projects.projects) {
      projResponsibleName[normKey(p.name)] = p._responsibleName || null;
    }
    const rows = [];
    for (const w of all.works.works) {
      const executorId = w._executorName ? (executorIds[normKey(w._executorName)] ?? null) : null;
      const projectId = w._projectName ? (projectIds[normKey(w._projectName)] ?? null) : null;
      const workTypeId = w._workTypeName ? (wtIds[normKey(w._workTypeName)] ?? null) : null;
      if (!executorId || !projectId || !workTypeId) continue;
      const respName = w._projectName ? projResponsibleName[normKey(w._projectName)] : null;
      const responsibleExecutorId = respName ? (executorIds[normKey(respName)] ?? null) : null;
      // ТЗ, объём, ставка — из LS файла личной сметы (приоритет) или из БД_Выставленные_работы
      const lsMeta = w._srcUid ? lsWorkMeta.get(w._srcUid) : null;
      rows.push({
        executorId,
        projectId,
        workTypeId,
        responsibleExecutorId,
        executionYear: w.executionYear,
        executionMonth: w.executionMonth,
        techTask: lsMeta?.techTask ?? null,
        report: lsMeta?.report ?? null,
        volume: lsMeta?.volume ?? null,
        rate: lsMeta?.rate ?? null,
        amount: w.amount,
        workStatus: w.workStatus,
        comment: w.comment,
        checkedAt: w.checkedAt,
        paidAt: w.paidAt,
        plannedPayAt: w.plannedPayAt,
        paymentId: (() => {
          // 1. UID из LS файла личной сметы (основной, точный).
          // Игнорируем если uid начинается с pay| — это человеческая ошибка в источнике
          if (w._srcUid && w._srcUid.startsWith("ls|")) {
            const payUid = workPaymentMap.get(w._srcUid);
            if (payUid) {
              const id = paymentIdBySrcUid[payUid];
              if (id) return id;
            }
          }
          const nameKey = normKey(w._executorName);
          const y = w.executionYear;
          const mo = w.executionMonth;
          // 2. Точное совпадение по дате оплаты
          const workDate = toMoscowDateKey(w.paidAt) ?? toMoscowDateKey(w.plannedPayAt);
          if (workDate) {
            const exact = paymentIds[`${nameKey}|${y}|${mo}|${workDate}`];
            if (exact) return exact;
            // 3. Допуск ±2 дня (сдвиг часового пояса, перенос выходного)
            const d = new Date(workDate + "T12:00:00Z");
            for (const delta of [-1, 1, -2, 2]) {
              const alt = new Date(d);
              alt.setUTCDate(alt.getUTCDate() + delta);
              const altKey = `${nameKey}|${y}|${mo}|${alt.toISOString().slice(0, 10)}`;
              if (paymentIds[altKey]) return paymentIds[altKey];
            }
          }
          // 4. Fallback по периоду (год + месяц)
          return paymentIds[`${nameKey}|${y}|${mo}`] ?? null;
        })(),
      });
    }
    return createManyBatched(prisma.work, rows);
  });

  // 11. other_expenses
  const defaultUserId = Object.values(userIds)[0];
  await step("[11/14] other_expenses", async () => {
    // Ответственный = РП проекта (как у работ); счёт и способ оплаты — из исполнителя.
    const projResponsibleName = {};
    for (const p of all.projects.projects) {
      projResponsibleName[normKey(p.name)] = p._responsibleName || null;
    }
    const execBankName = {};
    const execRecipientType = {};
    for (const e of all.executors.executors) {
      execBankName[normKey(e.name)] = e._bankName || null;
      execRecipientType[normKey(e.name)] = e.recipientType || null;
    }
    const rows = [];
    for (const o of all.works.otherExpenses) {
      const executorId = o._executorName ? (executorIds[normKey(o._executorName)] ?? null) : null;
      const projectId = o._projectName ? (projectIds[normKey(o._projectName)] ?? null) : null;
      const workTypeId = o._workTypeName ? (wtIds[normKey(o._workTypeName)] ?? null) : null;
      if (!executorId || !projectId || !workTypeId) continue;
      const respName = o._projectName ? projResponsibleName[normKey(o._projectName)] : null;
      const responsibleExecutorId = respName ? (executorIds[normKey(respName)] ?? null) : null;
      const bankName = o._executorName ? execBankName[normKey(o._executorName)] : null;
      const bankAccountId = bankName ? (bankIds[normKey(bankName)] ?? null) : null;
      const preferredPayMethod = o._executorName ? execRecipientType[normKey(o._executorName)] : null;
      // Берём paidAt/paymentStatus/paymentAmount из БД_Выплаты (точнее чем статус работы)
      // bankAccountId — только из исполнителя (не из БД_Выплаты, чтобы не нарушить FK)
      const ptPay = o._srcUid ? all.payments.otherExpensePayments?.[o._srcUid] : null;
      rows.push({
        executorId,
        projectId,
        workTypeId,
        responsibleExecutorId,
        bankAccountId,
        preferredPayMethod,
        executionYear: o.executionYear,
        executionMonth: o.executionMonth,
        amount: o.amount,
        paymentAmount: ptPay?.paymentAmount ?? o.paymentAmount,
        description: o.description,
        workStatus: o.workStatus,
        paymentStatus: ptPay?.paymentStatus ?? o.paymentStatus,
        comment: o.comment,
        checkedAt: o.checkedAt,
        paidAt:       ptPay?.paidAt        ?? o.paidAt,
        plannedPayAt: ptPay?.plannedPayAt   ?? o.plannedPayAt,
        responsibleUserId: defaultUserId,
        createdById: defaultUserId,
      });
    }
    return createManyBatched(prisma.otherExpense, rows);
  });

  // 12. spending_plan_lines — нед. ≤ 25 из работ, нед. > 25 из БД_План_расходов_полный
  await step("[12/14] spending_plan_lines", async () => {
    const rows = [];

    // Part A: из выставленных работ и прочих трат, недели 1–25
    for (const w of all.works.works) {
      const rawWeek = w._week;
      if (!rawWeek || rawWeek > 25) continue;
      const executorId = w._executorName ? (executorIds[normKey(w._executorName)] ?? null) : null;
      const projectId = w._projectName ? (projectIds[normKey(w._projectName)] ?? null) : null;
      const workTypeId = w._workTypeName ? (wtIds[normKey(w._workTypeName)] ?? null) : null;
      if (!executorId || !projectId || !workTypeId) continue;
      const d = w.paidAt ?? w.plannedPayAt;
      const { year, week } = planLineWeekYear(d, rawWeek, w.executionYear, w.executionMonth);
      rows.push({
        projectId,
        executorId,
        workTypeId,
        year,
        week,
        amount:      w.amount,
        createdById: defaultUserId,
      });
    }
    const fromWorks = rows.length;

    // Part A2: прочие траты, недели 1–25
    for (const o of all.works.otherExpenses) {
      const rawWeek = o._week;
      if (!rawWeek || rawWeek > 25) continue;
      const executorId = o._executorName ? (executorIds[normKey(o._executorName)] ?? null) : null;
      const projectId = o._projectName ? (projectIds[normKey(o._projectName)] ?? null) : null;
      const workTypeId = o._workTypeName ? (wtIds[normKey(o._workTypeName)] ?? null) : null;
      if (!executorId || !projectId || !workTypeId) continue;
      const d = o.paidAt ?? o.plannedPayAt;
      const { year, week } = planLineWeekYear(d, rawWeek, o.executionYear, o.executionMonth);
      rows.push({
        projectId,
        executorId,
        workTypeId,
        year,
        week,
        amount:      o.amount,
        createdById: defaultUserId,
      });
    }
    const fromOtherExpenses = rows.length - fromWorks;
    console.log(`     ↳ из выставленных работ (≤ нед. 25): ${fromWorks}`);
    console.log(`     ↳ из прочих трат (≤ нед. 25): ${fromOtherExpenses}`);

    // Part B: из БД_План_расходов_полный, недели > 25
    const unknownExecutorId = executorIds[normKey("пока не известен")] ?? null;
    const unknownWorkTypeId = wtIds[normKey(UNKNOWN_WT_NAME)] ?? null;
    let fromPlan = 0;
    let fromPlanUnknown = 0;
    for (const l of all.spendingPlan.lines) {
      if (!l.week || l.week <= 25) continue;
      const projectId = l._projectName ? (projectIds[normKey(l._projectName)] ?? null) : null;
      if (!projectId) continue; // проект обязателен

      // Исполнитель: резолвим или fallback на «Пока не известен»
      const resolvedExecutorId = l._executorName
        ? (executorIds[normKey(l._executorName)] ?? unknownExecutorId)
        : unknownExecutorId;
      // Вид работ: резолвим или fallback на «Пока не известен»
      const resolvedWorkTypeId = l._workTypeName
        ? (wtIds[normKey(l._workTypeName)] ?? unknownWorkTypeId)
        : unknownWorkTypeId;

      if (!resolvedExecutorId || !resolvedWorkTypeId) continue;

      const isUnknown = resolvedExecutorId === unknownExecutorId || resolvedWorkTypeId === unknownWorkTypeId;
      if (isUnknown) fromPlanUnknown++;

      rows.push({
        projectId,
        executorId: resolvedExecutorId,
        workTypeId: resolvedWorkTypeId,
        year:        l.year,
        week:        l.week,
        amount:      l.amount,
        createdById: defaultUserId,
      });
      fromPlan++;
    }
    console.log(`     ↳ из БД_План_расходов_полный (> нед. 25): ${fromPlan} (из них с «Пока не известен»: ${fromPlanUnknown})`);

    return createManyBatched(prisma.spendingPlanLine, rows);
  });

  await step("[13/14] tasks ← LS", async () => {
    const lsTasksByExecutor = buildTasksFromLS(LS_FOLDER);
    const smetaExecutors = await prisma.executor.findMany({
      where: { userId: { not: null }, type: { not: "service" } },
      select: { id: true, name: true },
    });

    const taskRows = [];
    let withTasks = 0;
    const noLs = [];
    for (const e of smetaExecutors) {
      const tasks = lsTasksByExecutor.get(normKey(e.name));
      if (tasks?.length) {
        withTasks++;
        for (const t of tasks) {
          taskRows.push({
            executorId: e.id,
            title: t.title,
            status: t.status,
            plannedDoneAt: t.plannedDoneAt,
            result: t.result,
            comment: t.comment,
            isOnboarding: false,
          });
        }
      } else {
        noLs.push(e.name);
      }
    }

    const n = await createManyBatched(prisma.task, taskRows);
    const seeded = await prisma.executor.updateMany({
      where: { userId: { not: null }, type: { not: "service" } },
      data: { onboardingSeeded: true },
    });
    console.log(
      `     ↳ со сметой: ${smetaExecutors.length}, с задачами: ${withTasks}, задач: ${n}, onboardingSeeded: ${seeded.count}`,
    );
    if (noLs.length) console.log(`     ↳ без LS: ${noLs.join(", ")}`);
    return n;
  });

  // 14. admin
  await step("[14/14] admin user", async () => {
    const bcrypt = await import("bcryptjs");
    const adminHash = await bcrypt.hash("Password123!", 10);
    await prisma.user.upsert({
      where: { email: "admin@kpd.local" },
      update: { fullName: "Админ Админов", role: "admin", isActive: true },
      create: {
        email: "admin@kpd.local",
        password: adminHash,
        fullName: "Админ Админов",
        role: "admin",
        isActive: true,
      },
    });
    console.log("     admin@kpd.local / Password123! ✓");
    return 1;
  });

  // Сохраняем доступы в файл
  const allCredentials = ["admin@kpd.local:Password123!", ...credentialsLines];
  const credPath = path.resolve(__dirname, "import-credentials.txt");
  fs.writeFileSync(credPath, allCredentials.join("\n") + "\n", "utf8");
  console.log(`  📄 Доступы (${allCredentials.length}) → ${credPath}`);

  console.log(`  ⏱  Итого: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("\n❌ Ошибка:", err.message ?? err);
  if (err.stack) console.error(err.stack.split("\n").slice(1, 4).join("\n"));
  process.exit(1);
});
