"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const editText = (amount: number) => String(amount).replace(".", ",");

export function parseOpeningDraft(draft: string, initial: number): number | undefined {
  // Keep the full server amount, even when the compact label rounded it for display.
  if (draft === editText(initial)) return initial;
  const normalized = draft.replace(/\s/g, "").replace(",", ".");
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return undefined;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : undefined;
}

export function CashflowOpeningBalance({ year, amount, manual, readOnly, onSaved }: {
  year: number;
  amount: number;
  manual: boolean | null;
  readOnly: boolean;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const pending = useRef(false);
  const source = manual === null ? "Источник неизвестен" : manual ? "Вручную" : "Авто";
  const label = <>{money.format(amount)} <span className="text-[10px] text-neutral-500">{source}</span></>;
  if (readOnly || manual === null) return <span title={`${source}: ${editText(amount)}`}>{label}</span>;

  const parsed = parseOpeningDraft(draft, amount);
  async function save(next: number | null) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if (!needsRefresh) {
        const response = await fetch("/api/cashflow/opening-balance", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year, amount: next }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error ?? "Не удалось сохранить баланс");
        }
        setNeedsRefresh(true);
      }
      try {
        await onSaved();
        setNeedsRefresh(false);
        setOpen(false);
        toast.success("Баланс обновлён");
      } catch {
        toast.error("Баланс сохранён, но не удалось обновить данные. Повторите загрузку.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить баланс");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={(next) => {
      if (busy) return;
      if (next) setDraft(editText(amount));
      setOpen(next);
    }}>
      <PopoverTrigger render={<button type="button" className="cursor-pointer rounded px-1 text-right hover:bg-neutral-100" />} title={`Изменить баланс на начало ${year} года`}>
        {label}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-64 space-y-2 p-3 text-xs">
        <p className="font-medium">Баланс на начало {year} года</p>
        {needsRefresh ? (
          <button type="button" disabled={busy} className="text-blue-600 underline" onClick={() => void save(null)}>Обновить данные</button>
        ) : (
          <form className="space-y-2" onSubmit={(event) => {
            event.preventDefault();
            if (parsed !== undefined && (!manual || parsed !== amount)) void save(parsed);
          }}>
            <label className="block">
              Сумма вручную
              <input className="mt-1 w-full rounded border px-2 py-1 text-right tabular-nums" inputMode="decimal"
                value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} />
            </label>
            {parsed === undefined && <p className="text-red-600">Введите число или выберите авторасчёт.</p>}
            <div className="flex items-center justify-between gap-2">
              <button type="submit" className="text-blue-600 disabled:text-neutral-400" disabled={busy || parsed === undefined || (manual && parsed === amount)}>
                {manual ? "Сохранить" : "Задать вручную"}
              </button>
              {manual && <button type="button" className="text-blue-600" disabled={busy} onClick={() => void save(null)}>Вернуть авторасчёт</button>}
            </div>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
