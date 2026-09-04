"use client";

import * as React from "react";

type Filter<Row> = {
  key: string;
  value: string[];
  setValue: React.Dispatch<React.SetStateAction<string[]>>;
  matches: (row: Row, value: string[]) => boolean;
  values: (row: Row) => string[];
  /**
   * Год (тот же фильтр, что не трогает кнопка «Снять фильтры» и который задан
   * по умолчанию текущим годом) не должен автоматически обнуляться, если для
   * выбранной комбинации других фильтров нет данных именно в этом году —
   * иначе выбор, например, месяца тихо «слетает» на другой год без данных о
   * произошедшем. Список опций для такого фильтра всё равно сужается через
   * возвращаемый `available`, только сам выбор не сбрасывается автоматически.
   */
  protectedFromAutoClear?: boolean;
};

/**
 * Для каждого фильтра оставляет значения, совместимые со всеми остальными,
 * и убирает выбранные варианты, для которых больше не осталось строк.
 */
export function useCompatibleFilterOptions<Row>(
  rows: Row[] | undefined,
  filters: Filter<Row>[]
) {
  const available = React.useMemo(() => {
    const result: Record<string, Set<string>> = {};
    if (!rows) return result;

    for (const filter of filters) {
      const values = new Set<string>();
      for (const row of rows) {
        if (
          filters.every(
            (other) => other.key === filter.key || other.matches(row, other.value)
          )
        ) {
          for (const value of filter.values(row)) values.add(value);
        }
      }
      result[filter.key] = values;
    }
    return result;
  }, [filters, rows]);

  React.useEffect(() => {
    // rows пуст, пока данные не загрузились (многие клиенты передают `data ?? []`);
    // в этот момент "нет совместимых значений" ложно совпадает с "нет данных вообще" —
    // не сбрасываем уже выбранные (в т.ч. из URL) значения фильтров до реальной загрузки.
    if (!rows || rows.length === 0) return;
    for (const filter of filters) {
      if (filter.protectedFromAutoClear) continue;
      const valid = available[filter.key] ?? new Set<string>();
      const next = filter.value.filter((value) => valid.has(value));
      if (next.length !== filter.value.length) filter.setValue(next);
    }
  }, [available, filters, rows]);

  return available;
}
