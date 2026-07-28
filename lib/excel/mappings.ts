/**
 * Общие маппинги Excel ↔ БД для миграции и экспорта.
 *
 * RU→EN используется при импорте (scripts/migrate-excel.mjs),
 * EN→RU — при экспорте (lib/services/excel-export.ts).
 */

// ─── RU → EN (импорт) ────────────────────────────────────────────────────────

export const EXECUTOR_TYPE_RU_EN: Record<string, string> = {
  Постоянный: "permanent",
  Внешний: "external",
  Сервисы: "service",
  Банк: "bank",
};

export const STATUS_RU_EN: Record<string, string> = {
  Активный: "active",
  Архивный: "archived",
};

export const PROJECT_TYPE_RU_EN: Record<string, string> = {
  Клиентский: "client",
  Внутренний: "internal",
};

export const WORK_STATUS_RU_EN: Record<string, string> = {
  Выставлено: "submitted",
  Проверено: "checked",
  Оплачено: "paid",
  Переработка: "rework",
};

export const CHARGE_STATUS_RU_EN: Record<string, string> = {
  "В плане": "planned",
  "К оплате": "to_pay",
  "На согласовании": "pending_approval",
  Оплачено: "paid",
};

export const PAYMENT_STATUS_RU_EN: Record<string, string> = {
  Запланировано: "planned",
  Оплачено: "paid",
};

// ─── EN → RU (экспорт) ─────────────────────────────────────────────────────────

function invert(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [ru, en] of Object.entries(map)) {
    if (!(en in out)) out[en] = ru; // первый встретившийся RU-лейбл — приоритетный
  }
  return out;
}

export const EXECUTOR_TYPE_EN_RU = invert(EXECUTOR_TYPE_RU_EN);
export const STATUS_EN_RU = invert(STATUS_RU_EN);
export const PROJECT_TYPE_EN_RU = invert(PROJECT_TYPE_RU_EN);
export const WORK_STATUS_EN_RU = invert(WORK_STATUS_RU_EN);
export const CHARGE_STATUS_EN_RU: Record<string, string> = {
  ...invert(CHARGE_STATUS_RU_EN),
  // legacy-значения статусов из старых выгрузок
  issued: "К оплате",
  overdue: "Просрочено",
};
export const PAYMENT_STATUS_EN_RU = invert(PAYMENT_STATUS_RU_EN);

export function ru(map: Record<string, string>, value: string | null | undefined): string | null {
  if (value == null) return null;
  return map[value] ?? value;
}

// ─── Месяцы ─────────────────────────────────────────────────────────────────

export const MONTH_LABELS = [
  "01-Январь", "02-Февраль", "03-Март", "04-Апрель",
  "05-Май", "06-Июнь", "07-Июль", "08-Август",
  "09-Сентябрь", "10-Октябрь", "11-Ноябрь", "12-Декабрь",
] as const;

export function monthLabel(month: number | null | undefined): string | null {
  if (month == null || month < 1 || month > 12) return null;
  return MONTH_LABELS[month - 1];
}

// ─── Метаданные листов БД_* ───────────────────────────────────────────────────
//
// identifyBy: значение ячейки, по которому ищется строка заголовков.
// dataOffset: сколько строк пропустить после заголовка до данных
//   (БД_Выставленные_работы = 2 — строка аннотаций между заголовком и данными).

export type SheetMeta = { sheet: string; identifyBy: string; dataOffset: number };

export const SHEET_META = {
  users: { sheet: "БД_Ответственные", identifyBy: "Имя", dataOffset: 1 },
  bankAccounts: { sheet: "БД_Банковские счета", identifyBy: "Счёт", dataOffset: 1 },
  workTypes: { sheet: "БД_Виды_работ", identifyBy: "Вид работ", dataOffset: 1 },
  clients: { sheet: "БД_Клиенты", identifyBy: "Клиент", dataOffset: 1 },
  projects: { sheet: "БД_Проекты", identifyBy: "Проект", dataOffset: 1 },
  executors: { sheet: "БД_Исполнители", identifyBy: "Исполнитель", dataOffset: 1 },
  orders: { sheet: "БД_Заказы", identifyBy: "Номер заказа", dataOffset: 1 },
  charges: { sheet: "БД_Начисления", identifyBy: "Банковский счет", dataOffset: 1 },
  works: { sheet: "БД_Выставленные_работы", identifyBy: "Исполнитель", dataOffset: 2 },
  payments: { sheet: "БД_Выплаты", identifyBy: "Исполнитель", dataOffset: 1 },
  spendingPlan: { sheet: "БД_План_расходов_полный", identifyBy: "Год оплаты - план", dataOffset: 1 },
} satisfies Record<string, SheetMeta>;

// ─── Составные имена (как в системе) ────────────────────────────────────────

export function buildClientName(company: string, department: string | null): string {
  return department ? `${department} – ${company}` : company;
}

export function buildProjectName(shortName: string | null, clientName: string | null): string {
  return shortName && clientName ? `${shortName} – ${clientName}` : shortName ?? clientName ?? "";
}
