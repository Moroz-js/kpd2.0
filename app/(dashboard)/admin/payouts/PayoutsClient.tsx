"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { Pencil, Trash2, CircleDollarSign, X } from "lucide-react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { ConfirmDialog } from "@/components/ui-custom/ConfirmDialog";
import { PAYMENT_STATUSES } from "@/lib/statuses";
import { formatMoney, formatMoneyRub, formatDateShort, weekLabel, monthLabel, monthFullLabel, MONTHS } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { VirtualizedTableBody } from "@/components/ui-custom/VirtualizedTableBody";
import {
  GroupBySelect,
  GroupHeaderRow,
  buildGroupedFlatList,
  compareGroupKeys,
  compareGroupLabels,
  type FlatGroupItem,
} from "@/components/ui-custom/TableGrouping";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui-custom/DateInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { RowSelectCheckbox } from "@/components/ui-custom/RowSelectCheckbox";
import { useTableRowSelection } from "@/lib/useTableRowSelection";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner } from "@/lib/table-styles";
import { sortByNameRu } from "@/lib/sort";
import { PayoutEditDialog } from "./PayoutEditDialog";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";

type Row = {
  sourceType: "personal" | "other-expense";
  sourceId: string;
  number: string | null;
  numberYear: number | null;
  numberSerial: number | null;
  periodYear: number;
  periodMonth: number;
  weekPlanFact: number | null;
  yearPlanFact: number | null;
  executorId: string;
  executorName: string;
  executorAccessEmail: string | null;
  amount: number;
  paymentStatus: string;
  plannedPayAt: string | null;
  paidAt: string | null;
  bankAccountId: string | null;
  bankAccountName: string | null;
  comment: string | null;
  hasLinkedWorks?: boolean;
  workAmount?: number | null;
  paymentAmount?: number | null;
};
export type PayoutRowDTO = Row;

type ExecutorOption = { id: string; name: string; status: string };
type BankOption = { id: string; name: string; status: string; isDefault?: boolean };

const fetcher = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<T>;
  });

type SortField =
  | "number" | "weekPlanFact" | "executorName" | "bankAccountName"
  | "amount" | "paymentStatus" | "periodYear" | "periodMonth";
type SortDir = "asc" | "desc";

const SMETA_LABEL: Record<Row["sourceType"], string> = {
  personal: "Личная смета",
  "other-expense": "Прочие траты",
};

const compactPeriodHead =
  "text-[10px] leading-tight font-medium whitespace-normal normal-case align-bottom !whitespace-normal";
const periodYearMonthClass = "w-24 max-w-24 px-1";
const weekColClass = "w-18 max-w-18 px-1";
const yearColCell = "text-xs tabular-nums text-left";

function rowKey(r: Row) { return `${r.sourceType}:${r.sourceId}`; }

function payoutWeekKey(r: Row): string {
  if (r.weekPlanFact == null || r.yearPlanFact == null) return "__empty__";
  return `${r.yearPlanFact}-${String(r.weekPlanFact).padStart(2, "0")}`;
}

function payoutWeekLabel(r: Row): string {
  if (r.weekPlanFact == null || r.yearPlanFact == null) return "Не указано";
  return `${weekLabel(r.weekPlanFact)} ${r.yearPlanFact}`;
}

function payoutMonthKey(r: Row): string {
  return `${r.periodYear}-${String(r.periodMonth).padStart(2, "0")}`;
}

function payoutMonthLabel(r: Row): string {
  return `${monthFullLabel(r.periodMonth)} ${r.periodYear}`;
}

const PAYOUT_GROUP_OPTIONS = [
  { value: "executor", label: "Исполнитель" },
  { value: "payWeek", label: "Неделя оплаты" },
  { value: "month", label: "Месяц выполнения" },
  { value: "bankAccount", label: "Источник оплаты" },
] as const;

function toLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type PayoutRowProps = {
  row: Row;
  rowIndex: number;
  checked: boolean;
  onSelect: (index: number, id: string, shiftKey: boolean) => void;
  inlineActive: "plannedPayAt" | "paidAt" | "bankAccountId" | null;
  inlineVal: string;
  activeBanks: BankOption[];
  onInlineValChange: (v: string) => void;
  onStartInline: (row: Row, field: "paidAt" | "plannedPayAt" | "bankAccountId") => void;
  onCommitInline: (row: Row) => void;
  onCancelInline: () => void;
  onPatchInlineStatus: (row: Row, paymentStatus: string) => void;
  onPatchRow: (row: Row, patch: Record<string, unknown>) => Promise<boolean>;
  onEdit: (row: Row) => void;
  onPay: (row: Row) => void;
  onDelete: (row: Row) => void;
};

