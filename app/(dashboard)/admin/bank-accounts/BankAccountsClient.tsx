"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { ConfirmDialog } from "@/components/ui-custom/ConfirmDialog";
import { ENTITY_STATUSES } from "@/lib/statuses";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner } from "@/lib/table-styles";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyCombobox } from "@/components/ui-custom/CurrencyCombobox";
import { DEFAULT_CURRENCIES, mergeCurrencyOptions } from "@/lib/currencies";
import { BankAccountVerificationTab } from "./BankAccountVerificationTab";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";

type Row = {
  id: string;
  name: string;
  details: string | null;
  currency: string;
  status: string;
  isDefault: boolean;
  paymentCount: number;
  chargeCount: number;
  operationCount: number;
  paymentSum: number;
  operationSum: number;
  chargeSum: number;
  createdAt: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<Row[]>);

/** Сумма жирным + код валюты мелким серым (единый стиль с таблицей начислений). */
function MoneyWithCurrency({ amount, currency }: { amount: number | null | undefined; currency: string }) {
  const base = formatMoney(amount);
  if (base === "—") return <>—</>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-semibold">{base}</span>
      <span className="text-[10px] font-normal text-neutral-400 tracking-wide">
        {(currency ?? "RUB").toUpperCase()}
      </span>
    </span>
  );
}

type SortField = "name" | "status" | "paymentSum" | "chargeSum";
type SortDir = "asc" | "desc";

