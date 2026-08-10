"use client";

import * as React from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { WORK_TYPE_SEGMENTS } from "@/lib/statuses";

export type WorkTypeSelectOption = {
  id: string;
  name: string;
  segment?: string;
  status?: string;
};

export type WorkTypesMultiSelectProps = {
  options: WorkTypeSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
};

const SEGMENT_ORDER = new Map(WORK_TYPE_SEGMENTS.map((s, i) => [s, i]));

function optionLabel(opt: WorkTypeSelectOption): string {
  return opt.status === "archived" ? `${opt.name} (архив)` : opt.name;
}

export function WorkTypesMultiSelect({
  options,
  value,
  onChange,
  placeholder = "Выберите виды работ",
  className,
}: WorkTypesMultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setSearch("");
  }

  const valueSet = React.useMemo(() => new Set(value), [value]);

  const sortedOptions = React.useMemo(() => {
    return [...options].sort((a, b) => {
      const sa = SEGMENT_ORDER.get(a.segment as (typeof WORK_TYPE_SEGMENTS)[number]) ?? 999;
      const sb = SEGMENT_ORDER.get(b.segment as (typeof WORK_TYPE_SEGMENTS)[number]) ?? 999;
      if (sa !== sb) return sa - sb;
      if (sa === 999 && (a.segment ?? "") !== (b.segment ?? "")) {
        return (a.segment ?? "").localeCompare(b.segment ?? "", "ru");
      }
      return a.name.localeCompare(b.name, "ru");
    });
  }, [options]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedOptions;
    return sortedOptions.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.segment?.toLowerCase().includes(q) ?? false)
    );
  }, [sortedOptions, search]);

  const grouped = React.useMemo(() => {
    const hasGroups = filtered.some((o) => o.segment);
    if (!hasGroups) return [{ group: null as string | null, opts: filtered }];
    const map = new Map<string, WorkTypeSelectOption[]>();
    for (const opt of filtered) {
      const g = opt.segment ?? "";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(opt);
    }
    const entries = Array.from(map.entries()).sort(([a], [b]) => {
      const ia = SEGMENT_ORDER.get(a as (typeof WORK_TYPE_SEGMENTS)[number]) ?? 999;
      const ib = SEGMENT_ORDER.get(b as (typeof WORK_TYPE_SEGMENTS)[number]) ?? 999;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b, "ru");
    });
    return entries.map(([group, opts]) => ({ group: group || null, opts }));
  }, [filtered]);

  const triggerLabel = (() => {
    if (value.length === 0) return placeholder;
    if (value.length === 1) {
      const opt = options.find((o) => o.id === value[0]);
      return opt ? optionLabel(opt) : placeholder;
    }
    return `${value.length} выбрано`;
  })();

  function toggle(id: string) {
    if (valueSet.has(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange([]);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className={cn(
              "w-full h-9 justify-between font-normal text-sm",
              value.length > 0 && "border-neutral-400 bg-neutral-50",
              className
            )}
          >
            <span className="truncate text-left">{triggerLabel}</span>
            {value.length > 0 ? (
              <span
                role="button"
                tabIndex={0}
                onClick={clear}
                onKeyDown={(e) => e.key === "Enter" && clear(e as unknown as React.MouseEvent)}
                className="ml-1 shrink-0 rounded-sm p-0.5 hover:bg-neutral-200"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : (
              <ChevronDown className="ml-1 h-4 w-4 shrink-0 opacity-60" />
            )}
          </Button>
        }
      />
      <PopoverContent className="w-80 p-0" align="start">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск..."
          className="h-9 rounded-none border-0 border-b shadow-none focus-visible:ring-0 text-sm"
          autoFocus
        />
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-xs text-neutral-500 text-center">Ничего не найдено</div>
          )}
          {grouped.map(({ group, opts }) => (
            <React.Fragment key={group ?? "__ungrouped__"}>
              {group && (
                <div className="px-2 pt-2 pb-0.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">
                  {group}
                </div>
              )}
              {opts.map((opt) => {
                const checked = valueSet.has(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggle(opt.id)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-neutral-100"
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggle(opt.id)} />
                    <span className="flex-1 text-left">{optionLabel(opt)}</span>
                    {checked && <Check className="h-3 w-3 shrink-0 text-neutral-500" />}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
