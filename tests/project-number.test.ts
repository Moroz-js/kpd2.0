import { describe, expect, it } from "vitest";
import {
  formatProjectNumber,
  isNumberedProjectType,
} from "../lib/project-number";

describe("formatProjectNumber", () => {
  it("форматирует внутренний проект", () => {
    expect(formatProjectNumber("internal", 1)).toBe("ПВ.001");
  });

  it("форматирует клиентский проект с тем же глобальным serial", () => {
    expect(formatProjectNumber("client", 2)).toBe("ПК.002");
  });

  it("не обрезает serial после 999", () => {
    expect(formatProjectNumber("client", 1000)).toBe("ПК.1000");
  });

  it.each([0, -1, 1.5])("отклоняет некорректный serial %s", (serial) => {
    expect(() => formatProjectNumber("internal", serial)).toThrow(
      "положительным целым"
    );
  });
});

describe("isNumberedProjectType", () => {
  it.each(["internal", "client"])("принимает тип %s", (type) => {
    expect(isNumberedProjectType(type)).toBe(true);
  });

  it.each(["unknown", "", "internal-project"])("отклоняет тип %s", (type) => {
    expect(isNumberedProjectType(type)).toBe(false);
  });
});
