import { describe, expect, it } from "vitest";
import {
  getMonthFilterMetadata,
  getWeekFilterMetadata,
} from "../lib/period-filter-options";

const now = new Date(2026, 8, 1); // ISO-неделя 36

describe("метаданные периодов в фильтрах", () => {
  it("выделяет текущую неделю и приглушает прошедшую", () => {
    expect(getWeekFilterMetadata([{ year: 2026, week: 36 }], now)).toMatchObject({
      current: true,
      muted: false,
    });
    expect(getWeekFilterMetadata([{ year: 2026, week: 35 }], now)).toMatchObject({
      current: false,
      muted: true,
    });
  });

  it("сворачивает недели, завершившиеся более четырёх недель назад", () => {
    expect(getWeekFilterMetadata([{ year: 2026, week: 31 }], now).group).toMatchObject({
      id: "past-weeks",
      collapsible: true,
      selectable: true,
    });
    expect(getWeekFilterMetadata([{ year: 2026, week: 32 }], now).group).toBeUndefined();
  });

  it("приглушает только полностью прошедшие месяцы", () => {
    expect(getMonthFilterMetadata([{ year: 2026, month: 8 }], now).muted).toBe(true);
    expect(getMonthFilterMetadata([{ year: 2026, month: 9 }], now).muted).toBe(false);
  });
});
