import { describe, expect, it } from "vitest";
import { calculateCashflowBalances } from "../lib/cashflow-balance";

const baseInput = {
  openingBalance: 100,
  income: [20, 0, 10],
  expenseDP: [5, 10, 0],
  expenseBudget: [10, 10, 10],
  manualBalance: [null, null, null],
};

describe("calculateCashflowBalances", () => {
  it("строит стандартные независимые цепочки ДП и смет", () => {
    const result = calculateCashflowBalances(baseInput);

    expect(result.balanceStartDP).toEqual([100, 115, 105]);
    expect(result.balanceEndDP).toEqual([115, 105, 115]);
    expect(result.balanceEndBudget).toEqual([110, 100, 100]);
  });

  it("применяет ручной баланс только со следующей недели", () => {
    const result = calculateCashflowBalances({
      ...baseInput,
      manualBalance: [200, null, null],
    });

    expect(result.balanceEndDP[0]).toBe(115);
    expect(result.balanceStartDP).toEqual([100, 200, 190]);
    expect(result.balanceEndDP).toEqual([115, 190, 200]);
  });

  it("считает ноль явным ручным значением", () => {
    const result = calculateCashflowBalances({
      ...baseInput,
      manualBalance: [0, null, null],
    });

    expect(result.balanceStartDP[1]).toBe(0);
    expect(result.balanceEndDP[1]).toBe(-10);
  });

  it("не применяет ручной баланс к линии смет", () => {
    const standard = calculateCashflowBalances(baseInput);
    const overridden = calculateCashflowBalances({
      ...baseInput,
      manualBalance: [500, 700, null],
    });

    expect(overridden.balanceEndBudget).toEqual(standard.balanceEndBudget);
  });

  it("следующий override заменяет предыдущую цепочку", () => {
    const result = calculateCashflowBalances({
      ...baseInput,
      manualBalance: [200, 50, null],
    });

    expect(result.balanceStartDP).toEqual([100, 200, 50]);
    expect(result.balanceEndDP).toEqual([115, 190, 60]);
  });

  it("отклоняет массивы разной длины", () => {
    expect(() =>
      calculateCashflowBalances({
        ...baseInput,
        expenseDP: [1],
      })
    ).toThrow("одинаковую длину");
  });
});
