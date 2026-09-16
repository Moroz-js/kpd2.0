"use client";

/**
 * Банковские транзакции («Робот»).
 *
 * Три реестра = три вкладки: поступления, списания, внутренние переводы, плюс «Все».
 * Набор колонок у вкладок разный, потому что в реестрах он и был разным.
 * Внутренний перевод — пара операций, показывается одной строкой.
 *
 * Данные пока моковые (из сида), правки сохраняются в БД — так проверяем
 * модель и интерфейс до появления реального импорта выписок.
 */

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { FilterResetButton } from "@/components/ui-custom/FilterResetButton";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { BulkActions } from "@/components/ui-custom/BulkActions";
import { RowSelectCheckbox } from "@/components/ui-custom/RowSelectCheckbox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BANK_CHARGE_MATCH_STATES,
  BANK_COUNTERPARTY_TYPES,
  BANK_OPERATION_KINDS,
  BANK_OPERATION_STATUSES,
} from "@/lib/statuses";
import { formatDate, formatMoney, monthFullLabel, MONTHS } from "@/lib/format";
import { compactCell, compactHead, compactTable, stickyActionsCell, stickyActionsHead, stickyActionsInner } from "@/lib/table-styles";
import { cn } from "@/lib/utils";
import { useUrlSyncedFilters } from "@/lib/useUrlSyncedFilters";
import { usePersistedInterfaceState, usePersistedScroll } from "@/components/PersistedInterfaceState";
import { BankOperationCard } from "./BankOperationCard";
import { RulesTab } from "./RulesTab";
import {
  collapseTransferPairs,
  counterpartyLabel,
  type BankOperation,
  type ChargeCandidate,
  type CounterpartyOption,
  type OptionRow,
  type RecognitionRule,
} from "./types";
import type { LinkOption } from "../counterparties/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const TABS = [
  { id: "all", label: "Все" },
  { id: "incoming", label: "Поступления" },
  { id: "outgoing", label: "Списания" },
  { id: "internal", label: "Внутренние переводы" },
  { id: "rules", label: "Правила разбора" },
] as const;

type Tab = (typeof TABS)[number]["id"];
type SortField = "date" | "amount" | "bankAccountName" | "counterpartyName" | "status";
type SortDir = "asc" | "desc";

/** Раскладка операций по вкладкам. Внутренние переводы уходят из обеих денежных ветвей. */
function selectTab(rows: BankOperation[], tab: Tab): BankOperation[] {
  switch (tab) {
    case "incoming":
      return rows.filter((r) => r.kind === "incoming" && !r.isInternalTransfer);
    case "outgoing":
      return rows.filter((r) => r.kind === "outgoing" && !r.isInternalTransfer);
    case "internal":
      return collapseTransferPairs(rows.filter((r) => r.isInternalTransfer));
    case "rules":
      return [];
    default:
      return collapseTransferPairs(rows);
  }
}

/** Счёт получателя и источник зависят от направления операции. */
function recipientAccount(row: BankOperation): string {
  if (row.kind === "incoming") return row.bankAccountName;
  return row.pairedAccountName ?? row.raw.account ?? counterpartyLabel(row) ?? "—";
}

function transferSource(row: BankOperation): string {
  if (row.kind === "outgoing") return row.bankAccountName;
  return row.transferSource ?? row.raw.account ?? counterpartyLabel(row) ?? "—";
}

