"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type DepartmentComboboxProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  onAddOption: (value: string) => void;
  onRemoveOption?: (value: string) => void;
  id?: string;
  placeholder?: string;
};

export function DepartmentCombobox({
  value,
  onValueChange,
  options,
  onAddOption,
  onRemoveOption,
  id,
  placeholder = "Выберите или введите...",
}: DepartmentComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setSearch("");
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((d) => d.toLowerCase().includes(q));
  }, [options, search]);

  const canCreate =
    search.trim().length > 0 &&
    !options.some((d) => d.toLowerCase() === search.trim().toLowerCase());

  function selectDepartment(d: string) {
    onValueChange(d);
    setOpen(false);
  }

  function createDepartment() {
    const name = search.trim();
    if (!name) return;
    onAddOption(name);
    onValueChange(name);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        id={id}
        render={
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between font-normal h-8"
          />
        }
      >
        <span className={cn("truncate", !value && "text-muted-foreground")}>
          {value || placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-[16rem] p-0" align="start">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск или новый..."
          className="h-9 rounded-none border-0 border-b shadow-none focus-visible:ring-0"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (canCreate) createDepartment();
              else if (filtered.length === 1) selectDepartment(filtered[0]!);
            }
          }}
        />
        <div className="max-h-52 overflow-y-auto p-1">
          {filtered.length === 0 && !canCreate && (
            <p className="px-2 py-3 text-xs text-muted-foreground text-center">Ничего не найдено</p>
          )}
          {filtered.map((d) => (
              <div
                key={d}
                className="group flex w-full items-center rounded-md hover:bg-accent"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-sm hover:text-accent-foreground"
                  onClick={() => selectDepartment(d)}
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      value === d ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate text-left">{d}</span>
                </button>
                {onRemoveOption && (
                  <button
                    type="button"
                    title="Удалить"
                    className="mr-1 shrink-0 rounded p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveOption(d);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          {canCreate && (
            <button
              type="button"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-blue-600 hover:bg-accent"
              onClick={createDepartment}
            >
              Создать «{search.trim()}»
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
