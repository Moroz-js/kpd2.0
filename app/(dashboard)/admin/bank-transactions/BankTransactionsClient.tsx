"use client";

/**
 * Банковские транзакции («Робот»).
 *
 * Три реестра = три вкладки: поступления, списания, внутренние переводы, плюс «Все».
 * Набор колонок у вкладок разный, потому что в реестрах он и был разным.
 * Внутренний перевод — пара операций, показывается одной строкой.
 */

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CheckCircle2, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { FilterResetButton } from "@/components/ui-custom/FilterResetButton";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { BulkActions } from "@/components/ui-custom/BulkActions";
import { RowSelectCheckbox } from "@/components/ui-custom/RowSelectCheckbox";
import {
  GroupBySelect,
  GroupHeaderRow,
  buildGroupedFlatList,
  compareGroupKeys,
  type FlatGroupItem,
} from "@/components/ui-custom/TableGrouping";
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
import { BANK_OPERATION_KINDS, BANK_OPERATION_STATUSES } from "@/lib/statuses";
import { formatDate, formatMoney, monthFullLabel, MONTHS } from "@/lib/format";
import {
  compactCell,
  compactHead,
  compactTable,
  stickyActionsCell,
  stickyActionsHead,
  stickyActionsInner,
} from "@/lib/table-styles";
import { cn } from "@/lib/utils";
import { useUrlSyncedFilters } from "@/lib/useUrlSyncedFilters";
import { usePersistedInterfaceState, usePersistedScroll } from "@/components/PersistedInterfaceState";
import { BankOperationCard } from "./BankOperationCard";
import { RulesTab } from "./RulesTab";
import {
  catalogCounterpartyName,
  canConfirmOperation,
  collapseTransferPairs,
  operationPurpose,
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
type ColId =
  | "select"
  | "account"
  | "source"
  | "amount"
  | "date"
  | "month"
  | "charges"
  | "status"
  | "counterparty"
  | "project"
  | "workType"
  | "kind"
  | "purpose"
  | "paymentOrder"
  | "basis"
  | "year"
  | "actions";

function columnsFor(tab: Tab): ColId[] {
  switch (tab) {
    case "incoming":
      return [
        "select",
        "account",
        "amount",
        "date",
        "month",
        "charges",
        "status",
        "counterparty",
        "source",
        "project",
        "workType",
        "purpose",
        "paymentOrder",
        "year",
        "actions",
      ];
    case "outgoing":
      return [
        "select",
        "source",
        "counterparty",
        "amount",
        "date",
        "month",
        "project",
        "workType",
        "purpose",
        "status",
        "year",
        "actions",
      ];
    case "internal":
      return [
        "select",
        "account",
        "amount",
        "date",
        "month",
        "counterparty",
        "project",
        "workType",
        "basis",
        "status",
        "year",
        "actions",
      ];
    default:
      return [
        "select",
        "account",
        "amount",
        "date",
        "month",
        "charges",
        "status",
        "counterparty",
        "source",
        "project",
        "workType",
        "kind",
        "purpose",
        "year",
        "actions",
      ];
  }
}

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

function recipientAccount(row: BankOperation): string {
  if (row.isInternalTransfer) {
    return `${row.bankAccountName} → ${row.pairedAccountName ?? "—"}`;
  }
  if (row.kind === "incoming") return row.bankAccountName;
  return row.pairedAccountName ?? row.raw.account ?? catalogCounterpartyName(row) ?? "—";
}

function transferSource(row: BankOperation): string {
  if (row.kind === "outgoing") return row.bankAccountName;
  return row.transferSource ?? row.raw.account ?? catalogCounterpartyName(row) ?? "—";
}

function accountHead(tab: Tab) {
  return tab === "internal" ? "Со счёта → на счёт" : "Банковский счёт получатель";
}

function purposeHead(tab: Tab) {
  return tab === "outgoing" ? "Назначение платежа" : "Назначение";
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
  const { data: rules } = useSWR<RecognitionRule[]>("/api/recognition-rules", fetcher);

  const [activeTab, setActiveTab] = React.useState<Tab>("all");
  const [fAccount, setFAccount] = React.useState<string[]>([]);
  const [fProject, setFProject] = React.useState<string[]>([]);
  const [fWorkType, setFWorkType] = React.useState<string[]>([]);
  const [fCounterparty, setFCounterparty] = React.useState<string[]>([]);
  const [fStatus, setFStatus] = React.useState<string[]>([]);
  const [fMonth, setFMonth] = React.useState<string[]>([]);
  const [fYear, setFYear] = React.useState<string[]>([]);
  const [groupBy, setGroupBy] = React.useState<"" | "month">("month");
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => new Set());
  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }>({
    field: "date",
    dir: "desc",
  });

  const [openId, setOpenId] = React.useState<string | null>(null);
  const [bulkProjectOpen, setBulkProjectOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const columns = columnsFor(activeTab);

  const urlFilters = useUrlSyncedFilters([
    { stateKey: "fAccount", param: "account", kind: "array", value: fAccount, defaultValue: [], setValue: setFAccount },
    { stateKey: "fProject", param: "project", kind: "array", value: fProject, defaultValue: [], setValue: setFProject },
    { stateKey: "fWorkType", param: "workType", kind: "array", value: fWorkType, defaultValue: [], setValue: setFWorkType },
    { stateKey: "fCounterparty", param: "counterparty", kind: "array", value: fCounterparty, defaultValue: [], setValue: setFCounterparty },
    { stateKey: "fStatus", param: "status", kind: "array", value: fStatus, defaultValue: [], setValue: setFStatus },
    { stateKey: "fMonth", param: "month", kind: "array", value: fMonth, defaultValue: [], setValue: setFMonth },
    { stateKey: "fYear", param: "year", kind: "array", value: fYear, defaultValue: [], setValue: setFYear },
  ]);

  usePersistedInterfaceState(
    "bank-transactions",
    { activeTab, fAccount, fProject, fWorkType, fCounterparty, fStatus, fMonth, fYear, groupBy, sort },
    (stored) => {
      if (stored.activeTab !== undefined) setActiveTab(stored.activeTab);
      urlFilters.restorePersisted(stored);
      if (stored.groupBy === "" || stored.groupBy === "month") setGroupBy(stored.groupBy);
      if (stored.sort) setSort(stored.sort);
    }
  );

  const operations = React.useMemo(() => data ?? [], [data]);

  const counterpartyOptions = React.useMemo(() => {
    const names = new Set(
      operations.map((o) => catalogCounterpartyName(o)).filter((n): n is string => !!n)
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
      if (fWorkType.length && !fWorkType.includes(o.workTypeId ?? "")) return false;
      if (fCounterparty.length && !fCounterparty.includes(catalogCounterpartyName(o) ?? ""))
        return false;
      if (fStatus.length && !fStatus.includes(o.status)) return false;
      if (fMonth.length && !fMonth.includes(String(o.month))) return false;
      if (fYear.length && !fYear.includes(String(o.year))) return false;
      return true;
    });
  }, [operations, fAccount, fProject, fWorkType, fCounterparty, fStatus, fMonth, fYear]);

  const rows = React.useMemo(() => {
    const list = selectTab(filtered, activeTab);
    return [...list].sort((a, b) => {
      const av = a[sort.field];
      const bv = b[sort.field];
      const cmp =
        sort.field === "date"
          ? new Date(a.date).getTime() - new Date(b.date).getTime()
          : sort.field === "counterpartyName"
            ? (catalogCounterpartyName(a) ?? "").localeCompare(catalogCounterpartyName(b) ?? "", "ru")
            : typeof av === "number" && typeof bv === "number"
              ? av - bv
              : String(av ?? "").localeCompare(String(bv ?? ""), "ru");
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [filtered, activeTab, sort]);

  const flatItems = React.useMemo((): FlatGroupItem<BankOperation>[] | null => {
    if (groupBy !== "month") return null;
    return buildGroupedFlatList(
      rows,
      (r) => `${r.year}-${String(r.month).padStart(2, "0")}`,
      (r) => `${monthFullLabel(r.month)} ${r.year}`,
      (r) => r.amount,
      collapsedGroups,
      {
        compareGroups: (a, b) => compareGroupKeys(a.key, b.key, "desc"),
      }
    );
  }, [rows, groupBy, collapsedGroups]);

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
    signature: { activeTab, fAccount, fProject, fWorkType, fCounterparty, fStatus, fMonth, fYear, groupBy, sort },
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
    fAccount.length +
      fProject.length +
      fWorkType.length +
      fCounterparty.length +
      fStatus.length +
      fMonth.length +
      fYear.length >
    0;

  function resetFilters() {
    setFAccount([]);
    setFProject([]);
    setFWorkType([]);
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
    const { updated, skipped } = (await res.json()) as { updated: number; skipped?: number };
    toast.success(
      skipped ? `${successText}: ${updated}, пропущено: ${skipped}` : `${successText}: ${updated}`
    );
    setSelectedIds(new Set());
    mutate();
  }

  async function confirmOne(row: BankOperation) {
    if (!canConfirmOperation(row)) {
      toast.error("Нельзя подтвердить поступление без начисления или внутреннего перевода");
      return;
    }
    const res = await fetch(`/api/bank-operations/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Не удалось подтвердить");
      return;
    }
    toast.success("Операция подтверждена");
    mutate();
  }

  const openOperation = operations.find((o) => o.id === openId) ?? null;

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderHead(col: ColId) {
    switch (col) {
      case "select":
        return (
          <TableHead key={col} className={cn(compactHead, "w-9")}>
            <Checkbox
              checked={orderedIds.length > 0 && orderedIds.every((id) => selectedIds.has(id))}
              indeterminate={selectedIds.size > 0 && !orderedIds.every((id) => selectedIds.has(id))}
              onCheckedChange={toggleAll}
              aria-label="Выделить все"
            />
          </TableHead>
        );
      case "account":
        return (
          <SortableHead
            key={col}
            field="bankAccountName"
            sortBy={sort.field}
            sortDir={sort.dir}
            onSort={(field, dir) => setSort({ field: field as SortField, dir })}
            className={cn(compactHead, "w-48")}
          >
            {accountHead(activeTab)}
          </SortableHead>
        );
      case "source":
        return (
          <TableHead key={col} className={cn(compactHead, "w-40")}>
            Источник перевода
          </TableHead>
        );
      case "amount":
        return (
          <SortableHead
            key={col}
            field="amount"
            sortBy={sort.field}
            sortDir={sort.dir}
            onSort={(field, dir) => setSort({ field: field as SortField, dir })}
            className={cn(compactHead, "w-28 text-right")}
          >
            Сумма
          </SortableHead>
        );
      case "date":
        return (
          <SortableHead
            key={col}
            field="date"
            sortBy={sort.field}
            sortDir={sort.dir}
            onSort={(field, dir) => setSort({ field: field as SortField, dir })}
            className={cn(compactHead, "w-24")}
          >
            Дата перевода
          </SortableHead>
        );
      case "month":
        return (
          <TableHead key={col} className={cn(compactHead, "w-24")}>
            Месяц
          </TableHead>
        );
      case "charges":
        return (
          <TableHead key={col} className={cn(compactHead, "w-32")}>
            Начисления
          </TableHead>
        );
      case "status":
        return (
          <SortableHead
            key={col}
            field="status"
            sortBy={sort.field}
            sortDir={sort.dir}
            onSort={(field, dir) => setSort({ field: field as SortField, dir })}
            className={cn(compactHead, "w-32")}
          >
            Статус
          </SortableHead>
        );
      case "counterparty":
        return (
          <SortableHead
            key={col}
            field="counterpartyName"
            sortBy={sort.field}
            sortDir={sort.dir}
            onSort={(field, dir) => setSort({ field: field as SortField, dir })}
            className={cn(compactHead, "w-44")}
          >
            Контрагент
          </SortableHead>
        );
      case "project":
        return (
          <TableHead key={col} className={cn(compactHead, "w-44")}>
            Проект
          </TableHead>
        );
      case "workType":
        return (
          <TableHead key={col} className={cn(compactHead, "w-40")}>
            Вид работ
          </TableHead>
        );
      case "kind":
        return (
          <TableHead key={col} className={cn(compactHead, "w-44")}>
            Тип транзакции
          </TableHead>
        );
      case "purpose":
        return (
          <TableHead key={col} className={cn(compactHead, "w-48")}>
            {purposeHead(activeTab)}
          </TableHead>
        );
      case "paymentOrder":
        return (
          <TableHead key={col} className={cn(compactHead, "w-24")}>
            Плат. поручение
          </TableHead>
        );
      case "basis":
        return (
          <TableHead key={col} className={cn(compactHead, "w-48")}>
            Основание
          </TableHead>
        );
      case "year":
        return (
          <TableHead key={col} className={cn(compactHead, "w-16")}>
            Год
          </TableHead>
        );
      case "actions":
        return <TableHead key={col} className={cn(compactHead, stickyActionsHead)} />;
    }
  }

  function renderCell(col: ColId, r: BankOperation, index: number) {
    const selected = selectedIds.has(r.id);
    const locked = r.status === "confirmed";
    const needsReview = r.status === "needs_review";
    switch (col) {
      case "select":
        return (
          <TableCell key={col} className={cn(compactCell, "w-9")} onClick={(e) => e.stopPropagation()}>
            <RowSelectCheckbox
              checked={selected}
              rowIndex={index}
              rowId={r.id}
              onSelect={handleRowSelect}
            />
          </TableCell>
        );
      case "account":
        return (
          <TableCell key={col} className={cn(compactCell, "truncate")}>
            {recipientAccount(r)}
          </TableCell>
        );
      case "source":
        return (
          <TableCell key={col} className={cn(compactCell, "truncate")}>
            {transferSource(r)}
          </TableCell>
        );
      case "amount":
        return (
          <TableCell key={col} className={cn(compactCell, "text-right tabular-nums font-semibold")}>
            {formatMoney(r.amount)}
            <span className="ml-1 text-[10px] font-normal text-neutral-400">{r.currency}</span>
          </TableCell>
        );
      case "date":
        return (
          <TableCell key={col} className={cn(compactCell, "tabular-nums")}>
            {formatDate(r.date)}
          </TableCell>
        );
      case "month":
        return (
          <TableCell key={col} className={compactCell}>
            {monthFullLabel(r.month)}
          </TableCell>
        );
      case "charges":
        return (
          <TableCell key={col} className={compactCell}>
            <ChargeCell operation={r} />
          </TableCell>
        );
      case "status":
        return (
          <TableCell key={col} className={compactCell}>
            <StatusBadge dict={BANK_OPERATION_STATUSES} value={r.status} />
          </TableCell>
        );
      case "counterparty":
        return (
          <TableCell key={col} className={cn(compactCell, "truncate")}>
            {catalogCounterpartyName(r) ?? ""}
          </TableCell>
        );
      case "project":
        return (
          <TableCell key={col} className={cn(compactCell, "truncate")}>
            {r.projectName ?? ""}
          </TableCell>
        );
      case "workType":
        return (
          <TableCell key={col} className={cn(compactCell, "truncate")}>
            {r.workTypeName ?? ""}
          </TableCell>
        );
      case "kind":
        return (
          <TableCell key={col} className={cn(compactCell, "overflow-hidden")}>
            {r.isInternalTransfer ? (
              <StatusBadge tone="blue" label="Внутренний перевод" />
            ) : (
              BANK_OPERATION_KINDS[r.kind as keyof typeof BANK_OPERATION_KINDS]
            )}
          </TableCell>
        );
      case "purpose":
        return (
          <TableCell key={col} className={cn(compactCell, "truncate")}>
            {operationPurpose(r) ?? ""}
          </TableCell>
        );
      case "paymentOrder":
        return (
          <TableCell key={col} className={compactCell}>
            {r.paymentOrder ?? ""}
          </TableCell>
        );
      case "basis":
        return (
          <TableCell key={col} className={compactCell}>
            <span className="block truncate">{r.basis ?? ""}</span>
            {!r.pairedOperationId && (
              <span className="text-[10px] text-amber-700">пара не найдена</span>
            )}
          </TableCell>
        );
      case "year":
        return (
          <TableCell key={col} className={cn(compactCell, "tabular-nums")}>
            {r.year}
          </TableCell>
        );
      case "actions":
        return (
          <TableCell
            key={col}
            className={cn(
              compactCell,
              stickyActionsCell,
              needsReview && "bg-amber-50",
              selected && "bg-blue-50"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={stickyActionsInner}>
              {canConfirmOperation(r) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => confirmOne(r)}
                  title="Подтвердить"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOpenId(r.id)}
                title={locked ? "Открыть карточку" : "Редактировать"}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          </TableCell>
        );
    }
  }

  function renderRow(r: BankOperation, index: number) {
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
        {columns.map((col) => renderCell(col, r, index))}
      </TableRow>
    );
  }

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
                setCollapsedGroups(new Set());
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
              <GroupBySelect
                value={groupBy}
                onChange={(v) => {
                  setGroupBy(v === "month" ? "month" : "");
                  setCollapsedGroups(new Set());
                }}
                options={[{ value: "month", label: "Месяц" }]}
              />
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
                label="Вид работ"
                options={workTypes.map((w) => ({ value: w.id, label: w.name }))}
                value={fWorkType}
                onChange={setFWorkType}
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
              <TableRow>{columns.map(renderHead)}</TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="py-8 text-center text-neutral-500">
                    Загрузка...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="py-8 text-center text-neutral-500">
                    Операций нет
                  </TableCell>
                </TableRow>
              ) : flatItems ? (
                flatItems.map((item) =>
                  item.kind === "group" ? (
                    <GroupHeaderRow
                      key={`g-${item.key}`}
                      label={item.label}
                      count={item.count}
                      sum={item.sum}
                      collapsed={item.collapsed}
                      onToggle={() => toggleGroup(item.key)}
                      colSpan={columns.length}
                    />
                  ) : (
                    renderRow(item.row, orderedIds.indexOf(item.row.id))
                  )
                )
              ) : (
                rows.map((r, index) => renderRow(r, index))
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

function ChargeCell({ operation }: { operation: BankOperation }) {
  if (operation.status !== "confirmed") return null;
  if (operation.isInternalTransfer || operation.chargeMatch === "no_charge") {
    return <StatusBadge tone="blue" label="Внутренний перевод" />;
  }
  if (operation.kind !== "incoming" || operation.charges.length === 0) return null;
  return (
    <span className="flex flex-col gap-0.5">
      {operation.charges.map((c) => (
        <span key={c.chargeId} className="tabular-nums text-neutral-800">
          {c.chargeNumber}
        </span>
      ))}
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
