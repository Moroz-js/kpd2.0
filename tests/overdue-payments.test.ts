import { describe, expect, it } from "vitest";
import { isOverduePayment, overduePaymentTotal } from "@/lib/overdue-payments";

describe("overdue payments", () => {
  it("uses fact date before the plan date", () => {
    expect(isOverduePayment({
      status: "planned",
      plannedPayAt: "2099-01-01T00:00:00.000Z",
      paidAt: "2020-01-01T00:00:00.000Z",
    })).toBe(true);
  });

  it("excludes paid and undated records", () => {
    expect(overduePaymentTotal([
      { status: "paid", plannedPayAt: "2020-01-01", paidAt: null, amount: 100 },
      { status: "planned", plannedPayAt: null, paidAt: null, amount: 200 },
      { status: "planned", plannedPayAt: "2020-01-01", paidAt: null, amount: 300 },
    ])).toBe(300);
  });
});
