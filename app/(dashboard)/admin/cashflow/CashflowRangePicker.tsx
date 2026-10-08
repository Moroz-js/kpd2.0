"use client";

import * as React from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FilterResetButton } from "@/components/ui-custom/FilterResetButton";
import { cn } from "@/lib/utils";
import {
  defaultCashflowRange,
  MAX_CASHFLOW_RANGE_MONTHS,
  rangeMonths,
  type CashflowRange,
} from "@/lib/cashflow-range";

const MONTHS_SHORT = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

function MonthYearPicker({
  year,
  month,
  onChange,
}: {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [viewYear, setViewYear] = React.useState(year);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setViewYear(year);
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="h-10 w-44 justify-between text-sm font-normal">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 opacity-60" />
              {MONTHS_SHORT[month - 1]} {year}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
          </Button>
        }
      />
      <PopoverContent className="w-72 p-3" align="start">
        <div className="mb-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0"
            onClick={() => setViewYear((y) => y - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-base font-medium tabular-nums">{viewYear}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0"
            onClick={() => setViewYear((y) => y + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {MONTHS_SHORT.map((label, i) => {
            const selected = viewYear === year && i + 1 === month;
            return (
              <Button
                key={label}
                type="button"
                size="sm"
                variant={selected ? "default" : "ghost"}
                className={cn("h-10 text-sm font-normal", selected && "font-medium")}
                onClick={() => {
                  onChange(viewYear, i + 1);
                  setOpen(false);
                }}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CashflowRangePicker({
  range,
  onChange,
}: {
  range: CashflowRange;
  onChange: (range: CashflowRange) => void;
}) {
  const isDefault = (() => {
    const d = defaultCashflowRange();
    return (
      d.fromYear === range.fromYear && d.fromMonth === range.fromMonth &&
      d.toYear === range.toYear && d.toMonth === range.toMonth
    );
  })();

  // Если «с» оказалась позже «по» — сдвигаем вторую границу, чтобы период не пропадал.
  function update(next: CashflowRange, changed: "from" | "to") {
    const fromIdx = next.fromYear * 12 + next.fromMonth;
    const toIdx = next.toYear * 12 + next.toMonth;
    if (fromIdx > toIdx) {
      next = changed === "from"
        ? { ...next, toYear: next.fromYear, toMonth: next.fromMonth }
        : { ...next, fromYear: next.toYear, fromMonth: next.toMonth };
    }
    if (rangeMonths(next) > MAX_CASHFLOW_RANGE_MONTHS) return;
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-neutral-500">С</span>
      <MonthYearPicker
        year={range.fromYear}
        month={range.fromMonth}
        onChange={(y, m) => update({ ...range, fromYear: y, fromMonth: m }, "from")}
      />
      <span className="text-sm text-neutral-500">по</span>
      <MonthYearPicker
        year={range.toYear}
        month={range.toMonth}
        onChange={(y, m) => update({ ...range, toYear: y, toMonth: m }, "to")}
      />
      <FilterResetButton active={!isDefault} onClick={() => onChange(defaultCashflowRange())} />
    </div>
  );
}
