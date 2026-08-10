import { describe, expect, it } from "vitest";
import { mergeSpendingPlanValues } from "../lib/spending-plan";

const duplicateRows = [
  { amount: 100, comment: null, sourceType: null },
  { amount: 200, comment: "Сохранить", sourceType: "personal" },
];

describe("mergeSpendingPlanValues", () => {
  it("заменяет сумму всех дублей явным нулём", () => {
    expect(
      mergeSpendingPlanValues(duplicateRows, { amount: 0 })
    ).toEqual({
      amount: 0,
      comment: "Сохранить",
      sourceType: "personal",
    });
  });

  it("сохраняет общую сумму дублей при изменении комментария", () => {
    expect(
      mergeSpendingPlanValues(duplicateRows, { comment: "Новый комментарий" })
    ).toEqual({
      amount: 300,
      comment: "Новый комментарий",
      sourceType: "personal",
    });
  });

  it("очищает комментарий через null", () => {
    expect(
      mergeSpendingPlanValues(duplicateRows, { comment: null })
    ).toMatchObject({
      amount: 300,
      comment: null,
    });
  });
});
