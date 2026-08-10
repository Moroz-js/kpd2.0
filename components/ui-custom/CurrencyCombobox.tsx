"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isValidCurrencyCode, normalizeCurrencyCode } from "@/lib/currencies";

export type CurrencyComboboxProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  onAddOption: (value: string) => void;
  id?: string;
  disabled?: boolean;
};

export function CurrencyCombobox({
  value,
  onValueChange,
  options,
  onAddOption,
  id,
  disabled,
}: CurrencyComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setSearch("");
  }

  const normalized = search.trim().toUpperCase();

  const filtered = React.useMemo(() => {
    if (!normalized) return options;
    return options.filter((c) => c.toUpperCase().includes(normalized));
  }, [options, normalized]);

  const canCreate =
    normalized.length >= 3 &&
    isValidCurrencyCode(normalized) &&
    !options.some((c) => c.toUpperCase() === normalized);

  function select(code: string) {
    onValueChange(code);
    setOpen(false);
  }

  function create() {
    const code = normalizeCurrencyCode(search);
    if (!code) return;
    onAddOption(code);
    onValueChange(code);
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
            disabled={disabled}
            className="w-full justify-between font-normal h-8"
          />
        }
      >
        <span className={cn("truncate font-mono tracking-wider", !value && "text-muted-foreground")}>
          {value || "Выберите..."}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-[12rem] p-0" align="start">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value.toUpperCase())}
          placeholder="Поиск или код (напр. CHF)..."
          className="h-9 rounded-none border-0 border-b shadow-none focus-visible:ring-0 font-mono uppercase"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (canCreate) create();
              else if (filtered.length === 1) select(filtered[0]!);
            }
          }}
        />
        <div className="max-h-48 overflow-y-auto p-1">
          {filtered.length === 0 && !canCreate && (
            <p className="px-2 py-3 text-xs text-muted-foreground text-center">
              Нет совпадений. Введите 3+ букв для создания.
            </p>
          )}
          {filtered.map((code) => (
            <button
              key={code}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              onClick={() => select(code)}
            >
              <Check className={cn("h-4 w-4 shrink-0", value === code ? "opacity-100" : "opacity-0")} />
              <span className="font-mono tracking-wider">{code}</span>
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-blue-600 hover:bg-accent"
              onClick={create}
            >
              Добавить валюту «{normalized}»
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