const PayoutRow = React.memo(function PayoutRow({
  row: r,
  rowIndex,
  checked,
  onSelect,
  inlineActive,
  inlineVal,
  activeBanks,
  onInlineValChange,
  onStartInline,
  onCommitInline,
  onCancelInline,
  onPatchInlineStatus,
  onPatchRow,
  onEdit,
  onPay,
  onDelete,
}: PayoutRowProps) {
  const key = rowKey(r);
  return (
    <TableRow key={key} className={checked ? "bg-blue-50" : undefined}>
      <TableCell className="w-8">
        <RowSelectCheckbox checked={checked} rowIndex={rowIndex} rowId={key} onSelect={onSelect} />
      </TableCell>
      <TableCell className="w-24 whitespace-nowrap tabular-nums">{r.number ?? "—"}</TableCell>
      <TableCell className={cn(periodYearMonthClass, yearColCell)}>{r.periodYear}</TableCell>
      <TableCell className={cn(periodYearMonthClass, "text-xs whitespace-nowrap")}>{monthLabel(r.periodMonth)}</TableCell>
      <TableCell className={cn(weekColClass, "text-xs whitespace-nowrap")}>{r.weekPlanFact != null ? weekLabel(r.weekPlanFact) : "—"}</TableCell>
      <TableCell>{r.executorName}</TableCell>
      <TableCell>
        <Select value={r.paymentStatus} onValueChange={(v) => v && onPatchInlineStatus(r, v)}>
          <SelectTrigger className="h-6 w-auto min-w-[120px] border-0 bg-transparent shadow-none p-0 focus:ring-0 [&>svg]:hidden">
            <SelectValue><StatusBadge dict={PAYMENT_STATUSES} value={r.paymentStatus} /></SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PAYMENT_STATUSES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-right tabular-nums font-semibold text-sm">{formatMoney(r.amount)}</TableCell>
      <TableCell
        className="cursor-pointer hover:bg-neutral-50 min-w-[100px]"
        onClick={() => inlineActive !== "plannedPayAt" && onStartInline(r, "plannedPayAt")}
      >
        {inlineActive === "plannedPayAt" ? (
          <input
            autoFocus
            type="date"
            value={inlineVal}
            onChange={(e) => onInlineValChange(e.target.value)}
            onBlur={() => onCommitInline(r)}
            onClick={(e) => { try { (e.target as HTMLInputElement).showPicker(); } catch { /**/ } }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitInline(r);
              if (e.key === "Escape") onCancelInline();
            }}
            className="w-full h-6 rounded border border-blue-300 px-1 text-xs bg-blue-50 focus:outline-none cursor-pointer"
          />
        ) : (
          <span className="text-xs text-neutral-600">{formatDateShort(r.plannedPayAt)}</span>
        )}
      </TableCell>
      <TableCell
        className={cn(
          "cursor-pointer hover:bg-neutral-50 min-w-[100px]",
          r.paymentStatus === "paid" && !r.paidAt && "bg-red-100 text-red-700"
        )}
        onClick={() => inlineActive !== "paidAt" && onStartInline(r, "paidAt")}
      >
        {inlineActive === "paidAt" ? (
          <input
            autoFocus
            type="date"
            value={inlineVal}
            onChange={(e) => onInlineValChange(e.target.value)}
            onBlur={() => onCommitInline(r)}
            onClick={(e) => { try { (e.target as HTMLInputElement).showPicker(); } catch { /**/ } }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitInline(r);
              if (e.key === "Escape") onCancelInline();
            }}
            className="w-full h-6 rounded border border-blue-300 px-1 text-xs bg-blue-50 focus:outline-none cursor-pointer"
          />
        ) : (
          <span className="text-xs text-neutral-600">{formatDateShort(r.paidAt)}</span>
        )}
      </TableCell>
      <TableCell className="min-w-[140px] max-w-[160px] truncate">
        {inlineActive === "bankAccountId" ? (
          <Select
            value={inlineVal || "__none__"}
            onValueChange={(v) => {
              const val = v === "__none__" ? "" : (v ?? "");
              onInlineValChange(val);
              onPatchRow(r, { bankAccountId: val || null }).then(() => onCancelInline());
            }}
            open
            onOpenChange={(o) => !o && onCancelInline()}
          >
            <SelectTrigger className="h-6 text-xs">
              <SelectValue>{inlineVal ? (activeBanks.find(b => b.id === inlineVal)?.name ?? "Счёт") : "— не задан —"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— не задан —</SelectItem>
              {activeBanks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <span
            className="text-xs text-neutral-600 cursor-pointer hover:underline truncate block"
            onClick={() => onStartInline(r, "bankAccountId")}
          >
            {r.bankAccountName ?? "—"}
          </span>
        )}
      </TableCell>
      <TableCell>
        {r.sourceType === "personal"
          ? r.executorAccessEmail
            ? (
                <Link
                  href={`/admin/executors/${r.executorId}?tab=works`}
                  className="hover:underline text-blue-600"
                >
                  {SMETA_LABEL.personal}
                </Link>
              )
            : SMETA_LABEL.personal
          : SMETA_LABEL["other-expense"]}
      </TableCell>
      <TableCell className={cn(stickyActionsCell, checked && "bg-blue-50")}>
        <div className={stickyActionsInner}>
          {r.paymentStatus === "planned" && (
            <Button size="sm" variant="ghost" onClick={() => onPay(r)} title="Оплатить" className="text-green-600 hover:text-green-800">
              <CircleDollarSign className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onEdit(r)} title="Редактировать">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDelete(r)} title="Удалить">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
});

export function PayoutsClient() {
  const { data, isLoading, mutate } = useSWR<Row[]>("/api/payouts", fetcher);
  const { data: executors } = useSWR<ExecutorOption[]>("/api/executors", fetcher);
  const { data: banks } = useSWR<BankOption[]>("/api/bank-accounts", fetcher);

  const [periodYearFilter, setPeriodYearFilter] = React.useState<string[]>([String(new Date().getFullYear())]);
  const [periodMonthFilter, setPeriodMonthFilter] = React.useState<string[]>([]);
  const [weekFilter, setWeekFilter] = React.useState<string[]>([]);
  const [executorFilter, setExecutorFilter] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<string[]>([]);
  const [bankFilter, setBankFilter] = React.useState<string[]>([]);
  const [smetaFilter, setSmetaFilter] = React.useState<string[]>([]);
  const [groupBy, setGroupBy] = React.useState<"" | "executor" | "payWeek" | "month" | "bankAccount">("");
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => new Set());

  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }[]>([
    { field: "weekPlanFact", dir: "desc" },
    { field: "executorName", dir: "asc" },
    { field: "bankAccountName", dir: "asc" },
  ]);

  const [editing, setEditing] = React.useState<Row | null>(null);
  const [deleting, setDeleting] = React.useState<Row | null>(null);
  const [paying, setPaying] = React.useState<Row | null>(null);

  // Bulk
  const [bulkStatus, setBulkStatus] = React.useState("");
  const [bulkPlannedPayAt, setBulkPlannedPayAt] = React.useState("");
  const [bulkPaidAt, setBulkPaidAt] = React.useState("");
  const [bulkBankId, setBulkBankId] = React.useState("");
  const [bulkSaving, setBulkSaving] = React.useState(false);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Inline edit state
  const [inlineEdit, setInlineEdit] = React.useState<{ key: string; field: "paidAt" | "plannedPayAt" | "bankAccountId" } | null>(null);
  const [inlineVal, setInlineVal] = React.useState("");

  usePersistedInterfaceState(
    "payouts",
    {
      periodYearFilter,
      periodMonthFilter,
      weekFilter,
      executorFilter,
      statusFilter,
      bankFilter,
      smetaFilter,
      groupBy,
      collapsedGroups,
      sort,
    },
    (stored) => {
      if (stored.periodYearFilter) setPeriodYearFilter(stored.periodYearFilter);
      if (stored.periodMonthFilter) setPeriodMonthFilter(stored.periodMonthFilter);
      if (stored.weekFilter) setWeekFilter(stored.weekFilter);
      if (stored.executorFilter) setExecutorFilter(stored.executorFilter);
      if (stored.statusFilter) setStatusFilter(stored.statusFilter);
      if (stored.bankFilter) setBankFilter(stored.bankFilter);
      if (stored.smetaFilter) setSmetaFilter(stored.smetaFilter);
      if (stored.groupBy !== undefined) setGroupBy(stored.groupBy);
      if (stored.collapsedGroups instanceof Set) setCollapsedGroups(stored.collapsedGroups);
      if (stored.sort) setSort(stored.sort);
    }
  );
  usePersistedScroll(scrollRef, "payouts-table");

  function compareRows(a: Row, b: Row): number {
    for (const s of sort) {
      if (s.field === "number") {
        const cmp =
          (a.numberYear ?? Number.MAX_SAFE_INTEGER) - (b.numberYear ?? Number.MAX_SAFE_INTEGER) ||
          (a.numberSerial ?? Number.MAX_SAFE_INTEGER) - (b.numberSerial ?? Number.MAX_SAFE_INTEGER);
        if (cmp !== 0) return s.dir === "asc" ? cmp : -cmp;
        continue;
      }
      const av = a[s.field];
      const bv = b[s.field];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av ?? "").localeCompare(String(bv ?? ""), "ru");
      const signed = s.dir === "asc" ? cmp : -cmp;
      if (signed !== 0) return signed;
    }
    return 0;
  }

  function handleSort(field: string, dir: SortDir) {
    setSort([{ field: field as SortField, dir }]);
  }

  const allRows = data ?? [];

  const periodYearOptions = React.useMemo(
    () => Array.from(new Set(allRows.map((r) => r.periodYear))).sort((a, b) => b - a)
      .map((y) => ({ value: String(y), label: String(y) })),
    [allRows]
  );
  const weekOptions = React.useMemo(() => {
    const opts = Array.from(new Set(allRows.map((r) => r.weekPlanFact).filter((v): v is number => v != null)))
      .sort((a, b) => a - b).map((w) => ({ value: String(w), label: weekLabel(w) }));
    const hasEmpty = allRows.some((r) => r.weekPlanFact === null);
    return hasEmpty ? [{ value: "__empty__", label: "Пусто" }, ...opts] : opts;
  }, [allRows]);
  const executorOptions = React.useMemo(
    () => Array.from(new Map(allRows.map((r) => [r.executorId, r.executorName])).entries())
      .sort((a, b) => a[1].localeCompare(b[1], "ru")).map(([value, label]) => ({ value, label })),
    [allRows]
  );
  const bankOptions = React.useMemo(() => {
    const opts = Array.from(new Map(
      allRows.filter((r) => r.bankAccountId).map((r) => [r.bankAccountId as string, r.bankAccountName ?? "—"])
    ).entries()).sort((a, b) => a[1].localeCompare(b[1], "ru")).map(([value, label]) => ({ value, label }));
    const hasEmpty = allRows.some((r) => !r.bankAccountId);
    return hasEmpty ? [{ value: "__empty__", label: "Пусто" }, ...opts] : opts;
  }, [allRows]);

  const rows = React.useMemo(() => {
    let list = allRows;
    if (periodYearFilter.length) list = list.filter((r) => periodYearFilter.includes(String(r.periodYear)));
    if (periodMonthFilter.length) list = list.filter((r) => periodMonthFilter.includes(String(r.periodMonth)));
    if (weekFilter.length) list = list.filter((r) => weekFilter.includes(r.weekPlanFact === null ? "__empty__" : String(r.weekPlanFact)));
    if (executorFilter.length) list = list.filter((r) => executorFilter.includes(r.executorId));
    if (statusFilter.length) list = list.filter((r) => statusFilter.includes(r.paymentStatus));
    if (bankFilter.length) list = list.filter((r) => bankFilter.includes(r.bankAccountId ?? "__empty__"));
    if (smetaFilter.length) list = list.filter((r) => smetaFilter.includes(r.sourceType));
    return [...list].sort(compareRows);
  }, [allRows, periodYearFilter, periodMonthFilter, weekFilter, executorFilter, statusFilter, bankFilter, smetaFilter, sort]);

  const orderedRowIds = React.useMemo(() => rows.map(rowKey), [rows]);
  const rowIndexById = React.useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r, i) => map.set(rowKey(r), i));
    return map;
  }, [rows]);
  const { selectedIds, handleRowSelect, toggleAll, clearSelection } = useTableRowSelection(orderedRowIds);

  const flatItems = React.useMemo((): FlatGroupItem<Row>[] | null => {
    if (!groupBy) return null;
    const getKey = (r: Row): string => {
      if (groupBy === "executor") return r.executorId || "__empty__";
      if (groupBy === "payWeek") return payoutWeekKey(r);
      if (groupBy === "month") return payoutMonthKey(r);
      return r.bankAccountId ?? "__empty__";
    };
    const getLabel = (r: Row): string => {
      if (groupBy === "executor") return r.executorName || "Не указано";
      if (groupBy === "payWeek") return payoutWeekLabel(r);
      if (groupBy === "month") return payoutMonthLabel(r);
      return r.bankAccountName ?? "Не указано";
    };
    const primary = sort[0];
    const groupAligned =
      (groupBy === "executor" && primary?.field === "executorName") ||
      (groupBy === "payWeek" && primary?.field === "weekPlanFact") ||
      (groupBy === "month" && (primary?.field === "periodMonth" || primary?.field === "periodYear")) ||
      (groupBy === "bankAccount" && primary?.field === "bankAccountName");
    // Неделя/месяц — от новых к старым; остальное — по алфавиту
    const defaultGroupDir: SortDir =
      groupBy === "payWeek" || groupBy === "month" ? "desc" : "asc";
    const groupDir: SortDir = groupAligned ? (primary?.dir ?? defaultGroupDir) : defaultGroupDir;
    return buildGroupedFlatList(rows, getKey, getLabel, (r) => r.amount, collapsedGroups, {
      compareRows,
      compareGroups: (a, b) =>
        groupBy === "payWeek" || groupBy === "month"
          ? compareGroupKeys(a.key, b.key, groupDir)
          : compareGroupLabels(a.label, b.label, groupDir),
    });
  }, [rows, groupBy, collapsedGroups, sort]);

  const toggleGroup = React.useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleGroupByChange = React.useCallback((v: string) => {
    setGroupBy(
      v === "executor" || v === "payWeek" || v === "month" || v === "bankAccount" ? v : ""
    );
    setCollapsedGroups(new Set());
  }, []);

  const activeBanks = React.useMemo(
    () => sortByNameRu((banks ?? []).filter((b) => b.status === "active")),
    [banks]
  );

  const selectedSum = React.useMemo(
    () => rows.filter((r) => selectedIds.has(rowKey(r))).reduce((s, r) => s + r.amount, 0),
    [rows, selectedIds]
  );

  // Aggregations by status
  const aggregations = React.useMemo(() => {
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const byStatus: Record<string, number> = {};
    for (const r of rows) {
      byStatus[r.paymentStatus] = (byStatus[r.paymentStatus] ?? 0) + r.amount;
    }
    return { total, byStatus };
  }, [rows]);

  async function patchRow(row: Row, patch: Record<string, unknown>) {
    const compositeId = rowKey(row);
    const res = await fetch(`/api/payouts/${compositeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) { toast.error("Ошибка сохранения"); return false; }
    mutate();
    return true;
  }

  async function patchInlineStatus(row: Row, paymentStatus: string) {
    await patchRow(row, { paymentStatus });
  }

  async function commitInlineEdit(row: Row) {
    if (!inlineEdit || inlineEdit.key !== rowKey(row)) return;
    const { field } = inlineEdit;
    let value: string | null = inlineVal || null;
    if ((field === "paidAt" || field === "plannedPayAt") && value) {
      value = new Date(value).toISOString();
    }
    await patchRow(row, { [field]: value });
    setInlineEdit(null);
  }

  function startInline(row: Row, field: "paidAt" | "plannedPayAt" | "bankAccountId") {
    const key = rowKey(row);
    if (field === "paidAt")
      setInlineVal(row.paidAt ? row.paidAt.slice(0, 10) : toLocalDate());
    else if (field === "plannedPayAt")
      setInlineVal(row.plannedPayAt ? row.plannedPayAt.slice(0, 10) : "");
    else
      setInlineVal(row.bankAccountId ?? "");
    setInlineEdit({ key, field });
  }

  async function handleMarkPaid(row: Row, paidAt: string, bankAccountId: string | null) {
    setPaying(null);
    await patchRow(row, {
      paymentStatus: "paid",
      paidAt: new Date(paidAt).toISOString(),
      bankAccountId: bankAccountId || null,
    });
    toast.success("Выплата оплачена");
  }

  async function handleDelete(row: Row) {
    const compositeId = rowKey(row);
    const res = await fetch(`/api/payouts/${compositeId}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Не удалось удалить");
    toast.success(row.sourceType === "personal" ? "Выплата удалена." : "Поля выплаты очищены.");
    mutate();
  }

  async function handleBulkApply() {
    const ids = Array.from(selectedIds);
    const patch: Record<string, unknown> = {};
    if (bulkStatus) patch.paymentStatus = bulkStatus;
    if (bulkPlannedPayAt) patch.plannedPayAt = new Date(bulkPlannedPayAt).toISOString();
    if (bulkPaidAt) patch.paidAt = new Date(bulkPaidAt).toISOString();
    if (bulkBankId && bulkBankId !== "__none__") patch.bankAccountId = bulkBankId;
    if (Object.keys(patch).length === 0) return toast.error("Выберите хотя бы одно поле для изменения");

    setBulkSaving(true);
    const res = await fetch("/api/payouts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, patch }),
    });
    setBulkSaving(false);
    if (!res.ok) return toast.error("Ошибка массового обновления");
    const { updated } = await res.json();
    toast.success(`Обновлено ${updated} выплат`);
    clearSelection();
    setBulkStatus("");
    setBulkPlannedPayAt("");
    setBulkPaidAt("");
    setBulkBankId("");
    mutate();
  }

  const patchRowCb = React.useCallback(
    async (row: Row, patch: Record<string, unknown>) => patchRow(row, patch),
    [mutate]
  );
  const patchInlineStatusCb = React.useCallback(
    (row: Row, paymentStatus: string) => patchInlineStatus(row, paymentStatus),
    [mutate]
  );
  const commitInlineEditCb = React.useCallback(
    (row: Row) => commitInlineEdit(row),
    [inlineEdit, inlineVal, mutate]
  );
  const startInlineCb = React.useCallback(
    (row: Row, field: "paidAt" | "plannedPayAt" | "bankAccountId") => startInline(row, field),
    // startInline читает только row и setState
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const cancelInlineCb = React.useCallback(() => setInlineEdit(null), []);
  const onInlineValChangeCb = React.useCallback((v: string) => setInlineVal(v), []);
  const onEditCb = React.useCallback((row: Row) => setEditing(row), []);
  const onPayCb = React.useCallback((row: Row) => setPaying(row), []);
  const onDeleteCb = React.useCallback((row: Row) => setDeleting(row), []);

  const renderRow = React.useCallback(
    (index: number) => {
      if (flatItems) {
        const item = flatItems[index];
        if (!item) return null;
        if (item.kind === "group") {
          return (
            <GroupHeaderRow
              key={`g:${item.key}`}
              label={item.label}
              count={item.count}
              sum={item.sum}
              collapsed={item.collapsed}
              onToggle={() => toggleGroup(item.key)}
              colSpan={13}
            />
          );
        }
        const r = item.row;
        const key = rowKey(r);
        const rowIndex = rowIndexById.get(key) ?? 0;
        const inlineActive = inlineEdit?.key === key ? inlineEdit.field : null;
        return (
          <PayoutRow
            key={key}
            row={r}
            rowIndex={rowIndex}
            checked={selectedIds.has(key)}
            onSelect={handleRowSelect}
            inlineActive={inlineActive}
            inlineVal={inlineActive ? inlineVal : ""}
            activeBanks={activeBanks}
            onInlineValChange={onInlineValChangeCb}
            onStartInline={startInlineCb}
            onCommitInline={commitInlineEditCb}
            onCancelInline={cancelInlineCb}
            onPatchInlineStatus={patchInlineStatusCb}
            onPatchRow={patchRowCb}
            onEdit={onEditCb}
            onPay={onPayCb}
            onDelete={onDeleteCb}
          />
        );
      }
      const r = rows[index];
      if (!r) return null;
      const key = rowKey(r);
      const inlineActive = inlineEdit?.key === key ? inlineEdit.field : null;
      return (
        <PayoutRow
          key={key}
          row={r}
          rowIndex={index}
          checked={selectedIds.has(key)}
          onSelect={handleRowSelect}
          inlineActive={inlineActive}
          inlineVal={inlineActive ? inlineVal : ""}
          activeBanks={activeBanks}
          onInlineValChange={onInlineValChangeCb}
          onStartInline={startInlineCb}
          onCommitInline={commitInlineEditCb}
          onCancelInline={cancelInlineCb}
          onPatchInlineStatus={patchInlineStatusCb}
          onPatchRow={patchRowCb}
          onEdit={onEditCb}
          onPay={onPayCb}
          onDelete={onDeleteCb}
        />
      );
    },
    [
      flatItems,
      rows,
      rowIndexById,
      selectedIds,
      inlineEdit,
      inlineVal,
      activeBanks,
      handleRowSelect,
      toggleGroup,
      onInlineValChangeCb,
      startInlineCb,
      commitInlineEditCb,
      cancelInlineCb,
      patchInlineStatusCb,
      patchRowCb,
      onEditCb,
      onPayCb,
      onDeleteCb,
    ]
  );

  function activeSortField(): SortField { return sort[0]?.field ?? "weekPlanFact"; }
  function activeSortDir(): SortDir { return sort[0]?.dir ?? "desc"; }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] min-h-0">
      <PageHeader title="Выплаты" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <GroupBySelect
          value={groupBy}
          onChange={handleGroupByChange}
          options={[...PAYOUT_GROUP_OPTIONS]}
        />
        <MultiSelectFilter label="Год выполнения" options={periodYearOptions} value={periodYearFilter} onChange={setPeriodYearFilter} />
        <MultiSelectFilter label="Месяц выполнения" options={MONTHS} value={periodMonthFilter} onChange={setPeriodMonthFilter} />
        <MultiSelectFilter label="Неделя план-факт" options={weekOptions} value={weekFilter} onChange={setWeekFilter} />
        <MultiSelectFilter label="Исполнитель" options={executorOptions} value={executorFilter} onChange={setExecutorFilter} />
        <MultiSelectFilter label="Статус выплаты" options={Object.entries(PAYMENT_STATUSES).map(([value, { label }]) => ({ value, label }))} value={statusFilter} onChange={setStatusFilter} />
        <MultiSelectFilter label="Источник оплаты" options={bankOptions} value={bankFilter} onChange={setBankFilter} />
        <MultiSelectFilter label="Тип сметы" options={[{ value: "personal", label: "Личная смета" }, { value: "other-expense", label: "Прочие траты" }]} value={smetaFilter} onChange={setSmetaFilter} />
      </div>

      {/* Bulk toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
          <span className="text-xs font-medium text-blue-700">{selectedIds.size} выбрано</span>
          <span className="text-xs font-medium tabular-nums text-blue-900">{formatMoneyRub(selectedSum)}</span>
          <Select value={bulkStatus} onValueChange={(v) => v && setBulkStatus(v)}>
            <SelectTrigger className="h-7 w-44 text-xs">
              <SelectValue>{bulkStatus ? (PAYMENT_STATUSES[bulkStatus as keyof typeof PAYMENT_STATUSES]?.label ?? "Статус") : "Статус"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PAYMENT_STATUSES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <span className="text-xs text-neutral-500">Дата план:</span>
            <DateInput className="h-7 text-xs w-36" value={bulkPlannedPayAt} onChange={(e) => setBulkPlannedPayAt(e.target.value)} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-neutral-500">Дата оплаты:</span>
            <DateInput className="h-7 text-xs w-36" value={bulkPaidAt} onChange={(e) => setBulkPaidAt(e.target.value)} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-neutral-500">Источник оплаты:</span>
            <Select value={bulkBankId || "__none__"} onValueChange={(v) => setBulkBankId(v === "__none__" ? "" : (v ?? ""))}>
              <SelectTrigger className="h-7 w-44 text-xs">
                <SelectValue>{bulkBankId ? (activeBanks.find(b => b.id === bulkBankId)?.name ?? "") : "— не менять —"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— не менять —</SelectItem>
                {activeBanks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" className="h-7 text-xs" onClick={handleBulkApply} disabled={bulkSaving}>
            {bulkSaving ? "..." : "Применить"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { clearSelection(); setBulkStatus(""); setBulkPlannedPayAt(""); setBulkPaidAt(""); setBulkBankId(""); }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Aggregations */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-3 px-3 py-2 rounded-lg bg-neutral-50 border border-neutral-200">
          <span className="text-xs text-neutral-500">{rows.length} записей</span>
          <span className="text-xs font-medium tabular-nums text-neutral-900">{formatMoneyRub(aggregations.total)}</span>
          {Object.entries(PAYMENT_STATUSES).map(([k, v]) => {
            const amt = aggregations.byStatus[k];
            if (!amt) return null;
            const dotCls = v.tone === "green" ? "bg-green-400" : v.tone === "yellow" ? "bg-yellow-400" : "bg-neutral-400";
            return (
              <span key={k} className="flex items-center gap-1 text-xs tabular-nums">
                <span className={`inline-block h-2 w-2 rounded-full ${dotCls}`} />
                <span className="text-neutral-500">{v.label}:</span>
                <span className="font-semibold text-neutral-700">{formatMoneyRub(amt)}</span>
              </span>
            );
          })}
        </div>
      )}

      <Table
        className="min-w-[1516px]"
        containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto"
        containerRef={scrollRef}
      >
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={rows.length > 0 && selectedIds.size === rows.length}
                  onCheckedChange={() => toggleAll(orderedRowIds)}
                />
              </TableHead>
              <SortableHead
                field="number"
                sortBy={activeSortField()}
                sortDir={activeSortDir()}
                onSort={handleSort}
                className="w-24 text-[10px]"
              >
                Номер
              </SortableHead>
              <SortableHead
                field="periodYear"
                sortBy={activeSortField()}
                sortDir={activeSortDir()}
                onSort={handleSort}
                className={cn(periodYearMonthClass, "!whitespace-normal")}
              >
                <span className="block text-[10px] leading-tight font-medium tracking-tight normal-case text-left">
                  Год
                  <br />
                  выполнения
                </span>
              </SortableHead>
              <SortableHead
                field="periodMonth"
                sortBy={activeSortField()}
                sortDir={activeSortDir()}
                onSort={handleSort}
                className={cn(periodYearMonthClass, compactPeriodHead)}
              >
                <span className="block text-left">
                  Месяц
                  <br />
                  выполнения
                </span>
              </SortableHead>
              <SortableHead
                field="weekPlanFact"
                sortBy={activeSortField()}
                sortDir={activeSortDir()}
                onSort={handleSort}
                className={cn(weekColClass, compactPeriodHead)}
              >
                <span className="block text-left">
                  Неделя
                  <br />
                  оплаты
                </span>
              </SortableHead>
              <SortableHead field="executorName" sortBy={activeSortField()} sortDir={activeSortDir()} onSort={handleSort}>Исполнитель</SortableHead>
              <SortableHead field="paymentStatus" sortBy={activeSortField()} sortDir={activeSortDir()} onSort={handleSort}><span className="flex items-center gap-1">Статус <Pencil className="h-3 w-3 text-neutral-400" /></span></SortableHead>
              <SortableHead field="amount" sortBy={activeSortField()} sortDir={activeSortDir()} onSort={handleSort} className="text-right">Выплата</SortableHead>
              <TableHead><span className="flex items-center gap-1">Дата оплаты план <Pencil className="h-3 w-3 text-neutral-400" /></span></TableHead>
              <TableHead><span className="flex items-center gap-1">Дата оплаты факт <Pencil className="h-3 w-3 text-neutral-400" /></span></TableHead>
              <SortableHead field="bankAccountName" sortBy={activeSortField()} sortDir={activeSortDir()} onSort={handleSort}><span className="flex items-center gap-1">Источник оплаты <Pencil className="h-3 w-3 text-neutral-400" /></span></SortableHead>
              <TableHead>Тип сметы</TableHead>
              <TableHead className={stickyActionsHead} />
            </TableRow>
          </TableHeader>
          <VirtualizedTableBody
            scrollRef={scrollRef}
            rowCount={flatItems ? flatItems.length : rows.length}
            colSpan={13}
            isLoading={isLoading}
            loading={
              <TableRow><TableCell colSpan={13} className="text-center text-neutral-500 py-8">Загрузка...</TableCell></TableRow>
            }
            isEmpty={rows.length === 0}
            empty={
              <TableRow><TableCell colSpan={13} className="text-center text-neutral-500 py-12">Нет выплат.</TableCell></TableRow>
            }
            renderRow={renderRow}
          />
        </Table>

      {paying && (
        <MarkPaidDialog
          row={paying}
          banks={banks ?? []}
          onClose={() => setPaying(null)}
          onConfirm={(paidAt, bankAccountId) => handleMarkPaid(paying, paidAt, bankAccountId)}
        />
      )}

      {editing && (
        <PayoutEditDialog
          row={editing}
          executors={executors ?? []}
          banks={banks ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); mutate(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting?.sourceType === "personal" ? "Удалить выплату?" : "Очистить данные выплаты?"}
        description={
          deleting?.sourceType === "personal"
            ? "Будет удалён Payment. Работы освобождены, статус откатан."
            : "Поля выплаты очищены. Статус работы откатан."
        }
        confirmLabel={deleting?.sourceType === "personal" ? "Удалить" : "Очистить"}
        destructive
        onConfirm={async () => { if (deleting) await handleDelete(deleting); }}
      />
    </div>
  );
}

