"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { SectionChevron } from "@/components/ui-custom/CollapsibleSection";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type GroupByOption = { value: string; label: string };

export type FlatGroupItem<T> =
  | { kind: "group"; key: string; label: string; count: number; sum: number; collapsed: boolean }
  | { kind: "row"; row: T; groupKey: string };

export function GroupBySelect({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: GroupByOption[];
  className?: string;
}) {
  const selectedLabel =
    value === ""
      ? "Без группировки"
      : (options.find((o) => o.value === value)?.label ?? "Без группировки");

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-xs text-neutral-500 whitespace-nowrap">Группировка</span>
      <Select value={value} onValueChange={(v) => onChange(v ?? "")}>
        <SelectTrigger
          size="sm"
          className={cn(
            // Как MultiSelectFilter (Button size=sm + h-8): одинаковая высота/паддинг/иконка
            "h-8 data-[size=sm]:h-8 py-0 px-2.5 text-xs font-normal",
            "min-w-[140px] rounded-md border-neutral-200 bg-white shadow-none",
            "hover:bg-neutral-50 focus-visible:ring-0 focus-visible:border-neutral-300",
            "[&_svg:not([class*='size-'])]:size-3.5",
            value !== "" && "border-neutral-400 bg-neutral-50",
          )}
        >
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">Без группировки</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div
        aria-hidden
        className="mx-1 h-6 w-px shrink-0 self-center bg-neutral-200"
      />
    </div>
  );
}

export function GroupHeaderRow({
  label,
  count,
  sum,
  collapsed,
  onToggle,
  colSpan,
  /** @deprecated Всегда прилипает слева; оставлен для совместимости вызовов */
  stickyFirstCell: _stickyFirstCell,
}: {
  label: string;
  count: number;
  sum: number;
  collapsed: boolean;
  onToggle: () => void;
  colSpan: number;
  stickyFirstCell?: boolean;
}) {
  return (
    <TableRow className="bg-neutral-100 hover:bg-neutral-100 font-medium">
      {/*
        sticky нельзя вешать на colspan-ячейку на всю ширину таблицы:
        она равна области скролла, и left:0 не удерживает контент.
        Прилипает узкий внутренний блок (w-max).

        z-index ниже, чем у TableHead (z-10, sticky top-0): обе кнопки — position:sticky
        в одном контексте наложения, поэтому без этого заголовок группы при вертикальном
        скролле оказывался бы поверх шапки таблицы в момент, когда строка группы проходит
        под прилипшей шапкой. Значение ниже z-10 гарантирует, что шапка таблицы всегда
        перекрывает заголовок группы, а не наоборот.
      */}
      <TableCell colSpan={colSpan} className="bg-neutral-100 p-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="sticky left-0 z-[5] flex w-max max-w-[min(42rem,calc(100vw-14rem))] items-center gap-2 border-r border-neutral-200 bg-neutral-100 py-1.5 pl-2 pr-4 text-left text-xs text-neutral-800 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] select-none"
        >
          <SectionChevron expanded={!collapsed} />
          <span className="truncate" title={label}>
            {label}
          </span>
          <span className="tabular-nums text-neutral-500 shrink-0">{count}</span>
          <span className="tabular-nums text-neutral-700 shrink-0">
            {formatMoney(sum)}
          </span>
        </button>
      </TableCell>
    </TableRow>
  );
}

export type GroupBucket<T> = { key: string; label: string; rows: T[] };

/** Группирует строки: сортирует внутри групп и сами группы (если переданы компараторы). */
export function buildGroupedFlatList<T>(
  rows: T[],
  getKey: (r: T) => string,
  getLabel: (r: T) => string,
  getAmount: (r: T) => number,
  collapsedKeys: Set<string>,
  options?: {
    compareRows?: (a: T, b: T) => number;
    compareGroups?: (a: GroupBucket<T>, b: GroupBucket<T>) => number;
  }
): FlatGroupItem<T>[] {
  const groups = new Map<string, { label: string; rows: T[]; sum: number }>();

  for (const row of rows) {
    const key = getKey(row);
    let g = groups.get(key);
    if (!g) {
      g = { label: getLabel(row), rows: [], sum: 0 };
      groups.set(key, g);
    }
    g.rows.push(row);
    g.sum += getAmount(row);
  }

  const buckets: GroupBucket<T>[] = Array.from(groups.entries()).map(([key, g]) => ({
    key,
    label: g.label,
    rows: g.rows,
  }));

  if (options?.compareRows) {
    for (const b of buckets) {
      b.rows.sort(options.compareRows);
    }
  }

  if (options?.compareGroups) {
    buckets.sort(options.compareGroups);
  }

  const result: FlatGroupItem<T>[] = [];
  for (const b of buckets) {
    const g = groups.get(b.key)!;
    const collapsed = collapsedKeys.has(b.key);
    result.push({
      kind: "group",
      key: b.key,
      label: b.label,
      count: b.rows.length,
      sum: g.sum,
      collapsed,
    });
    if (!collapsed) {
      for (const row of b.rows) {
        result.push({ kind: "row", row, groupKey: b.key });
      }
    }
  }
  return result;
}

/** Стабильный порядок групп по ключу; `__empty__` в конце. */
export function compareGroupKeys(a: string, b: string, dir: "asc" | "desc" = "asc"): number {
  if (a === "__empty__" && b === "__empty__") return 0;
  if (a === "__empty__") return 1;
  if (b === "__empty__") return -1;
  const cmp = a.localeCompare(b, "ru", { numeric: true });
  return dir === "asc" ? cmp : -cmp;
}

/** Стабильный порядок групп по подписи; «Не указано» в конце. */
export function compareGroupLabels(a: string, b: string, dir: "asc" | "desc" = "asc"): number {
  if (a === "Не указано" && b === "Не указано") return 0;
  if (a === "Не указано") return 1;
  if (b === "Не указано") return -1;
  const cmp = a.localeCompare(b, "ru", { numeric: true });
  return dir === "asc" ? cmp : -cmp;
}