export function BankAccountsClient() {
  const { data, isLoading, mutate } = useSWR<Row[]>("/api/bank-accounts", fetcher);
  const [activeTab, setActiveTab] = React.useState<"accounts" | "verification">("accounts");
  const [statusFilter, setStatusFilter] = React.useState<string[]>(["active"]);
  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }>({
    field: "name",
    dir: "asc",
  });

  const [editing, setEditing] = React.useState<Row | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<Row | null>(null);
  const [unarchiveTarget, setUnarchiveTarget] = React.useState<Row | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  usePersistedInterfaceState(
    "bank-accounts",
    { activeTab, statusFilter, sort },
    (stored) => {
      if (stored.activeTab !== undefined) setActiveTab(stored.activeTab);
      if (stored.statusFilter) setStatusFilter(stored.statusFilter);
      if (stored.sort) setSort(stored.sort);
    }
  );
  usePersistedScroll(scrollRef, `bank-accounts-table:${activeTab}`, {
    enabled: !isLoading && !!data,
    signature: { activeTab, statusFilter, sort },
  });

  const rows = React.useMemo(() => {
    let list = data ?? [];
    if (statusFilter.length > 0) list = list.filter((r) => statusFilter.includes(r.status));
    list = [...list].sort((a, b) => {
      const av = a[sort.field];
      const bv = b[sort.field];
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "ru");
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data, statusFilter, sort]);

  function handleSort(field: string, dir: SortDir) {
    setSort({ field: field as SortField, dir });
  }

  async function handleArchive(row: Row) {
    const res = await fetch(`/api/bank-accounts/${row.id}/archive`, { method: "POST" });
    if (!res.ok) {
      toast.error("Не удалось архивировать счёт");
      return;
    }
    toast.success(`Счёт «${row.name}» архивирован`);
    mutate();
  }

  async function handleUnarchive(row: Row) {
    const res = await fetch(`/api/bank-accounts/${row.id}/archive`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Не удалось вернуть счёт из архива");
      return;
    }
    toast.success(`Счёт «${row.name}» снова активен`);
    mutate();
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Банковские счета"
        actions={
          activeTab === "accounts" ? (
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4 mr-1" /> Добавить счёт
            </Button>
          ) : undefined
        }
      />

      <div className="border-b border-neutral-200 mb-4">
        <nav className="flex gap-0">
          {(["accounts", "verification"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-neutral-500 hover:text-neutral-800 hover:border-neutral-300"
              }`}
            >
              {tab === "accounts" ? "Счета" : "Остатки"}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "verification" && (
        <div className="flex-1 min-h-0 flex flex-col">
          <BankAccountVerificationTab />
        </div>
      )}

      {activeTab === "accounts" && (
      <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="ml-auto">
          <MultiSelectFilter
            label="Статус"
            options={Object.entries(ENTITY_STATUSES).map(([value, { label }]) => ({ value, label }))}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </div>
      </div>

      <Table containerRef={scrollRef} containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto">
          <TableHeader>
            <TableRow>
              <SortableHead field="name" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort}>
                Счёт
              </SortableHead>
              <TableHead className="text-right">Кол-во выплат</TableHead>
              <TableHead className="text-right">Кол-во начислений</TableHead>
              <TableHead className="text-right">Операций с р/с</TableHead>
              <SortableHead
                field="paymentSum"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
                className="text-right"
              >
                Сумма выплат
              </SortableHead>
              <TableHead className="text-right">Сумма операций</TableHead>
              <SortableHead
                field="chargeSum"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
                className="text-right"
              >
                Сумма начислений
              </SortableHead>
              <SortableHead field="status" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort}>
                Статус
              </SortableHead>
              <TableHead className={stickyActionsHead} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-neutral-500 py-8">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-neutral-500 py-8">
                  Нет счетов
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.paymentCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.chargeCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.operationCount}</TableCell>
                  <TableCell className="text-right tabular-nums"><MoneyWithCurrency amount={r.paymentSum} currency={r.currency} /></TableCell>
                  <TableCell className="text-right tabular-nums"><MoneyWithCurrency amount={r.operationSum} currency={r.currency} /></TableCell>
                  <TableCell className="text-right tabular-nums"><MoneyWithCurrency amount={r.chargeSum} currency={r.currency} /></TableCell>
                  <TableCell>
                    <StatusBadge dict={ENTITY_STATUSES} value={r.status} />
                  </TableCell>
                  <TableCell className={cn(stickyActionsCell)}>
                    <div className={stickyActionsInner}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(r)}
                        title="Редактировать"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {r.status === "active" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setArchiveTarget(r)}
                          title="Архивировать"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setUnarchiveTarget(r)}
                          title="Вернуть из архива"
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

      {editing && (
        <BankAccountEditDialog
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            mutate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title="Архивировать счёт?"
        description={
          archiveTarget?.isDefault
            ? `Счёт «${archiveTarget.name}» сейчас используется по умолчанию. После архивации его нужно будет заменить.`
            : `Счёт «${archiveTarget?.name}» станет недоступен для новых выплат и начислений.`
        }
        confirmLabel="Архивировать"
        destructive
        onConfirm={async () => {
          if (archiveTarget) await handleArchive(archiveTarget);
        }}
      />

      <ConfirmDialog
        open={!!unarchiveTarget}
        onOpenChange={(open) => !open && setUnarchiveTarget(null)}
        title="Вернуть счёт из архива?"
        description={`Счёт «${unarchiveTarget?.name}» снова станет доступен в активных списках.`}
        confirmLabel="Вернуть"
        onConfirm={async () => {
          if (unarchiveTarget) await handleUnarchive(unarchiveTarget);
        }}
      />
      </>
      )}
    </div>
  );
}

function BankAccountEditDialog({
  row,
  onClose,
  onSaved,
}: {
  row: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(row?.name ?? "");
  const [details, setDetails] = React.useState(row?.details ?? "");
  const [currency, setCurrency] = React.useState(row?.currency ?? "RUB");
  const [currencyOptions, setCurrencyOptions] = React.useState<string[]>([...DEFAULT_CURRENCIES]);
  const [isDefault, setIsDefault] = React.useState(row?.isDefault ?? false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    setName(row?.name ?? "");
    setDetails(row?.details ?? "");
    setCurrency(row?.currency ?? "RUB");
    setIsDefault(row?.isDefault ?? false);
  }, [row]);

  React.useEffect(() => {
    fetch("/api/bank-accounts/currencies")
      .then((r) => r.json())
      .then((codes: string[]) => setCurrencyOptions(mergeCurrencyOptions(codes)))
      .catch(() => {});
  }, []);

  // Новая валюта сохраняется в централизованный справочник —
  // сразу доступна в выпадающих списках всех счетов.
  async function handleAddCurrency(code: string) {
    setCurrencyOptions((prev) => [...new Set([...prev, code])]);
    const res = await fetch("/api/bank-accounts/currencies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Не удалось добавить валюту");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Введите название счёта");
      return;
    }
    setSubmitting(true);
    const isNew = !row;
    const res = await fetch(isNew ? "/api/bank-accounts" : `/api/bank-accounts/${row.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        details: details.trim() || null,
        currency,
        isDefault,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Не удалось сохранить");
      return;
    }
    toast.success(isNew ? "Счёт создан" : "Счёт обновлён");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? "Редактировать счёт" : "Новый счёт"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Название счёта</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: ИП Иванов — Тинькофф"
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="details">Расчётный счёт / реквизиты</Label>
            <Input
              id="details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="р/с 40802810…, БИК 04…"
            />
          </div>
          <div className="space-y-2">
            <Label>Валюта</Label>
            <CurrencyCombobox
              value={currency}
              onValueChange={setCurrency}
              options={currencyOptions}
              onAddOption={handleAddCurrency}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Отмена
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