// ─── Диалог быстрой оплаты ───────────────────────────────────────────────────

function MarkPaidDialog({
  row, banks, onClose, onConfirm,
}: {
  row: Row; banks: BankOption[];
  onClose: () => void;
  onConfirm: (paidAt: string, bankAccountId: string | null) => void;
}) {
  const [paidAt, setPaidAt] = React.useState(toLocalDate());
  const activeBanks = sortByNameRu(
    banks.filter((b) => b.status === "active" || b.id === row.bankAccountId)
  );
  const defaultBank = activeBanks.find((b) => b.isDefault)?.id ?? activeBanks[0]?.id ?? "";
  const [bankAccountId, setBankAccountId] = React.useState(row.bankAccountId ?? defaultBank);
  const ref = React.useRef<HTMLInputElement>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Оплатить — {row.executorName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Дата оплаты</Label>
            <div className="relative w-full cursor-pointer" onClick={() => { ref.current?.focus(); try { ref.current?.showPicker(); } catch { /**/ } }}>
              <input ref={ref} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Источник оплаты</Label>
            <Select value={bankAccountId || "__none__"} onValueChange={(v) => setBankAccountId(v === "__none__" ? "" : (v ?? ""))}>
              <SelectTrigger>
                <SelectValue>{bankAccountId ? (activeBanks.find((b) => b.id === bankAccountId)?.name ?? "—") : "— Не задан —"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Не задан —</SelectItem>
                {activeBanks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button disabled={!paidAt} onClick={() => onConfirm(paidAt, bankAccountId || null)}>Провести оплату</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