export function BankTransactionsClient({
  bankAccounts,
  projects,
  workTypes,
  executorOptions,
  clientOptions,
  bankAccountOptions,
}: {
  bankAccounts: OptionRow[];
  projects: OptionRow[];
  workTypes: OptionRow[];
  executorOptions: LinkOption[];
  clientOptions: LinkOption[];
  bankAccountOptions: LinkOption[];
}) {
  const { data, isLoading, mutate } = useSWR<BankOperation[]>("/api/bank-operations", fetcher);
  const { data: candidates } = useSWR<ChargeCandidate[]>(
    "/api/bank-operations/charge-candidates",
    fetcher
  );
  const { data: counterpartyData, mutate: mutateCounterparties } = useSWR<CounterpartyOption[]>(
    "/api/counterparties?view=options",
    fetcher
  );
  const counterparties = React.useMemo(() => counterpartyData ?? [], [counterpartyData]);
  // Тот же ключ, что во вкладке правил: SWR отдаёт кэш, второго запроса нет.
  const { data: rules } = useSWR<RecognitionRule[]>("/api/recognition-rules", fetcher);

  const [activeTab, setActiveTab] = React.useState<Tab>("all");
  const [fAccount, setFAccount] = React.useState<string[]>([]);
  const [fProject, setFProject] = React.useState<string[]>([]);
  const [fCounterparty, setFCounterparty] = React.useState<string[]>([]);
  const [fStatus, setFStatus] = React.useState<string[]>([]);
  const [fMonth, setFMonth] = React.useState<string[]>([]);
  const [fYear, setFYear] = React.useState<string[]>([]);
  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }>({
    field: "date",
    dir: "desc",
  });

  const [openId, setOpenId] = React.useState<string | null>(null);
  const [bulkProjectOpen, setBulkProjectOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const urlFilters = useUrlSyncedFilters([
    { stateKey: "fAccount", param: "account", kind: "array", value: fAccount, defaultValue: [], setValue: setFAccount },
    { stateKey: "fProject", param: "project", kind: "array", value: fProject, defaultValue: [], setValue: setFProject },
    { stateKey: "fCounterparty", param: "counterparty", kind: "array", value: fCounterparty, defaultValue: [], setValue: setFCounterparty },
    { stateKey: "fStatus", param: "status", kind: "array", value: fStatus, defaultValue: [], setValue: setFStatus },
    { stateKey: "fMonth", param: "month", kind: "array", value: fMonth, defaultValue: [], setValue: setFMonth },
    { stateKey: "fYear", param: "year", kind: "array", value: fYear, defaultValue: [], setValue: setFYear },
  ]);

  usePersistedInterfaceState(
    "bank-transactions",
    { activeTab, fAccount, fProject, fCounterparty, fStatus, fMonth, fYear, sort },
    (stored) => {
      if (stored.activeTab !== undefined) setActiveTab(stored.activeTab);
      urlFilters.restorePersisted(stored);
      if (stored.sort) setSort(stored.sort);
    }
  );

  const operations = React.useMemo(() => data ?? [], [data]);

  const counterpartyOptions = React.useMemo(() => {
    const names = new Set(
      operations.map((o) => counterpartyLabel(o)).filter((n): n is string => !!n)
    );
    return [...names]
      .sort((a, b) => a.localeCompare(b, "ru"))
      .map((name) => ({ value: name, label: name }));
  }, [operations]);

  const yearOptions = React.useMemo(() => {
    const years = new Set(operations.map((o) => String(o.year)));
    return [...years].sort().reverse().map((y) => ({ value: y, label: y }));
  }, [operations]);

  const filtered = React.useMemo(() => {
    return operations.filter((o) => {
      if (fAccount.length && !fAccount.includes(o.bankAccountId)) return false;
      if (fProject.length && !fProject.includes(o.projectId ?? "")) return false;
      if (fCounterparty.length && !fCounterparty.includes(counterpartyLabel(o) ?? "")) return false;
      if (fStatus.length && !fStatus.includes(o.status)) return false;
      if (fMonth.length && !fMonth.includes(String(o.month))) return false;
      if (fYear.length && !fYear.includes(String(o.year))) return false;
      return true;
    });
  }, [operations, fAccount, fProject, fCounterparty, fStatus, fMonth, fYear]);

  const rows = React.useMemo(() => {
    const list = selectTab(filtered, activeTab);
    return [...list].sort((a, b) => {
      const av = a[sort.field];
      const bv = b[sort.field];
      const cmp =
        sort.field === "date"
          ? new Date(a.date).getTime() - new Date(b.date).getTime()
          : typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av ?? "").localeCompare(String(bv ?? ""), "ru");
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [filtered, activeTab, sort]);

  const tabCounts = React.useMemo(() => {
    return Object.fromEntries(
      TABS.map((tab) => [
        tab.id,
        tab.id === "rules" ? (rules?.length ?? 0) : selectTab(filtered, tab.id).length,
      ])
    ) as Record<Tab, number>;
  }, [filtered, rules]);

  const orderedIds = React.useMemo(() => rows.map((r) => r.id), [rows]);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const anchorRef = React.useRef<number | null>(null);

  usePersistedScroll(scrollRef, `bank-transactions-table:${activeTab}`, {
    enabled: !isLoading && !!data,
    signature: { activeTab, fAccount, fProject, fCounterparty, fStatus, fMonth, fYear, sort },
  });

  function handleRowSelect(index: number, id: string, shiftKey: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && anchorRef.current !== null) {
        const [from, to] = [anchorRef.current, index].sort((a, b) => a - b);
        for (let i = from; i <= to; i += 1) next.add(orderedIds[i]);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      anchorRef.current = index;
      return next;
    });
  }

  function toggleAll() {
    const allSelected = orderedIds.length > 0 && orderedIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(orderedIds));
    anchorRef.current = null;
  }

  const hasActiveFilters =
    fAccount.length + fProject.length + fCounterparty.length + fStatus.length +
      fMonth.length + fYear.length > 0;
  const showCharges = activeTab === "all" || activeTab === "incoming";
  const extraColumns =
    activeTab === "incoming" ? 1 : activeTab === "outgoing" || activeTab === "internal" ? 2 : 0;
  const tableColumnCount = 13 + (showCharges ? 1 : 0) + extraColumns;

  function resetFilters() {
    setFAccount([]);
    setFProject([]);
    setFCounterparty([]);
    setFStatus([]);
    setFMonth([]);
    setFYear([]);
  }

  async function bulkPatch(patch: Record<string, unknown>, successText: string) {
    const ids = [...selectedIds];
    const res = await fetch("/api/bank-operations/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, patch }),
    });
    if (!res.ok) {
      toast.error("Не удалось применить действие");
      return;
    }
    const { updated } = await res.json();
    toast.success(`${successText}: ${updated}`);
    setSelectedIds(new Set());
    mutate();
  }

  const openOperation = operations.find((o) => o.id === openId) ?? null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Банковские транзакции" />

      <div className="mb-4 border-b border-neutral-200">
        <nav className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setSelectedIds(new Set());
              }}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-800"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-xs text-neutral-400">{tabCounts[tab.id]}</span>
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "rules" ? (
        <RulesTab
          counterparties={counterparties}
          projects={projects}
          workTypes={workTypes}
          bankAccounts={bankAccounts}
        />
      ) : (
        <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterResetButton active={hasActiveFilters} onClick={resetFilters} />
          <MultiSelectFilter
            label="Счёт"
            options={bankAccounts.map((a) => ({ value: a.id, label: a.name }))}
            value={fAccount}
            onChange={setFAccount}
          />
          <MultiSelectFilter
            label="Контрагент"
            options={counterpartyOptions}
            value={fCounterparty}
            onChange={setFCounterparty}
          />
          <MultiSelectFilter
            label="Проект"
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            value={fProject}
            onChange={setFProject}
            popoverClassName="w-96"
            optionLabelClassName="whitespace-normal"
          />
          <MultiSelectFilter
            label="Статус"
            options={Object.entries(BANK_OPERATION_STATUSES).map(([value, { label }]) => ({
              value,
              label,
            }))}
            value={fStatus}
            onChange={setFStatus}
          />
          <MultiSelectFilter label="Месяц" options={MONTHS} value={fMonth} onChange={setFMonth} />
          <MultiSelectFilter label="Год" options={yearOptions} value={fYear} onChange={setFYear} />
        </div>
      </div>

      <BulkActions
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        actions={[
          {
            label: "Подтвердить",
            onClick: () => bulkPatch({ status: "confirmed" }, "Подтверждено операций"),
          },
          { label: "Проставить проект", onClick: () => setBulkProjectOpen(true) },
          {
            label: "Вернуть в разбор",
            onClick: () => bulkPatch({ status: "needs_review" }, "Возвращено в разбор"),
          },
          {
            label: "Внутренний перевод",
            onClick: () =>
              bulkPatch({ isInternalTransfer: true }, "Отмечено как внутренний перевод"),
          },
        ]}
      />

      <Table
        className={compactTable}
        containerRef={scrollRef}
        containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto"
      >
        <TableHeader>
          <TableRow>
            <TableHead className={cn(compactHead, "w-9")}>
              <Checkbox
                checked={orderedIds.length > 0 && orderedIds.every((id) => selectedIds.has(id))}
                indeterminate={
                  selectedIds.size > 0 && !orderedIds.every((id) => selectedIds.has(id))
                }
                onCheckedChange={toggleAll}
                aria-label="Выделить все"
              />
            </TableHead>
            <SortableHead
              field="bankAccountName"
              sortBy={sort.field}
              sortDir={sort.dir}
              onSort={(field, dir) => setSort({ field: field as SortField, dir })}
              className={cn(compactHead, "w-48")}
            >
              Банковский счёт получатель
            </SortableHead>
            <TableHead className={cn(compactHead, "w-40")}>Источник перевода</TableHead>
            <SortableHead
              field="amount"
              sortBy={sort.field}
              sortDir={sort.dir}
              onSort={(field, dir) => setSort({ field: field as SortField, dir })}
              className={cn(compactHead, "w-28 text-right")}
            >
              Сумма
            </SortableHead>
            <SortableHead
              field="date"
              sortBy={sort.field}
              sortDir={sort.dir}
              onSort={(field, dir) => setSort({ field: field as SortField, dir })}
              className={cn(compactHead, "w-24")}
            >
              Дата перевода
            </SortableHead>
            <TableHead className={cn(compactHead, "w-24")}>Месяц</TableHead>
            <TableHead className={cn(compactHead, "w-16")}>Год</TableHead>
            {showCharges && <TableHead className={cn(compactHead, "w-40")}>Начисления</TableHead>}
            <TableHead className={cn(compactHead, "w-44")}>Проект</TableHead>
            <SortableHead
              field="counterpartyName"
              sortBy={sort.field}
              sortDir={sort.dir}
              onSort={(field, dir) => setSort({ field: field as SortField, dir })}
              className={cn(compactHead, "w-44")}
            >
              Контрагент
            </SortableHead>
            <TableHead className={cn(compactHead, "w-44")}>Тип транзакции</TableHead>
            <TableHead className={cn(compactHead, "w-40")}>Описание работы</TableHead>
            {activeTab === "incoming" && (
              <TableHead className={cn(compactHead, "w-24")}>Плат. поручение</TableHead>
            )}
            {activeTab === "outgoing" && (
              <TableHead className={cn(compactHead, "w-56")}>Назначение платежа</TableHead>
            )}
            {activeTab === "internal" && (
              <TableHead className={cn(compactHead, "w-48")}>Основание</TableHead>
            )}
            {(activeTab === "outgoing" || activeTab === "internal") && (
              <TableHead className={cn(compactHead, "w-32")}>Вид работ</TableHead>
            )}
            <SortableHead
              field="status"
              sortBy={sort.field}
              sortDir={sort.dir}
              onSort={(field, dir) => setSort({ field: field as SortField, dir })}
              className={cn(compactHead, "w-32")}
            >
              Статус
            </SortableHead>
            <TableHead className={cn(compactHead, stickyActionsHead)} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={tableColumnCount} className="py-8 text-center text-neutral-500">
                Загрузка...
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={tableColumnCount} className="py-8 text-center text-neutral-500">
                Операций нет
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r, index) => {
              const selected = selectedIds.has(r.id);
              const needsReview = r.status === "needs_review";
              return (
                <TableRow
                  key={r.id}
                  className={cn(
                    "cursor-pointer",
                    needsReview && "bg-amber-50/70",
                    selected && "bg-blue-50"
                  )}
                  onClick={() => setOpenId(r.id)}
                >
                  <TableCell
                    className={cn(compactCell, "w-9")}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowSelectCheckbox
                      checked={selected}
                      rowIndex={index}
                      rowId={r.id}
                      onSelect={handleRowSelect}
                    />
                  </TableCell>
                  <TableCell className={cn(compactCell, "truncate")}>
                    {recipientAccount(r)}
                  </TableCell>
                  <TableCell className={cn(compactCell, "truncate")}>
                    {transferSource(r)}
                  </TableCell>
                  <TableCell className={cn(compactCell, "text-right tabular-nums font-semibold")}>
                    {formatMoney(r.amount)}
                    <span className="ml-1 text-[10px] font-normal text-neutral-400">
                      {r.currency}
                    </span>
                  </TableCell>
                  <TableCell className={cn(compactCell, "tabular-nums")}>
                    {formatDate(r.date)}
                  </TableCell>
                  <TableCell className={compactCell}>{monthFullLabel(r.month)}</TableCell>
                  <TableCell className={cn(compactCell, "tabular-nums")}>{r.year}</TableCell>
                  {showCharges && (
                    <TableCell className={compactCell}>
                      <ChargeCell operation={r} />
                    </TableCell>
                  )}
                  <TableCell className={cn(compactCell, "truncate")}>
                    {r.projectName ?? <span className="text-neutral-400">—</span>}
                  </TableCell>
                  <TableCell className={cn(compactCell, "truncate")}>
                    {counterpartyLabel(r) ? (
                      <span>
                        {counterpartyLabel(r)}
                        {r.counterpartyType && (
                          <span className="ml-1 text-[10px] text-neutral-400">
                            {BANK_COUNTERPARTY_TYPES[
                              r.counterpartyType as keyof typeof BANK_COUNTERPARTY_TYPES
                            ]}
                          </span>
                        )}
                        {!r.counterpartyId && (
                          <span className="ml-1 text-[10px] text-amber-700">не в справочнике</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-amber-700">не опознан</span>
                    )}
                  </TableCell>
                  <TableCell className={cn(compactCell, "overflow-hidden")}>
                    {r.isInternalTransfer ? (
                      <StatusBadge tone="blue" label="Внутренний перевод" />
                    ) : (
                      BANK_OPERATION_KINDS[r.kind as keyof typeof BANK_OPERATION_KINDS]
                    )}
                  </TableCell>
                  <TableCell className={cn(compactCell, "truncate")}>
                    {r.workDescription ?? "—"}
                  </TableCell>
                  {activeTab === "incoming" && (
                    <TableCell className={compactCell}>{r.paymentOrder ?? "—"}</TableCell>
                  )}
                  {activeTab === "outgoing" && (
                    <TableCell className={cn(compactCell, "truncate")}>
                      {r.paymentPurpose ?? r.raw.purpose ?? "—"}
                    </TableCell>
                  )}
                  {activeTab === "internal" && (
                    <TableCell className={compactCell}>
                      <span className="block truncate">{r.basis ?? "—"}</span>
                      {!r.pairedOperationId && (
                        <span className="text-[10px] text-amber-700">пара не найдена</span>
                      )}
                    </TableCell>
                  )}
                  {(activeTab === "outgoing" || activeTab === "internal") && (
                    <TableCell className={cn(compactCell, "truncate")}>
                      {r.workTypeName ?? "—"}
                    </TableCell>
                  )}
                  <TableCell className={compactCell}>
                    <StatusBadge dict={BANK_OPERATION_STATUSES} value={r.status} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      compactCell,
                      stickyActionsCell,
                      needsReview && "bg-amber-50",
                      selected && "bg-blue-50"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className={stickyActionsInner}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpenId(r.id)}
                        title="Открыть карточку"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
        </>
      )}

      {openOperation && (
        <BankOperationCard
          operation={openOperation}
          projects={projects}
          workTypes={workTypes}
          chargeCandidates={candidates ?? []}
          counterparties={counterparties}
          executorOptions={executorOptions}
          clientOptions={clientOptions}
          bankAccountOptions={bankAccountOptions}
          onCounterpartiesChanged={() => mutateCounterparties()}
          onClose={() => setOpenId(null)}
          onSaved={() => {
            setOpenId(null);
            mutate();
          }}
        />
      )}

      {bulkProjectOpen && (
        <BulkProjectDialog
          projects={projects}
          onClose={() => setBulkProjectOpen(false)}
          onApply={async (projectId) => {
            setBulkProjectOpen(false);
            await bulkPatch({ projectId }, "Проект проставлен операциям");
          }}
        />
      )}
    </div>
  );
}

/** Начисления в строке: состояние + номера. Полная картина — в карточке. */
function ChargeCell({ operation }: { operation: BankOperation }) {
  if (operation.kind !== "incoming" || operation.isInternalTransfer) {
    return <span className="text-neutral-400">—</span>;
  }
  const state = operation.chargeMatch ?? "not_linked";
  return (
    <span className="flex flex-wrap items-center gap-1">
      <StatusBadge dict={BANK_CHARGE_MATCH_STATES} value={state} />
      {operation.charges.length > 0 && (
        <span className="text-[10px] text-neutral-500">
          {operation.charges.map((c) => c.chargeNumber).join(", ")}
        </span>
      )}
    </span>
  );
}

function BulkProjectDialog({
  projects,
  onClose,
  onApply,
}: {
  projects: OptionRow[];
  onClose: () => void;
  onApply: (projectId: string) => void;
}) {
  const [projectId, setProjectId] = React.useState("");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Проставить проект выделенным операциям</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Проект</Label>
          <SearchableSelect
            value={projectId}
            onValueChange={setProjectId}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Выберите проект"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!projectId} onClick={() => onApply(projectId)}>
            Проставить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
