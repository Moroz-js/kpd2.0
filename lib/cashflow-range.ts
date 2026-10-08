import { isoWeekStart, toLocalDateString } from "@/lib/iso-weeks";

/** Период кэшфлоу по месяцам, обе границы включительно. month: 1–12. */
export type CashflowRange = {
  fromYear: number;
  fromMonth: number;
  toYear: number;
  toMonth: number;
};

/** По умолчанию: с 1 декабря прошлого года до 31 декабря текущего. */
export function defaultCashflowRange(now = new Date()): CashflowRange {
  const year = now.getFullYear();
  return { fromYear: year - 1, fromMonth: 12, toYear: year, toMonth: 12 };
}

export function formatMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseMonthKey(value: string | null | undefined): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2200) return null;
  return { year, month };
}

export function rangeToQuery(range: CashflowRange): string {
  return `from=${formatMonthKey(range.fromYear, range.fromMonth)}&to=${formatMonthKey(range.toYear, range.toMonth)}`;
}

/** Читает from/to (YYYY-MM); при ошибке или пустых значениях — период по умолчанию. */
export function parseCashflowRange(
  from: string | null | undefined,
  to: string | null | undefined,
  now = new Date()
): CashflowRange {
  const f = parseMonthKey(from);
  const t = parseMonthKey(to);
  if (!f || !t) return defaultCashflowRange(now);
  if (f.year * 12 + f.month > t.year * 12 + t.month) return defaultCashflowRange(now);
  return { fromYear: f.year, fromMonth: f.month, toYear: t.year, toMonth: t.month };
}

/** Не даём запросить слишком длинный период. */
export const MAX_CASHFLOW_RANGE_MONTHS = 60;

export function rangeMonths(range: CashflowRange): number {
  return (range.toYear - range.fromYear) * 12 + (range.toMonth - range.fromMonth) + 1;
}

/** Первый день периода и последний день периода в формате YYYY-MM-DD. */
export function rangeBounds(range: CashflowRange): { start: string; end: string } {
  return {
    start: toLocalDateString(new Date(range.fromYear, range.fromMonth - 1, 1)),
    end: toLocalDateString(new Date(range.toYear, range.toMonth, 0)),
  };
}

/** Неделя попадает в период, если хотя бы один её день внутри периода. */
export function isWeekInRange(year: number, week: number, range: CashflowRange): boolean {
  const { start, end } = rangeBounds(range);
  const weekStart = isoWeekStart(year, week);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return toLocalDateString(weekEnd) >= start && toLocalDateString(weekStart) <= end;
}

/** Календарные годы, которые нужно посчитать, чтобы покрыть период. */
export function rangeYears(range: CashflowRange): number[] {
  const years: number[] = [];
  for (let y = range.fromYear - 1; y <= range.toYear + 1; y += 1) years.push(y);
  return years;
}
