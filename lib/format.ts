/**
 * Единая точка форматирования денег/дат для UI.
 *
 * Правила (см. TZ-DORABOTKI.md §Глобальные правила):
 * - Деньги: разряды через неразрывный пробел, без знака валюты.
 *   Ровно два знака после запятой («1 234 567,00»).
 * - Дата:   dd.MM.yyyy (28.05.2026), отображение в Europe/Moscow.
 * - Время:  dd.MM.yyyy HH:mm.
 * - Неделя: "Неделя NN" (zero-pad).
 */

const TIMEZONE = "Europe/Moscow";
const LOCALE = "ru-RU";

const moneyFormatter = new Intl.NumberFormat(LOCALE, {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});
const moneyWholeFormatter = new Intl.NumberFormat(LOCALE, {
  style: "decimal",
  maximumFractionDigits: 0,
  useGrouping: true,
});

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return moneyFormatter.format(n).replace(/\s/g, "\u00A0");
}

/** Денежное значение без дробной части для кэшфлоу и дашбордов. */
export function formatMoneyWhole(n: number | null | undefined): string {
  if (n == null) return "—";
  return moneyWholeFormatter.format(n).replace(/\s/g, "\u00A0");
}

/** Сумма с суффиксом «руб.» для агрегатов и итогов в шапке таблиц. */
export function formatMoneyRub(n: number | null | undefined): string {
  const base = formatMoney(n);
  if (base === "—") return base;
  return `${base} руб.`;
}

/** Сумма с кодом валюты (не пересчитывает), например «1 234 567 USD». */
export function formatMoneyWithCurrency(
  n: number | null | undefined,
  currency: string | null | undefined
): string {
  const base = formatMoney(n);
  if (base === "—") return base;
  const code = (currency ?? "RUB").toUpperCase();
  return `${base}\u00A0${code}`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return dateFormatter.format(d);
}

const dateShortFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIMEZONE,
  day: "2-digit",
  month: "2-digit",
});

/** Формат дд.мм — используется когда год вынесен в отдельную колонку/фильтр */
export function formatDateShort(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return dateShortFormatter.format(d);
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return dateTimeFormatter.format(d).replace(",", "");
}

export function weekLabel(week: number | null | undefined): string {
  if (week == null) return "—";
  return `Неделя ${String(week).padStart(2, "0")}`;
}

const MONTH_LABELS = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

const MONTH_FULL = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export function monthLabel(m: number): string {
  return MONTH_LABELS[m - 1] ?? String(m);
}

export function monthFullLabel(m: number): string {
  return MONTH_FULL[m - 1] ?? String(m);
}

// Предложный падеж ("в январе", а не "в Январь") — для фраз вида
// «Выплачено в {месяц}», где именительный падеж грамматически некорректен.
const MONTH_PREPOSITIONAL = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
];

export function monthPrepositionalLabel(m: number): string {
  return MONTH_PREPOSITIONAL[m - 1] ?? String(m);
}

export const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: MONTH_FULL[i],
}));
