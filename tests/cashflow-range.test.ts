import { describe, expect, it } from "vitest";
import { buildCashflowRange } from "@/lib/services/cashflow";
import { defaultCashflowRange, isWeekInRange } from "@/lib/cashflow-range";

const empty = {
  charges: [], works: [], otherExpenses: [], planLines: [], openingBalances: [],
  manualBalances: [], activeProjects: [], reconciliations: [],
};

describe("cashflow range", () => {
  it("по умолчанию: с 1 дек прошлого года по 31 дек текущего", () => {
    expect(defaultCashflowRange(new Date(2026, 9, 8))).toEqual({
      fromYear: 2025, fromMonth: 12, toYear: 2026, toMonth: 12,
    });
  });

  it("месяцы включительно: март 2025 – февраль 2026", () => {
    const range = { fromYear: 2025, fromMonth: 3, toYear: 2026, toMonth: 2 };
    const data = buildCashflowRange(empty, range, new Date(2025, 5, 1));
    const first = data.weeks[0];
    const last = data.weeks[data.weeks.length - 1];
    expect(first).toMatchObject({ year: 2025, week: 9 }); // 24 фев – 2 мар содержит 1 марта
    expect(last).toMatchObject({ year: 2026, week: 9 }); // 23 фев – 1 мар содержит 28 фев
    expect(isWeekInRange(2025, 8, range)).toBe(false);
    expect(isWeekInRange(2026, 10, range)).toBe(false);
    expect(data.summary.balanceStart).toHaveLength(data.weeks.length);
  });
});
