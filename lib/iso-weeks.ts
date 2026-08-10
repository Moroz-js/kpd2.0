/**
 * ISO-week утилиты.
 *
 * Принципы:
 * - Используем реальное количество ISO-недель в году (52 или 53). См. TZ §Глобальные правила.
 * - `getISOWeek` совпадает с Excel `ISOWEEKNUM`.
 * - `getISOWeekYear` возвращает год по ISO (важно для 31 декабря / 1 января на стыке).
 */

import {
  getISOWeek as dfGetISOWeek,
  getISOWeekYear as dfGetISOWeekYear,
  getISOWeeksInYear as dfGetISOWeeksInYear,
  setISOWeek,
  setISOWeekYear,
  startOfISOWeek,
  endOfISOWeek,
  addDays,
} from "date-fns";

export function getISOWeek(date: Date | string): number {
  return dfGetISOWeek(typeof date === "string" ? new Date(date) : date);
}

export function getISOWeekYear(date: Date | string): number {
  return dfGetISOWeekYear(typeof date === "string" ? new Date(date) : date);
}

export function getISOWeeksInYear(year: number): number {
  return dfGetISOWeeksInYear(new Date(year, 5, 15)); // любая дата в середине года
}

/** Начало (понедельник) ISO-недели N в году Y. */
export function isoWeekStart(year: number, week: number): Date {
  let d = setISOWeekYear(new Date(year, 5, 15), year);
  d = setISOWeek(d, week);
  return startOfISOWeek(d);
}

/** Конец (воскресенье) ISO-недели N в году Y. */
export function isoWeekEnd(year: number, week: number): Date {
  return endOfISOWeek(isoWeekStart(year, week));
}

/** Диапазон ISO-недели по-русски: «27 июля – 2 августа». */
export function formatISOWeekRangeRu(year: number, week: number): string {
  const start = isoWeekStart(year, week);
  const end = isoWeekEnd(year, week);
  const dayMonth = (date: Date) =>
    date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

  if (start.getFullYear() !== end.getFullYear()) {
    const withYear = (date: Date) =>
      date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    return `${withYear(start)} – ${withYear(end)}`;
  }
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${dayMonth(end)}`;
  }
  return `${dayMonth(start)} – ${dayMonth(end)}`;
}

/** Список номеров недель года: [1..N], где N = getISOWeeksInYear(year). */
export function isoWeeksOfYear(year: number): number[] {
  const total = getISOWeeksInYear(year);
  return Array.from({ length: total }, (_, i) => i + 1);
}

/**
 * Ближайшее «следующее 5 или 20 число» от заданной даты включительно.
 * Используется как default `plannedPayAt` в TDNB-15.
 */
/** Форматирует Date в "YYYY-MM-DD" по локальному времени (без сдвига UTC). */
export function toLocalDateString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function nearestPaymentDate(from: Date = new Date()): Date {
  const d = new Date(from);
  const day = d.getDate();
  // Строго будущее: 5-е или 20-е, которое ещё не наступило
  if (day < 5) return new Date(d.getFullYear(), d.getMonth(), 5);
  if (day < 20) return new Date(d.getFullYear(), d.getMonth(), 20);
  return new Date(d.getFullYear(), d.getMonth() + 1, 5);
}

/** Календарный день YYYY-MM-DD в Europe/Moscow. */
export function moscowDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** true, если дата — сегодня или в будущем по календарю Москвы. */
export function isTodayOrFutureMoscow(date: Date): boolean {
  return moscowDateKey(date) >= moscowDateKey(new Date());
}

/**
 * Плановая дата при проверке: сохраняем существующую, если она сегодня/в будущем (МСК);
 * иначе — nearestPaymentDate().
 */
export function resolvePlannedPayAtOnCheck(existing: Date | null | undefined): Date {
  if (existing && isTodayOrFutureMoscow(existing)) return existing;
  return nearestPaymentDate();
}

/** Форматирует номер недели: "Неделя 01", "Неделя 16". */
export function weekLabel(week: number): string {
  return `Неделя ${String(week).padStart(2, "0")}`;
}

/** Месяц (1-12), которому принадлежит ISO-неделя. */
export function isoWeekToMonth(year: number, week: number): number {
  return isoWeekStart(year, week).getMonth() + 1;
}

/** Удобный массив дней внутри ISO-недели (понедельник → воскресенье). */
export function isoWeekDays(year: number, week: number): Date[] {
  const start = isoWeekStart(year, week);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Сколько полных прошлых ISO-недель показывать в свёрнутом виде (+ текущая и будущие). */
export const PROJECT_DASHBOARD_WEEKS_BACK = 4;
/** Кэшфлоу: текущая неделя и 4 предыдущие → первая видимая = currentWeek − 4. */
export const CASHFLOW_WEEKS_BACK = 4;

/** Первая видимая неделя года при свёрнутых «старых» неделях (дашборд проекта). */
export function firstVisibleDashboardWeek(currentWeek: number): number {
  return Math.max(1, currentWeek - PROJECT_DASHBOARD_WEEKS_BACK);
}

/** Первая видимая неделя в таблице кэшфлоу при свёрнутых «старых» неделях. */
export function firstVisibleCashflowWeek(currentWeek: number): number {
  return Math.max(1, currentWeek - CASHFLOW_WEEKS_BACK);
}

const MONTH_SHORT = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"] as const;

/** Группы ISO-недель по месяцу начала недели (для шапки таблиц). */
export function isoWeekMonthGroups(year: number): { label: string; weeks: number[] }[] {
  const groups: { label: string; weeks: number[] }[] = [];
  for (const w of isoWeeksOfYear(year)) {
    const label = MONTH_SHORT[isoWeekToMonth(year, w) - 1];
    const last = groups[groups.length - 1];
    if (last?.label === label) last.weeks.push(w);
    else groups.push({ label, weeks: [w] });
  }
  return groups;
}

/** ISO-недели, пересекающиеся с диапазоном дат (опционально только для filterYear). */
export function isoWeeksInDateRange(start: Date, end: Date, filterYear?: number): number[] {
  const weeks = new Set<number>();
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endD = new Date(end);
  endD.setHours(0, 0, 0, 0);
  while (cur <= endD) {
    const y = getISOWeekYear(cur);
    if (filterYear === undefined || y === filterYear) {
      weeks.add(getISOWeek(cur));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return Array.from(weeks).sort((a, b) => a - b);
}
