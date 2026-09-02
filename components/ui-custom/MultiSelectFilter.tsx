"use client";

import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type MultiSelectOptionGroup =
  | string
  | {
      id: string;
      label: string;
      /** По умолчанию группа скрывает вложенные варианты. */
      collapsible?: boolean;
      /** Позволяет выбрать или снять все варианты группы. */
      selectable?: boolean;
    };

export type MultiSelectOption = {
  value: string;
  label: string;
  group?: MultiSelectOptionGroup;
  /** Приглушённый вариант, например уже завершившийся период. */
  muted?: boolean;
  /** Выделенный вариант, например текущая ISO-неделя. */
  current?: boolean;
};

export type MultiSelectFilterProps = {
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
  /** Ширина popover (например, для длинных названий проектов). */
  popoverClassName?: string;
  /** Классы подписи пункта (например, `whitespace-normal`). */
  optionLabelClassName?: string;
};

export function MultiSelectFilter({
  label,
  options,
  value,
  onChange,
  className,
  popoverClassName,
  optionLabelClassName,
}: MultiSelectFilterProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(() => new Set());
  const valueSet = React.useMemo(() => new Set(value), [value]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setSearch("");
  }

  const triggerLabel = (() => {
    if (value.length === 0) return label;
    if (value.length === 1) {
      const opt = options.find((o) => o.value === value[0]);
      // Пока опции не подгрузились — не светим сырой id (cuid)
      return opt ? `${label}: ${opt.label}` : `${label}: 1`;
    }
    return `${label}: ${value.length}`;
  })();

  function toggle(v: string) {
    if (valueSet.has(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  }

  function toggleGroup(opts: MultiSelectOption[]) {
    const allSelected = opts.every((opt) => valueSet.has(opt.value));
    if (allSelected) {
      onChange(value.filter((item) => !opts.some((opt) => opt.value === item)));
      return;
    }
    onChange([...value, ...opts.filter((opt) => !valueSet.has(opt.value)).map((opt) => opt.value)]);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange([]);
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  // Group options (после фильтрации; пустые группы не попадают)
  const grouped = React.useMemo(() => {
    const hasGroups = filtered.some((o) => o.group);
    if (!hasGroups) return [{ id: "__ungrouped__", group: null as Exclude<MultiSelectOptionGroup, string> | null, opts: filtered }];
    const map = new Map<string, { group: Exclude<MultiSelectOptionGroup, string> | null; opts: MultiSelectOption[] }>();
    for (const opt of filtered) {
      const group =
        typeof opt.group === "string"
          ? { id: opt.group, label: opt.group }
          : opt.group ?? null;
      const id = group?.id ?? "__ungrouped__";
      if (!map.has(id)) map.set(id, { group, opts: [] });
      map.get(id)!.opts.push(opt);
    }
    return Array.from(map.entries()).map(([id, entry]) => ({ id, ...entry }));
  }, [filtered]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 text-xs font-normal whitespace-nowrap",
              value.length > 0 && "border-neutral-400 bg-neutral-50",
              className
            )}
          >
            <span className="truncate max-w-44">{triggerLabel}</span>
            {value.length > 0 ? (
              <span
                role="button"
                tabIndex={0}
                onClick={clear}
                className="ml-1 -mr-1 rounded-sm p-0.5 hover:bg-neutral-200"
              >
                <X className="h-3 w-3" />
              </span>
            ) : (
              <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
            )}
          </Button>
        }
      />
      <PopoverContent className={cn("w-72 p-0", popoverClassName)} align="start">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск..."
          className="h-9 rounded-none border-0 border-b shadow-none focus-visible:ring-0 text-sm"
          autoFocus
        />
        <div className="max-h-72 overflow-y-auto p-1">
          {options.length === 0 && (
            <div className="px-3 py-2 text-xs text-neutral-500">Нет вариантов</div>
          )}
          {options.length > 0 && filtered.length === 0 && (
            <div className="px-3 py-4 text-xs text-neutral-500 text-center">Ничего не найдено</div>
          )}
          {grouped.map(({ id, group, opts }) => {
            const isCollapsed =
              !!group?.collapsible &&
              !search.trim() &&
              !expandedGroups.has(id);
            const allSelected = opts.length > 0 && opts.every((opt) => valueSet.has(opt.value));

            return (
            <React.Fragment key={id}>
              {group && (
                <div className="flex items-center gap-0.5 px-1 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  {group.collapsible && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-5 text-neutral-400 hover:text-neutral-700"
                      aria-label={isCollapsed ? `Развернуть: ${group.label}` : `Свернуть: ${group.label}`}
                      onClick={() => {
                        setExpandedGroups((prev) => {
                          const next = new Set(prev);
                          if (isCollapsed) next.add(id);
                          else next.delete(id);
                          return next;
                        });
                      }}
                    >
                      {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                    </Button>
                  )}
                  {group.selectable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-700"
                      onClick={() => toggleGroup(opts)}
                    >
                      <span
                        className={cn(
                          "grid size-3 place-items-center rounded-[3px] border border-neutral-300",
                          allSelected && "border-primary bg-primary text-primary-foreground",
                        )}
                      >
                        {allSelected && <Check className="size-2.5" />}
                      </span>
                      {group.label}
                    </Button>
                  ) : (
                    <span>{group.label}</span>
                  )}
                </div>
              )}
              {!isCollapsed && opts.map((opt) => {
                const checked = valueSet.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggle(opt.value)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-neutral-100",
                      !optionLabelClassName && "whitespace-nowrap"
                    )}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggle(opt.value)} />
                    <span
                      className={cn(
                        "flex-1 text-left",
                        opt.muted && "text-neutral-400",
                        opt.current && "font-semibold text-neutral-900",
                        optionLabelClassName,
                      )}
                    >
                      {opt.label}
                    </span>
                    {checked && <Check className="h-3 w-3 shrink-0 text-neutral-500" />}
                  </button>
                );
              })}
            </React.Fragment>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
