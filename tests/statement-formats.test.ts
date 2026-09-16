import { describe, expect, it } from "vitest";
import {
  determineOperationKind,
  resolveStatementFormat,
  statementFieldLabels,
} from "../lib/statement-formats";

describe("resolveStatementFormat", () => {
  it("принимает ru / kz / me и иначе возвращает ru", () => {
    expect(resolveStatementFormat("kz")).toBe("kz");
    expect(resolveStatementFormat("me")).toBe("me");
    expect(resolveStatementFormat("unknown")).toBe("ru");
    expect(resolveStatementFormat(null)).toBe("ru");
  });
});

describe("determineOperationKind", () => {
  it("для России читает поступление и списание из типа операции", () => {
    expect(determineOperationKind("ru", { operationType: "Поступление" })).toBe("incoming");
    expect(determineOperationKind("ru", { operationType: "списание" })).toBe("outgoing");
  });

  it("для Казахстана читает Дт / Кт", () => {
    expect(determineOperationKind("kz", { operationType: "Кт" })).toBe("incoming");
    expect(determineOperationKind("kz", { operationType: "Дт 2020" })).toBe("outgoing");
  });

  it("для Черногории читает uplata / isplata", () => {
    expect(determineOperationKind("me", { operationType: "Uplata" })).toBe("incoming");
    expect(determineOperationKind("me", { operationType: "Isplata" })).toBe("outgoing");
  });

  it("если тип неизвестен, смотрит на знак суммы", () => {
    expect(determineOperationKind("ru", { operationType: "", amount: "-1500" })).toBe("outgoing");
    expect(determineOperationKind("kz", { amount: "12 000,00" })).toBe("incoming");
  });

  it("не угадывает ветку без признаков", () => {
    expect(determineOperationKind("me", { operationType: "", amount: null })).toBeNull();
  });

  it("короткий маркер не срабатывает внутри длинного слова", () => {
    expect(determineOperationKind("ru", { operationType: "документы" })).toBeNull();
  });
});

describe("statementFieldLabels", () => {
  it("подписывает поля формата", () => {
    expect(statementFieldLabels("kz").account).toBe("ИИК");
    expect(statementFieldLabels("me").bic).toBe("SWIFT");
    expect(statementFieldLabels("ru").taxId).toBe("ИНН");
  });
});
