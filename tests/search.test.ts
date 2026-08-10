import { describe, expect, it } from "vitest";
import { matchesSearchText, normalizeSearch } from "../lib/search";

describe("normalizeSearch", () => {
  it("обрезает пробелы и приводит запрос к нижнему регистру", () => {
    expect(normalizeSearch("  GooGLE  ")).toBe("google");
  });
});

describe("matchesSearchText", () => {
  it("ищет по подстроке, а не только по началу", () => {
    expect(matchesSearchText("копыта", "Рога и копыта")).toBe(true);
  });

  it("не зависит от регистра", () => {
    expect(matchesSearchText("goo", "Google Ads")).toBe(true);
  });

  it("учитывает дополнительный searchText", () => {
    expect(
      matchesSearchText("з001", "Оплата услуг", "З001 · Оплата услуг")
    ).toBe(true);
  });

  it("возвращает все варианты для пустого запроса", () => {
    expect(matchesSearchText("   ", "Любое значение")).toBe(true);
  });

  it("не находит отсутствующую подстроку", () => {
    expect(matchesSearchText("яндекс", "Google Ads")).toBe(false);
  });
});
