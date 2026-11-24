import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CashflowOpeningBalance, parseOpeningDraft } from "@/app/(dashboard)/admin/cashflow/CashflowOpeningBalance";

it("the editable draft preserves the full computed amount, not the rounded cell label", () => {
  expect(parseOpeningDraft("1000,12345", 1000.12345)).toBe(1000.12345);
  expect(parseOpeningDraft("1e-7", 1e-7)).toBe(1e-7);
  expect(parseOpeningDraft("-1\u00a0234,56", 0)).toBe(-1234.56);
  expect(parseOpeningDraft("0", 10)).toBe(0);
});

it("an empty or malformed draft is not a zero or an instruction to clear the override", () => {
  for (const draft of ["", " ", "-", "1.2.3", "NaN", "Infinity", "100 руб."]) {
    expect(parseOpeningDraft(draft, 0)).toBeUndefined();
  }
});

it.each([
  { amount: 0, manual: true, label: "Вручную" },
  { amount: 27.35, manual: false, label: "Авто" },
])("a snapshot displays $amount ($label) without an editor", ({ amount, manual, label }) => {
  const html = renderToStaticMarkup(createElement(CashflowOpeningBalance, {
    year: 2027, amount, manual, readOnly: true, onSaved: async () => { throw new Error("read only"); },
  }));
  expect(html).toContain(amount.toLocaleString("ru-RU"));
  expect(html).toContain(label);
  expect(html).not.toMatch(/<(?:input|button|form)\b/);
});
