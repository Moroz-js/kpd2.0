import { describe, expect, it } from "vitest";
import {
  getMonthFilterMetadata,
  getWeekFilterMetadata,
} from "../lib/period-filter-options";

const now = new Date(2026, 8, 1); // ISO-неделя 36

describe("метаданные периодов в фильтрах", () => {
  it("выделяет только текущую неделю", () => {
    expect(getWeekFilterMetadata([{ year: 2026, week: 36 }], now)).toEqual({
      current: true,
    });
    expect(getWeekFilterMetadata([{ year: 2026, week: 35 }], now)).toEqual({
      current: false,
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

  it("выделяет только текущий месяц", () => {
    expect(getMonthFilterMetadata([{ year: 2026, month: 8 }], now)).toEqual({
      current: false,
    });
    expect(getMonthFilterMetadata([{ year: 2027, month: 9 }], now)).toEqual({
      current: true,
    });
  });
});
