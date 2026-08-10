import { describe, expect, it } from "vitest";
import {
  compareExecutorNames,
  isUnknownExecutorName,
} from "../lib/executor-names";

describe("isUnknownExecutorName", () => {
  it.each([
    "Пока не известен",
    " пока НЕ определён ",
    "Пока не определена!",
    "«Пока не известно»",
  ])("распознаёт служебное имя: %s", (name) => {
    expect(isUnknownExecutorName(name)).toBe(true);
  });

  it.each(["Неизвестный", "Исполнитель не определен", "Иван Иванов"])(
    "не принимает обычное имя: %s",
    (name) => {
      expect(isUnknownExecutorName(name)).toBe(false);
    }
  );
});

describe("compareExecutorNames", () => {
  it("ставит служебного исполнителя первым, остальных по алфавиту", () => {
    const names = [
      "Яков",
      "Борис",
      "Пока не определен",
      "Анна",
    ].sort(compareExecutorNames);

    expect(names).toEqual([
      "Пока не определен",
      "Анна",
      "Борис",
      "Яков",
    ]);
  });
});
