import { describe, expect, it } from "vitest";
import {
  formatISOWeekRangeRu,
  getISOWeeksInYear,
  isoWeekEnd,
  isoWeekStart,
} from "../lib/iso-weeks";

describe("ISO-недели", () => {
  it("возвращает понедельник и воскресенье недели", () => {
    const start = isoWeekStart(2026, 31);
    const end = isoWeekEnd(2026, 31);

    expect([
      start.getFullYear(),
      start.getMonth() + 1,
      start.getDate(),
    ]).toEqual([2026, 7, 27]);
    expect([end.getFullYear(), end.getMonth() + 1, end.getDate()]).toEqual([
      2026, 8, 2,
    ]);
  });

  it("форматирует диапазон из примера задачи", () => {
    expect(formatISOWeekRangeRu(2026, 31)).toBe("27 июля – 2 августа");
  });

  it("корректно обрабатывает переход года", () => {
    const start = isoWeekStart(2025, 1);
    const end = isoWeekEnd(2025, 1);

    expect(start.getFullYear()).toBe(2024);
    expect(end.getFullYear()).toBe(2025);
    expect(formatISOWeekRangeRu(2025, 1)).toContain("2024");
    expect(formatISOWeekRangeRu(2025, 1)).toContain("2025");
  });

  it("различает годы с 52 и 53 ISO-неделями", () => {
    expect(getISOWeeksInYear(2025)).toBe(52);
    expect(getISOWeeksInYear(2026)).toBe(53);
  });
});
