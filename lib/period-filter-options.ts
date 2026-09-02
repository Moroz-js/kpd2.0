import {
  getISOWeek,
  getISOWeekYear,
  isoWeekEnd,
  isoWeekStart,
} from "@/lib/iso-weeks";

export type PeriodFilterGroup = {
  id: string;
  label: string;
  collapsible?: boolean;
  selectable?: boolean;
};

export type PeriodFilterOptionMetadata = {
  muted?: boolean;
  current?: boolean;
  group?: PeriodFilterGroup;
};

type WeekPeriod = { year: number; week: number };
type MonthPeriod = { year: number; month: number };

export const PAST_WEEKS_GROUP: PeriodFilterGroup = {
  id: "past-weeks",
  label: "Прошедшие недели",
  collapsible: true,
  selectable: true,
};

/** Метаданные отображения периода в общих фильтрах. */
export function getWeekFilterMetadata(
  periods: WeekPeriod[],
  now: Date = new Date(),
): PeriodFilterOptionMetadata {
  if (periods.length === 0) return {};

  const currentYear = getISOWeekYear(now);
  const currentWeek = getISOWeek(now);
  const currentWeekStart = isoWeekStart(currentYear, currentWeek);
  const fourWeeksAgo = new Date(currentWeekStart);
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  const current = periods.some(
    ({ year, week }) => year === currentYear && week === currentWeek,
  );
  const muted = periods.every(
    ({ year, week }) => isoWeekEnd(year, week) < currentWeekStart,
  );
  const olderThanFourWeeks = periods.every(
    ({ year, week }) => isoWeekEnd(year, week) < fourWeeksAgo,
  );

  return {
    muted,
    current,
    ...(olderThanFourWeeks ? { group: PAST_WEEKS_GROUP } : {}),
  };
}

/** Метаданные отображения месяцев в общих фильтрах. */
export function getMonthFilterMetadata(
  periods: MonthPeriod[],
  now: Date = new Date(),
): PeriodFilterOptionMetadata {
  if (periods.length === 0) return {};

  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    muted: periods.every(
      ({ year, month }) => new Date(year, month - 1, 1) < currentMonthStart,
    ),
  };
}
