"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, CheckCircle, RotateCcw, X, CircleDollarSign, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui-custom/DateInput";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Table, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { VirtualizedTableBody } from "@/components/ui-custom/VirtualizedTableBody";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { OverduePaymentSummary } from "@/components/ui-custom/OverduePaymentSummary";
import { FilterResetButton } from "@/components/ui-custom/FilterResetButton";
import { EntityActivityHistory } from "@/components/ui-custom/EntityActivityHistory";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { WORK_STATUSES, PAYMENT_STATUSES } from "@/lib/statuses";
import { formatMoney, formatMoneyRub, formatDateShort, MONTHS } from "@/lib/format";
import { isOverduePayment, overduePaymentTotal } from "@/lib/overdue-payments";
import { getISOWeek, getISOWeekYear, weekLabel, nearestPaymentDate, toLocalDateString, resolvePlannedPayAtOnCheck } from "@/lib/iso-weeks";
import { cn } from "@/lib/utils";
import { RowSelectCheckbox } from "@/components/ui-custom/RowSelectCheckbox";
import { useTableRowSelection } from "@/lib/useTableRowSelection";
import { ExpandableListCell } from "@/components/ui-custom/ExpandableListCell";
import { stickyActionsHead, stickyActionsCell, compactHead, compactPeriodHead } from "@/lib/table-styles";
import { sortByNameRu } from "@/lib/sort";
import { useUrlSyncedFilters } from "@/lib/useUrlSyncedFilters";
import { useCompatibleFilterOptions } from "@/lib/useCompatibleFilterOptions";
import {
  getMonthFilterMetadata,
  getWeekFilterMetadata,
} from "@/lib/period-filter-options";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";

/** Ширины колонок (19) — table-fixed, иначе правые колонки сжимаются и наезжают друг на друга */
const ACTIONS_COL_WIDTH = 152;
const COL_WIDTHS = [
  40, 96, 112, 72, 192, 116, 124, 104, 100, 124, 104, 192, 148, 208, 140, 140, 124, 84, ACTIONS_COL_WIDTH,
] as const;
const COL_COUNT = COL_WIDTHS.length;
const TABLE_MIN_WIDTH = COL_WIDTHS.reduce((s, w) => s + w, 0);
const cellClip = "overflow-hidden max-w-0";

// ─── Константы ────────────────────────────────────────────────────────────────

const PREFERRED_PAY_METHODS = [
  "4DEV", "Бизнес-картой КЗ", "Бизнес-картой РФ", "Бизнес-картой СЛ",
  "Бизнес-картой ЧГ", "ГПХ", "З/П", "ИП",
  "Карта физлица другой страны", "Карта физлица РФ", "Крипта",
  "Р/С контрагента ЕС", "Р/С контрагента КЗ", "Р/С контрагента РФ",
  "Р/С контрагента ЧГ", "Самозанятый",
];

// ─── Типы ─────────────────────────────────────────────────────────────────────

type Ref = { id: string; name: string };
type ProjectRef = Ref & { responsibleExecutorId?: string | null };

type OtherExpense = {
  id: string;
  otherExpenseNumber: string | null;
  otherExpenseNumberYear: number | null;
  otherExpenseNumberSerial: number | null;
  projectId: string; project: Ref;
  executorId: string; executor: Ref;
  workTypeId: string; workType: Ref & { segment: string };
  responsibleExecutorId: string | null; responsibleExecutor: Ref | null;
  bankAccountId: string | null; bankAccount: Ref | null;
  executionYear: number;
  executionMonth: number;
  description: string;
  amount: number;
  paymentAmount: number | null;
  preferredPayMethod: string | null;
  plannedPayAt: string | null;
  paidAt: string | null;
  checkedAt: string | null;
  workStatus: string;
  paymentStatus: string | null;
  comment: string | null;
  createdById: string;
  createdAt: string;
};

type Props = {
  stateScope: "admin" | "responsible" | "executor";
  isAdmin: boolean;
  userId: string;
  executorId: string | null;
  projects: ProjectRef[];
  executors: Ref[];
  workTypes: Ref[];
  permanentExecutors: Ref[];
  bankAccounts: Ref[];
};

// ─── Утилиты ──────────────────────────────────────────────────────────────────

async function readApiJson<T>(r: Response): Promise<T> {
  const text = await r.text();
  if (!text.trim()) {
    if (!r.ok) throw new Error(`Ошибка сервера (${r.status})`);
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(r.ok ? "Некорректный ответ сервера" : `Ошибка сервера (${r.status})`);
  }
}

function payWeek(plannedPayAt: string | null, paidAt: string | null): string {
  const d = paidAt ?? plannedPayAt;
  if (!d) return "—";
  return weekLabel(getISOWeek(new Date(d)));
}

/** Ключ ISO-недели оплаты: `YYYY-WW` из paidAt ?? plannedPayAt. */
function payWeekKey(plannedPayAt: string | null, paidAt: string | null): string {
  const d = paidAt ?? plannedPayAt;
  if (!d) return "__empty__";
  const date = new Date(d);
  return `${getISOWeekYear(date)}-${String(getISOWeek(date)).padStart(2, "0")}`;
}

function payWeekFilterLabel(plannedPayAt: string | null, paidAt: string | null): string {
  const d = paidAt ?? plannedPayAt;
  if (!d) return "Не указано";
  const date = new Date(d);
  return `${weekLabel(getISOWeek(date))} ${getISOWeekYear(date)}`;
}

type SortField =
  | "number"
  | "executionMonth"
  | "payWeek"
  | "project"
  | "executor"
  | "workType"
  | "responsible"
  | "preferredPayMethod"
  | "plannedPayAt"
  | "amount"
  | "workStatus"
  | "paymentStatus"
  | "paidAt"
  | "bankAccount";
type SortDir = "asc" | "desc";

function cmpText(a: string, b: string, dir: SortDir): number {
  const cmp = a.localeCompare(b, "ru");
  return dir === "asc" ? cmp : -cmp;
}

/** Пустые даты всегда в конце. */
function cmpDate(a: string | null | undefined, b: string | null | undefined, dir: SortDir): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const cmp = new Date(a).getTime() - new Date(b).getTime();
  return dir === "asc" ? cmp : -cmp;
}

function cmpNullableText(a: string | null | undefined, b: string | null | undefined, dir: SortDir): number {
  const ae = !a;
  const be = !b;
  if (ae && be) return 0;
  if (ae) return 1;
  if (be) return -1;
  return cmpText(a!, b!, dir);
}

function compareOtherExpenses(a: OtherExpense, b: OtherExpense, field: SortField, dir: SortDir): number {
  switch (field) {
    case "number": {
      const cmp =
        (a.otherExpenseNumberYear ?? Number.MAX_SAFE_INTEGER) -
          (b.otherExpenseNumberYear ?? Number.MAX_SAFE_INTEGER) ||
        (a.otherExpenseNumberSerial ?? Number.MAX_SAFE_INTEGER) -
          (b.otherExpenseNumberSerial ?? Number.MAX_SAFE_INTEGER);
      return dir === "asc" ? cmp : -cmp;
    }
    case "executionMonth":
      return dir === "asc" ? a.executionMonth - b.executionMonth : b.executionMonth - a.executionMonth;
    case "payWeek": {
      const ak = payWeekKey(a.plannedPayAt, a.paidAt);
      const bk = payWeekKey(b.plannedPayAt, b.paidAt);
      if (ak === "__empty__" && bk === "__empty__") return 0;
      if (ak === "__empty__") return 1;
      if (bk === "__empty__") return -1;
      return cmpText(ak, bk, dir);
    }
    case "project":
      return cmpText(a.project.name, b.project.name, dir);
    case "executor":
      return cmpText(a.executor.name, b.executor.name, dir);
    case "workType":
      return cmpText(a.workType.name, b.workType.name, dir);
    case "responsible":
      return cmpNullableText(a.responsibleExecutor?.name, b.responsibleExecutor?.name, dir);
    case "preferredPayMethod":
      return cmpNullableText(a.preferredPayMethod, b.preferredPayMethod, dir);
    case "plannedPayAt":
      return cmpDate(a.plannedPayAt, b.plannedPayAt, dir);
    case "amount":
      return dir === "asc" ? a.amount - b.amount : b.amount - a.amount;
    case "workStatus": {
      const al = WORK_STATUSES[a.workStatus as keyof typeof WORK_STATUSES]?.label ?? a.workStatus;
      const bl = WORK_STATUSES[b.workStatus as keyof typeof WORK_STATUSES]?.label ?? b.workStatus;
      return cmpText(al, bl, dir);
    }
    case "paymentStatus": {
      const al = a.paymentStatus
        ? (PAYMENT_STATUSES[a.paymentStatus as keyof typeof PAYMENT_STATUSES]?.label ?? a.paymentStatus)
        : "";
      const bl = b.paymentStatus
        ? (PAYMENT_STATUSES[b.paymentStatus as keyof typeof PAYMENT_STATUSES]?.label ?? b.paymentStatus)
        : "";
      return cmpNullableText(al || null, bl || null, dir);
    }
    case "paidAt":
      return cmpDate(a.paidAt, b.paidAt, dir);
    case "bankAccount":
      return cmpNullableText(a.bankAccount?.name, b.bankAccount?.name, dir);
    default:
      return 0;
  }
}

type OtherExpenseTableRowProps = {
  row: OtherExpense;
  rowIndex: number;
  checked: boolean;
  isAdmin: boolean;
  canEditRow: boolean;
  canReviewRow: boolean;
  inlineActive: "plannedPayAt" | "paidAt" | null;
  inlineVal: string;
  onSelect: (index: number, id: string, shiftKey: boolean) => void;
  onInlineValChange: (v: string) => void;
  onStartInline: (row: OtherExpense, field: "plannedPayAt" | "paidAt") => void;
  onCommitInline: (row: OtherExpense) => void;
  onCancelInline: () => void;
  onCheck: (row: OtherExpense) => void;
  onRework: (row: OtherExpense) => void;
  onPay: (row: OtherExpense) => void;
  onEdit: (row: OtherExpense) => void;
  onDuplicate: (row: OtherExpense) => void;
  onDelete: (row: OtherExpense) => void;
};

const OtherExpenseTableRow = React.memo(function OtherExpenseTableRow({
  row,
  rowIndex,
  checked,
  isAdmin,
  canEditRow,
  canReviewRow,
  inlineActive,
  inlineVal,
  onSelect,
  onInlineValChange,
  onStartInline,
  onCommitInline,
  onCancelInline,
  onCheck,
  onRework,
  onPay,
  onEdit,
  onDuplicate,
  onDelete,
}: OtherExpenseTableRowProps) {
  const overdue = isOverduePayment({
    status: row.paymentStatus,
    paidAt: row.paidAt,
    plannedPayAt: row.plannedPayAt,
  });
  return (
    <TableRow className={checked ? "bg-blue-50" : ""}>
      <TableCell>
        <RowSelectCheckbox
          checked={checked}
          rowIndex={rowIndex}
          rowId={row.id}
          onSelect={onSelect}
        />
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">{row.otherExpenseNumber ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap">{MONTHS.find(m => m.value === String(row.executionMonth))?.label ?? row.executionMonth}</TableCell>
      <TableCell>{payWeek(row.plannedPayAt, row.paidAt)}</TableCell>
      <TableCell className={cn(cellClip, "whitespace-normal")}>
        <ExpandableListCell
          items={[row.executor.name]}
          renderItem={() =>
            isAdmin ? (
              <Link
                href={`/admin/executors/${row.executorId}`}
                className="hover:underline text-neutral-900"
              >
                {row.executor.name}
              </Link>
            ) : (
              row.executor.name
            )
          }
        />
      </TableCell>
      <TableCell className={cn(cellClip, "text-right tabular-nums font-semibold whitespace-nowrap")}>
        {formatMoney(row.amount)}
      </TableCell>
      <TableCell className={cn(cellClip, "whitespace-nowrap")}>
        <StatusBadge dict={WORK_STATUSES} value={row.workStatus} />
      </TableCell>
      <TableCell className={cn(cellClip, "whitespace-nowrap", !row.paidAt && overdue && "bg-red-100 text-red-700")}>
        {inlineActive === "plannedPayAt" ? (
          <input
            autoFocus
            type="date"
            value={inlineVal}
            onChange={(e) => onInlineValChange(e.target.value)}
            onBlur={() => onCommitInline(row)}
            onClick={(e) => { try { (e.target as HTMLInputElement).showPicker(); } catch { /**/ } }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitInline(row);
              if (e.key === "Escape") onCancelInline();
            }}
            className="w-full h-6 rounded border border-blue-300 px-1 text-xs bg-blue-50 focus:outline-none cursor-pointer"
          />
        ) : isAdmin ? (
          <button
            type="button"
            className="text-xs text-neutral-600 hover:text-blue-700 hover:underline"
            onClick={() => onStartInline(row, "plannedPayAt")}
          >
            {formatDateShort(row.plannedPayAt)}
          </button>
        ) : (
          <span className="text-xs text-neutral-600">
            {formatDateShort(row.plannedPayAt)}
          </span>
        )}
      </TableCell>
      <TableCell className={cn(cellClip, "text-right tabular-nums whitespace-nowrap")}>
        {row.paymentAmount != null ? formatMoney(row.paymentAmount) : "—"}
      </TableCell>
      <TableCell className={cn(cellClip, "whitespace-nowrap")}>
        {row.paymentStatus ? (
          <StatusBadge dict={PAYMENT_STATUSES} value={row.paymentStatus} />
        ) : (
          <span className="text-neutral-300">—</span>
        )}
      </TableCell>
      <TableCell className={cn(cellClip, "whitespace-nowrap", !!row.paidAt && overdue && "bg-red-100 text-red-700")}>
        {inlineActive === "paidAt" ? (
          <input
            autoFocus
            type="date"
            value={inlineVal}
            onChange={(e) => onInlineValChange(e.target.value)}
            onBlur={() => onCommitInline(row)}
            onClick={(e) => { try { (e.target as HTMLInputElement).showPicker(); } catch { /**/ } }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitInline(row);
              if (e.key === "Escape") onCancelInline();
            }}
            className="w-full h-6 rounded border border-blue-300 px-1 text-xs bg-blue-50 focus:outline-none cursor-pointer"
          />
        ) : row.paymentStatus && isAdmin ? (
          <button
            type="button"
            className="text-xs text-neutral-600 hover:text-blue-700 hover:underline"
            title="Указать дату оплаты"
            onClick={() => onStartInline(row, "paidAt")}
          >
            {row.paidAt ? formatDateShort(row.paidAt) : "—"}
          </button>
        ) : (
          <span className="text-xs text-neutral-600">
            {row.paidAt ? formatDateShort(row.paidAt) : "—"}
          </span>
        )}
      </TableCell>
      <TableCell className={cn(cellClip, "whitespace-normal")}>
        <ExpandableListCell
          items={[row.project.name]}
          renderItem={() => (
            <Link
              href={isAdmin ? `/admin/projects/${row.projectId}` : `/responsible/projects/${row.projectId}`}
              className="hover:underline text-neutral-900"
            >
              {row.project.name}
            </Link>
          )}
        />
      </TableCell>
      <TableCell className={cn(cellClip, "whitespace-normal")}>
        <ExpandableListCell items={[row.workType.name]} />
      </TableCell>
      <TableCell className={cn(cellClip, "whitespace-normal")}>
        <ExpandableListCell items={row.description ? [row.description] : []} />
      </TableCell>
      <TableCell className={cn(cellClip, "whitespace-normal")}>
        <ExpandableListCell items={row.responsibleExecutor ? [row.responsibleExecutor.name] : []} />
      </TableCell>
      <TableCell className={cn(cellClip, "whitespace-normal pr-1")}>
        <ExpandableListCell items={row.bankAccount?.name ? [row.bankAccount.name] : []} />
      </TableCell>
      <TableCell className={cn(cellClip, "whitespace-normal")}>
        {row.preferredPayMethod ? (
          <ExpandableListCell items={[row.preferredPayMethod]} />
        ) : (
          <span className="text-neutral-400">—</span>
        )}
      </TableCell>
      <TableCell>{row.executionYear}</TableCell>
      <TableCell
        className={cn(
          stickyActionsCell,
          "min-w-[152px] w-[152px] max-w-[152px]",
          checked && "bg-blue-50"
        )}
      >
        <div className="flex shrink-0 gap-0.5 items-center justify-end">
          {canReviewRow && !row.paymentStatus && row.workStatus === "submitted" && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Проверить" onClick={() => onCheck(row)}>
              <CheckCircle className="h-3.5 w-3.5 text-blue-600" />
            </Button>
          )}
          {canReviewRow && !row.paymentStatus && row.workStatus === "submitted" && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="На доработку" onClick={() => onRework(row)}>
              <RotateCcw className="h-3.5 w-3.5 text-amber-500" />
            </Button>
          )}
          {isAdmin && row.paymentStatus === "planned" && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Оплатить" onClick={() => onPay(row)}>
              <CircleDollarSign className="h-3.5 w-3.5 text-green-600" />
            </Button>
          )}
          {canEditRow && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Дублировать" onClick={() => onDuplicate(row)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          )}
          {canEditRow && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Редактировать" onClick={() => onEdit(row)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {canEditRow && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Удалить" onClick={() => onDelete(row)}>
              <Trash2 className="h-3.5 w-3.5 text-red-400" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
});

export function OtherExpensesClient({ stateScope, isAdmin, userId, executorId, projects: projectsProp, executors: executorsProp, workTypes: workTypesProp, permanentExecutors: permanentExecutorsProp, bankAccounts: bankAccountsProp }: Props) {
  const projects = React.useMemo(() => sortByNameRu(projectsProp), [projectsProp]);
  const executors = React.useMemo(() => sortByNameRu(executorsProp), [executorsProp]);
  const workTypes = React.useMemo(() => sortByNameRu(workTypesProp), [workTypesProp]);
  const permanentExecutors = React.useMemo(() => sortByNameRu(permanentExecutorsProp), [permanentExecutorsProp]);
  const bankAccounts = React.useMemo(() => sortByNameRu(bankAccountsProp), [bankAccountsProp]);
  const [rows, setRows] = useState<OtherExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OtherExpense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OtherExpense | null>(null);
  const [checkTarget, setCheckTarget] = useState<OtherExpense | null>(null);
  const [reworkTarget, setReworkTarget] = useState<OtherExpense | null>(null);
  const [payTarget, setPayTarget] = useState<OtherExpense | null>(null);
  const [payDate, setPayDate] = useState("");
  const [payWorkAmount, setPayWorkAmount] = useState("");
  const [payPaymentAmount, setPayPaymentAmount] = useState("");

  // Bulk
  const [bulkWorkStatus, setBulkWorkStatus] = useState("");
  const [bulkPlannedPayAt, setBulkPlannedPayAt] = useState("");
  const [bulkPaidAt, setBulkPaidAt] = useState("");
  const [bulkBankId, setBulkBankId] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<{ rowId: string; field: "plannedPayAt" | "paidAt" } | null>(null);
  const [inlineVal, setInlineVal] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);

  // Фильтры
  const [fYear, setFYear] = useState<string[]>([]);
  const [fMonth, setFMonth] = useState<string[]>([]);
  const [fPayWeek, setFPayWeek] = useState<string[]>([]);
  const [fProject, setFProject] = useState<string[]>([]);
  const [fExecutor, setFExecutor] = useState<string[]>([]);
  const [fWorkType, setFWorkType] = useState<string[]>([]);
  const [fResponsible, setFResponsible] = useState<string[]>([]);
  const [fWorkStatus, setFWorkStatus] = useState<string[]>([]);
  const [fPayStatus, setFPayStatus] = useState<string[]>([]);
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir } | null>(null);
  const overdueTotal = React.useMemo(
    () => overduePaymentTotal(rows.map((row) => ({
      status: row.paymentStatus,
      paidAt: row.paidAt,
      plannedPayAt: row.plannedPayAt,
      amount: row.paymentAmount,
    }))),
    [rows]
  );
  const hasActiveFilters =
    fMonth.length > 0 || fPayWeek.length > 0 || fProject.length > 0 ||
    fExecutor.length > 0 || fWorkType.length > 0 || fResponsible.length > 0 ||
    fWorkStatus.length > 0 || fPayStatus.length > 0;
  const resetFilters = () => {
    setFMonth([]); setFPayWeek([]); setFProject([]); setFExecutor([]);
    setFWorkType([]); setFResponsible([]); setFWorkStatus([]); setFPayStatus([]);
  };

  const urlFilters = useUrlSyncedFilters([
    { stateKey: "fYear", param: "year", kind: "array", value: fYear, defaultValue: [], setValue: setFYear },
    { stateKey: "fMonth", param: "month", kind: "array", value: fMonth, defaultValue: [], setValue: setFMonth },
    { stateKey: "fPayWeek", param: "week", kind: "array", value: fPayWeek, defaultValue: [], setValue: setFPayWeek },
    { stateKey: "fProject", param: "project", kind: "array", value: fProject, defaultValue: [], setValue: setFProject },
    { stateKey: "fExecutor", param: "executor", kind: "array", value: fExecutor, defaultValue: [], setValue: setFExecutor },
    { stateKey: "fWorkType", param: "workType", kind: "array", value: fWorkType, defaultValue: [], setValue: setFWorkType },
    { stateKey: "fResponsible", param: "responsible", kind: "array", value: fResponsible, defaultValue: [], setValue: setFResponsible },
    { stateKey: "fWorkStatus", param: "workStatus", kind: "array", value: fWorkStatus, defaultValue: [], setValue: setFWorkStatus },
    { stateKey: "fPayStatus", param: "payStatus", kind: "array", value: fPayStatus, defaultValue: [], setValue: setFPayStatus },
  ]);

  usePersistedInterfaceState(
    `other-expenses:${stateScope}`,
    {
      fYear,
      fMonth,
      fPayWeek,
      fProject,
      fExecutor,
      fWorkType,
      fResponsible,
      fWorkStatus,
      fPayStatus,
      sort,
    },
    (stored) => {
      urlFilters.restorePersisted(stored);
      if ("sort" in stored) setSort(stored.sort ?? null);
    }
  );
  usePersistedScroll(scrollRef, `other-expenses-table:${stateScope}`, {
    enabled: !loading,
    signature: {
      fYear,
      fMonth,
      fPayWeek,
      fProject,
      fExecutor,
      fWorkType,
      fResponsible,
      fWorkStatus,
      fPayStatus,
      sort,
    },
  });

  const fetchData = useCallback(async () => {
    const r = await fetch("/api/other-expenses");
    if (!r.ok) throw new Error();
    return r.json() as Promise<OtherExpense[]>;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await fetchData()); } catch { toast.error("Не удалось загрузить данные"); }
    finally { setLoading(false); }
  }, [fetchData]);

  const silentLoad = useCallback(() => { fetchData().then(setRows).catch(() => {}); }, [fetchData]);

  useEffect(() => { load(); }, [load]);

  function canEdit(row: OtherExpense) {
    if (isAdmin) return true;
    if (row.workStatus === "paid") return false;
    if (row.paymentStatus === "paid") return false;
    // РП может редактировать в том числе при checked
    if (!!executorId && row.responsibleExecutorId === executorId) return true;
    // Создатель — только до проверки
    if (row.workStatus === "checked") return false;
    return row.createdById === userId;
  }

  /** Проверить / отклонить может admin или ответственный по строке. */
  function canReview(row: OtherExpense) {
    if (isAdmin) return true;
    return !!executorId && row.responsibleExecutorId === executorId;
  }

  const allYears = [...new Set(rows.map(r => r.executionYear))].sort();

  const compatibleValues = useCompatibleFilterOptions(rows, [
    {
      key: "year", value: fYear, setValue: setFYear,
      matches: (row, values) => !values.length || values.includes(String(row.executionYear)),
      values: (row) => [String(row.executionYear)],
      protectedFromAutoClear: true,
    },
    {
      key: "month", value: fMonth, setValue: setFMonth,
      matches: (row, values) => !values.length || values.includes(String(row.executionMonth)),
      values: (row) => [String(row.executionMonth)],
    },
    {
      key: "payWeek", value: fPayWeek, setValue: setFPayWeek,
      matches: (row, values) => !values.length || values.includes(payWeekKey(row.plannedPayAt, row.paidAt)),
      values: (row) => [payWeekKey(row.plannedPayAt, row.paidAt)],
    },
    {
      key: "project", value: fProject, setValue: setFProject,
      matches: (row, values) => !values.length || values.includes(row.projectId),
      values: (row) => [row.projectId],
    },
    {
      key: "executor", value: fExecutor, setValue: setFExecutor,
      matches: (row, values) => !values.length || values.includes(row.executorId),
      values: (row) => [row.executorId],
    },
    {
      key: "workType", value: fWorkType, setValue: setFWorkType,
      matches: (row, values) => !values.length || values.includes(row.workTypeId),
      values: (row) => [row.workTypeId],
    },
    {
      key: "responsible", value: fResponsible, setValue: setFResponsible,
      matches: (row, values) => !values.length || values.includes(row.responsibleExecutorId ?? "__empty__"),
      values: (row) => [row.responsibleExecutorId ?? "__empty__"],
    },
    {
      key: "workStatus", value: fWorkStatus, setValue: setFWorkStatus,
      matches: (row, values) => !values.length || values.includes(row.workStatus),
      values: (row) => [row.workStatus],
    },
    {
      key: "payStatus", value: fPayStatus, setValue: setFPayStatus,
      matches: (row, values) => !values.length || values.includes(row.paymentStatus ?? "__empty__"),
      values: (row) => [row.paymentStatus ?? "__empty__"],
    },
  ]);

  const monthOptions = React.useMemo(() => {
    // Серость месяца — в контексте выбранного года, а не всех лет вперемешку.
    const yearScoped = fYear.length
      ? rows.filter((row) => fYear.includes(String(row.executionYear)))
      : rows;
    return MONTHS
      .filter((month) => rows.some((row) => String(row.executionMonth) === month.value))
      .filter((month) => compatibleValues.month?.has(month.value))
      .map((month) => ({
        ...month,
        ...getMonthFilterMetadata(
          yearScoped
            .filter((row) => String(row.executionMonth) === month.value)
            .map((row) => ({ year: row.executionYear, month: row.executionMonth })),
        ),
      }));
  }, [rows, compatibleValues.month, fYear]);

  const projectOptions = React.useMemo(
    () => Array.from(new Map(rows.map((row) => [row.projectId, row.project.name])).entries())
      .filter(([value]) => compatibleValues.project?.has(value))
      .sort((a, b) => a[1].localeCompare(b[1], "ru"))
      .map(([value, label]) => ({ value, label })),
    [rows, compatibleValues.project]
  );

  const executorOptions = React.useMemo(
    () => Array.from(new Map(rows.map((row) => [row.executorId, row.executor.name])).entries())
      .filter(([value]) => compatibleValues.executor?.has(value))
      .sort((a, b) => a[1].localeCompare(b[1], "ru"))
      .map(([value, label]) => ({ value, label })),
    [rows, compatibleValues.executor]
  );

  const filtered = React.useMemo(() => {
    let list = rows.filter(r => {
      if (fYear.length && !fYear.includes(String(r.executionYear))) return false;
      if (fMonth.length && !fMonth.includes(String(r.executionMonth))) return false;
      if (fPayWeek.length) {
        if (!fPayWeek.includes(payWeekKey(r.plannedPayAt, r.paidAt))) return false;
      }
      if (fProject.length && !fProject.includes(r.projectId)) return false;
      if (fExecutor.length && !fExecutor.includes(r.executorId)) return false;
      if (fWorkType.length && !fWorkType.includes(r.workTypeId)) return false;
      if (fResponsible.length && !fResponsible.includes(r.responsibleExecutorId ?? "__empty__")) return false;
      if (fWorkStatus.length && !fWorkStatus.includes(r.workStatus)) return false;
      if (fPayStatus.length && !fPayStatus.includes(r.paymentStatus ?? "__empty__")) return false;
      return true;
    });
    if (sort) {
      list = [...list].sort((a, b) => compareOtherExpenses(a, b, sort.field, sort.dir));
    }
    return list;
  }, [rows, fYear, fMonth, fPayWeek, fProject, fExecutor, fWorkType, fResponsible, fWorkStatus, fPayStatus, sort]);

  function handleSort(field: string, dir: SortDir) {
    setSort({ field: field as SortField, dir });
  }

  const orderedRowIds = React.useMemo(() => filtered.map((r) => r.id), [filtered]);
  const { selectedIds, handleRowSelect, toggleAll, clearSelection } = useTableRowSelection(orderedRowIds);

  async function patchRow(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/other-expenses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const d = await readApiJson<{ error?: string }>(res);
      throw new Error(d.error ?? "Ошибка");
    }
    const updated = await readApiJson<OtherExpense>(res);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
    return updated;
  }

  function startInline(row: OtherExpense, field: "plannedPayAt" | "paidAt") {
    if (field === "paidAt" && !row.paymentStatus) return;
    if (!isAdmin) return;
    setInlineEdit({ rowId: row.id, field });
    if (field === "paidAt") {
      setInlineVal(row.paidAt ? row.paidAt.slice(0, 10) : toLocalDateString(new Date()));
    } else {
      setInlineVal(row.plannedPayAt ? row.plannedPayAt.slice(0, 10) : "");
    }
  }

  async function commitInline(row: OtherExpense) {
    if (!inlineEdit || inlineEdit.rowId !== row.id) return;
    const patch: Record<string, unknown> = {};
    if (inlineEdit.field === "paidAt") {
      patch.paidAt = inlineVal ? new Date(inlineVal).toISOString() : null;
    } else {
      patch.plannedPayAt = inlineVal ? new Date(inlineVal).toISOString() : null;
    }
    try {
      await patchRow(row.id, patch);
      setInlineEdit(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
      silentLoad();
    }
  }

  async function handleCheck(row: OtherExpense) {
    setCheckTarget(null);
    const plannedIso = resolvePlannedPayAtOnCheck(
      row.plannedPayAt ? new Date(row.plannedPayAt) : null
    ).toISOString();
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              workStatus: "checked",
              checkedAt: new Date().toISOString(),
              paymentStatus: "planned",
              paymentAmount: r.amount,
              plannedPayAt: plannedIso,
            }
          : r
      )
    );
    try {
      const res = await fetch(`/api/other-expenses/${row.id}/check`, { method: "POST" });
      if (!res.ok) { const d = await readApiJson<{ error?: string }>(res); throw new Error(d.error ?? "Ошибка"); }
      const updated = await readApiJson<OtherExpense>(res);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...updated } : r)));
      toast.success("Работа проверена, выплата создана");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
      silentLoad();
    }
  }

  async function handleRework(row: OtherExpense) {
    setReworkTarget(null);
    setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, workStatus: "rework" } : r));
    try {
      const res = await fetch(`/api/other-expenses/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workStatus: "rework" }),
      });
      if (!res.ok) { const d = await readApiJson<{ error?: string }>(res); throw new Error(d.error ?? "Ошибка"); }
      const updated = await readApiJson<OtherExpense>(res);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...updated } : r)));
      toast.success("Работа отправлена на доработку");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
      silentLoad();
    }
  }

  async function handlePay(row: OtherExpense, date: string) {
    const workAmt = parseFloat(payWorkAmount);
    const payAmt = parseFloat(payPaymentAmount);
    if (!(workAmt > 0) || !(payAmt > 0)) {
      toast.error("Сумма работы и сумма выплаты должны быть положительными");
      return;
    }
    if (workAmt !== payAmt) {
      toast.error("Сумма работы и сумма выплаты не равны");
      return;
    }
    setPayTarget(null);
    const isoDate = new Date(date).toISOString();
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              amount: workAmt,
              paymentAmount: payAmt,
              paymentStatus: "paid",
              paidAt: isoDate,
              workStatus: "paid",
            }
          : r
      )
    );
    try {
      await patchRow(row.id, {
        amount: workAmt,
        paymentAmount: payAmt,
        paymentStatus: "paid",
        paidAt: isoDate,
      });
      toast.success("Выплата оплачена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
      silentLoad();
    }
  }

  async function handleDelete(row: OtherExpense) {
    setDeleteTarget(null);
    setRows(prev => prev.filter(r => r.id !== row.id));
    try {
      const res = await fetch(`/api/other-expenses/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Строка удалена");
    } catch {
      toast.error("Не удалось удалить");
      silentLoad();
    }
  }

  async function handleBulkApply() {
    const ids = Array.from(selectedIds);
    const patch: Record<string, unknown> = {};
    if (bulkWorkStatus) patch.workStatus = bulkWorkStatus;
    if (bulkPlannedPayAt) patch.plannedPayAt = new Date(bulkPlannedPayAt).toISOString();
    if (bulkPaidAt) patch.paidAt = new Date(bulkPaidAt).toISOString();
    if (bulkBankId && bulkBankId !== "__none__") patch.bankAccountId = bulkBankId;
    if (Object.keys(patch).length === 0) return toast.error("Выберите хотя бы одно поле");
    setBulkSaving(true);
    const res = await fetch("/api/other-expenses/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, patch }),
    });
    setBulkSaving(false);
    if (!res.ok) return toast.error("Ошибка массового обновления");
    const { updated } = await res.json() as { updated: number };
    toast.success(`Обновлено ${updated} записей`);
    clearSelection();
    setBulkWorkStatus(""); setBulkPlannedPayAt(""); setBulkPaidAt(""); setBulkBankId("");
    silentLoad();
  }

  const handleDuplicate = useCallback(async (ids: string[], openEditor: boolean) => {
    try {
      const res = await fetch("/api/other-expenses/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const data = await readApiJson<{ error?: string }>(res);
        throw new Error(data.error ?? "Не удалось дублировать");
      }
      const { created } = await readApiJson<{ created: OtherExpense[] }>(res);
      if (openEditor) {
        setEditTarget(created[0] ?? null);
      } else {
        clearSelection();
      }
      toast.success(created.length === 1 ? "Трата продублирована" : `Продублировано трат: ${created.length}`);
      silentLoad();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось дублировать");
    }
  }, [clearSelection, silentLoad]);

  const th = "border border-neutral-200 px-2 py-1.5 text-left font-medium text-neutral-600 bg-neutral-50 text-xs whitespace-nowrap";
  const thr = th + " text-right";
  const td = "border border-neutral-200 px-2 py-1.5 text-xs";
  const tdr = td + " text-right";

  const workTypeOpts = React.useMemo(() => {
    const map = new Map<string, { label: string; group: string }>();
    for (const r of rows) {
      if (!map.has(r.workTypeId)) {
        map.set(r.workTypeId, { label: r.workType.name, group: r.workType.segment ?? "" });
      }
    }
    return Array.from(map.entries())
      .filter(([value]) => compatibleValues.workType?.has(value))
      .sort((a, b) =>
        (a[1].group ?? "").localeCompare(b[1].group ?? "", "ru") ||
        a[1].label.localeCompare(b[1].label, "ru")
      )
      .map(([value, { label, group }]) => ({ value, label, group }));
  }, [rows, compatibleValues.workType]);

  const payWeekOpts = React.useMemo(() => {
    const map = new Map<string, string>();
    let hasEmpty = false;
    for (const r of rows) {
      const key = payWeekKey(r.plannedPayAt, r.paidAt);
      if (key === "__empty__") {
        hasEmpty = true;
        continue;
      }
      if (!map.has(key)) map.set(key, payWeekFilterLabel(r.plannedPayAt, r.paidAt));
    }
    const opts = Array.from(map.entries())
      .filter(([value]) => compatibleValues.payWeek?.has(value))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, label]) => {
        const [year, week] = value.split("-").map(Number);
        return { value, label, ...getWeekFilterMetadata([{ year, week }]) };
      });
    return hasEmpty && compatibleValues.payWeek?.has("__empty__")
      ? [{ value: "__empty__", label: "Не указано" }, ...opts]
      : opts;
  }, [rows, compatibleValues.payWeek]);

  const responsibleOpts = React.useMemo(() => {
    const map = new Map<string, string>();
    let hasEmpty = false;
    for (const r of rows) {
      if (!r.responsibleExecutorId) {
        hasEmpty = true;
        continue;
      }
      if (!map.has(r.responsibleExecutorId)) {
        map.set(r.responsibleExecutorId, r.responsibleExecutor?.name ?? r.responsibleExecutorId);
      }
    }
    for (const e of permanentExecutors) {
      if (!map.has(e.id)) map.set(e.id, e.name);
    }
    const opts = Array.from(map.entries())
      .filter(([value]) => compatibleValues.responsible?.has(value))
      .sort((a, b) => a[1].localeCompare(b[1], "ru"))
      .map(([value, label]) => ({ value, label }));
    return hasEmpty && compatibleValues.responsible?.has("__empty__")
      ? [{ value: "__empty__", label: "Не указано" }, ...opts]
      : opts;
  }, [rows, permanentExecutors, compatibleValues.responsible]);

  const selectedSum = React.useMemo(() => {
    return filtered.filter(r => selectedIds.has(r.id)).reduce((s, r) => s + (r.amount ?? 0), 0);
  }, [filtered, selectedIds]);

  const onCheckCb = useCallback((row: OtherExpense) => setCheckTarget(row), []);
  const onReworkCb = useCallback((row: OtherExpense) => setReworkTarget(row), []);
  const onPayCb = useCallback((row: OtherExpense) => {
    setPayDate(toLocalDateString(new Date()));
    const amt = String(row.amount);
    setPayWorkAmount(amt);
    setPayPaymentAmount(amt);
    setPayTarget(row);
  }, []);
  const onEditCb = useCallback((row: OtherExpense) => setEditTarget(row), []);
  const onDuplicateCb = useCallback(
    (row: OtherExpense) => handleDuplicate([row.id], true),
    [handleDuplicate]
  );
  const onDeleteCb = useCallback((row: OtherExpense) => setDeleteTarget(row), []);
  const startInlineCb = useCallback(startInline, [isAdmin]);
  const commitInlineCb = useCallback(commitInline, [inlineEdit, inlineVal]);
  const cancelInlineCb = useCallback(() => setInlineEdit(null), []);
  const onInlineValChangeCb = useCallback((v: string) => setInlineVal(v), []);

  const renderRow = React.useCallback(
    (index: number) => {
      const row = filtered[index];
      if (!row) return null;
      const inlineActive =
        inlineEdit?.rowId === row.id ? inlineEdit.field : null;
      return (
        <OtherExpenseTableRow
          key={row.id}
          row={row}
          rowIndex={index}
          checked={selectedIds.has(row.id)}
          isAdmin={isAdmin}
          canEditRow={canEdit(row)}
          canReviewRow={canReview(row)}
          inlineActive={inlineActive}
          inlineVal={inlineActive ? inlineVal : ""}
          onSelect={handleRowSelect}
          onInlineValChange={onInlineValChangeCb}
          onStartInline={startInlineCb}
          onCommitInline={commitInlineCb}
          onCancelInline={cancelInlineCb}
          onCheck={onCheckCb}
          onRework={onReworkCb}
          onPay={onPayCb}
          onEdit={onEditCb}
          onDuplicate={onDuplicateCb}
          onDelete={onDeleteCb}
        />
      );
    },
    [
      filtered,
      selectedIds,
      inlineEdit,
      inlineVal,
      isAdmin,
      handleRowSelect,
      onInlineValChangeCb,
      startInlineCb,
      commitInlineCb,
      cancelInlineCb,
      onCheckCb,
      onReworkCb,
      onPayCb,
      onEditCb,
      onDuplicateCb,
      onDeleteCb,
      userId,
      executorId,
    ]
  );

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <PageHeader title="Прочие траты" actions={<OverduePaymentSummary amount={overdueTotal} />} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Новая трата
        </Button>

        <div className="ml-auto flex flex-wrap gap-2">
          {/* Фильтры */}
          <FilterResetButton active={hasActiveFilters} onClick={resetFilters} />
          <div className="mr-2 border-r pr-2">
            <MultiSelectFilter
              label="Год"
              options={allYears
                .map(y => ({ value: String(y), label: `${y} год` }))
                .filter((option) => compatibleValues.year?.has(option.value))}
              value={fYear}
              onChange={setFYear}
            />
          </div>
          <MultiSelectFilter
            label="Месяц"
            options={monthOptions}
            value={fMonth}
            onChange={setFMonth}
          />
          <MultiSelectFilter
            label="Неделя оплаты"
            options={payWeekOpts}
            value={fPayWeek}
            onChange={setFPayWeek}
          />
          <MultiSelectFilter
            label="Проект"
            options={projectOptions}
            value={fProject}
            onChange={setFProject}
            popoverClassName="w-auto min-w-72 max-w-lg"
            optionLabelClassName="whitespace-normal"
          />
          <MultiSelectFilter
            label="Исполнитель"
            options={executorOptions}
            value={fExecutor}
            onChange={setFExecutor}
          />
          <MultiSelectFilter
            label="Вид работ"
            options={workTypeOpts}
            value={fWorkType}
            onChange={setFWorkType}
          />
          <MultiSelectFilter
            label="Ответственный"
            options={responsibleOpts}
            value={fResponsible}
            onChange={setFResponsible}
          />
          <MultiSelectFilter
            label="Статус работы"
            options={Object.entries(WORK_STATUSES)
              .map(([v, { label: l }]) => ({ value: v, label: l }))
              .filter((option) => compatibleValues.workStatus?.has(option.value))}
            value={fWorkStatus}
            onChange={setFWorkStatus}
          />
          <MultiSelectFilter
            label="Статус выплаты"
            options={[{ value: "__empty__", label: "Пусто" }, ...Object.entries(PAYMENT_STATUSES).map(([v, { label: l }]) => ({ value: v, label: l }))]
              .filter((option) => compatibleValues.payStatus?.has(option.value))}
            value={fPayStatus}
            onChange={setFPayStatus}
          />
        </div>
      </div>

      {/* Bulk toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
          <span className="text-xs font-medium text-blue-700">{selectedIds.size} выбрано</span>
          <span className="text-xs tabular-nums font-semibold text-neutral-700">{formatMoneyRub(selectedSum)}</span>
          <Select value={bulkWorkStatus} onValueChange={(v) => v && setBulkWorkStatus(v)}>
            <SelectTrigger className="h-7 w-44 text-xs">
              <SelectValue>{bulkWorkStatus ? (WORK_STATUSES[bulkWorkStatus as keyof typeof WORK_STATUSES]?.label ?? "Статус работы") : "Статус работы"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="submitted">{WORK_STATUSES.submitted.label}</SelectItem>
              <SelectItem value="rework">{WORK_STATUSES.rework.label}</SelectItem>
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
            <span className="text-xs text-neutral-500">Источник перевода:</span>
            <SearchableSelect
              value={bulkBankId || "__none__"}
              onValueChange={(v) => setBulkBankId(v === "__none__" ? "" : v)}
              options={[
                { value: "__none__", label: "— не менять —" },
                ...bankAccounts.map((bankAccount) => ({ value: bankAccount.id, label: bankAccount.name })),
              ]}
              triggerClassName="h-7 w-44 text-xs"
            />
          </div>
          <Button size="sm" className="h-7 text-xs" onClick={handleBulkApply} disabled={bulkSaving}>
            {bulkSaving ? "..." : "Применить"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => handleDuplicate(Array.from(selectedIds), false)}
            disabled={bulkSaving}
          >
            <Copy className="mr-1 h-3.5 w-3.5" /> Дублировать
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { clearSelection(); setBulkWorkStatus(""); setBulkPlannedPayAt(""); setBulkPaidAt(""); setBulkBankId(""); }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="flex items-center gap-4 px-1 py-1 text-xs text-neutral-500 shrink-0">
          <span>{filtered.length} записей</span>
          <span className="text-xs font-medium tabular-nums text-neutral-800">
            {formatMoneyRub(filtered.reduce((s, r) => s + (r.amount ?? 0), 0))}
          </span>
        </div>
      )}

      <Table
        className="table-fixed w-full"
        style={{ minWidth: TABLE_MIN_WIDTH }}
        containerClassName="rounded-md border bg-white flex-1 min-h-0 min-w-0 overflow-auto"
        containerRef={scrollRef}
      >
          <colgroup>
            {COL_WIDTHS.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox checked={selectedIds.size === filtered.length && filtered.length > 0} onCheckedChange={() => toggleAll(orderedRowIds)} />
              </TableHead>
              <SortableHead field="number" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={cn(compactHead, "text-[10px]")}>
                Номер
              </SortableHead>
              <SortableHead field="executionMonth" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={compactPeriodHead}>
                Месяц выполнения
              </SortableHead>
              <SortableHead field="payWeek" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={compactPeriodHead}>
                Неделя оплаты
              </SortableHead>
              <SortableHead field="executor" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={compactHead}>
                Исполнитель
              </SortableHead>
              <SortableHead field="amount" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={cn(compactHead, "text-right")}>
                Сумма работы
              </SortableHead>
              <SortableHead field="workStatus" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={compactHead}>
                Статус работы
              </SortableHead>
              <SortableHead field="plannedPayAt" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={compactHead}>
                Дата оплаты план
              </SortableHead>
              <TableHead className={cn(compactHead, "text-right")}>Сумма выплаты</TableHead>
              <SortableHead field="paymentStatus" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={compactHead}>
                Статус выплаты
              </SortableHead>
              <SortableHead field="paidAt" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={compactHead}>
                <span className="inline-flex items-center gap-1">
                  Дата оплаты факт
                  {isAdmin && <Pencil className="h-3 w-3 shrink-0 text-neutral-400" aria-hidden />}
                </span>
              </SortableHead>
              <SortableHead field="project" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={compactHead}>
                Проект
              </SortableHead>
              <SortableHead field="workType" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={compactHead}>
                Вид работ
              </SortableHead>
              <TableHead className={compactHead}>Описание работы</TableHead>
              <SortableHead field="responsible" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={compactHead}>
                Ответственный
              </SortableHead>
              <SortableHead field="bankAccount" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={compactHead}>
                Источник перевода
              </SortableHead>
              <SortableHead field="preferredPayMethod" sortBy={sort?.field ?? ""} sortDir={sort?.dir ?? "asc"} onSort={handleSort} className={compactHead}>
                Способ оплаты
              </SortableHead>
              <TableHead className={compactPeriodHead}>Год выполнения</TableHead>
              <TableHead className={cn(stickyActionsHead, "w-[152px] min-w-[152px] max-w-[152px]")} />
            </TableRow>
          </TableHeader>
          <VirtualizedTableBody
            scrollRef={scrollRef}
            rowCount={filtered.length}
            colSpan={COL_COUNT}
            isLoading={loading}
            loading={
              <TableRow>
                <TableCell colSpan={COL_COUNT} className="text-center text-neutral-500 py-8">Загрузка...</TableCell>
              </TableRow>
            }
            isEmpty={filtered.length === 0}
            empty={
              <TableRow>
                <TableCell colSpan={COL_COUNT} className="text-center text-neutral-500 py-8">Нет данных</TableCell>
              </TableRow>
            }
            renderRow={renderRow}
          />
        </Table>

      {/* Диалоги */}
      {createOpen && (
        <OtherExpenseFormDialog
          isAdmin={isAdmin}
          projects={projects} executors={executors} workTypes={workTypes}
          permanentExecutors={permanentExecutors} bankAccounts={bankAccounts}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); silentLoad(); toast.success("Создано"); }}
        />
      )}

      {editTarget && (
        <OtherExpenseFormDialog
          isAdmin={isAdmin}
          canRework={canReview(editTarget)}
          projects={projects} executors={executors} workTypes={workTypes}
          permanentExecutors={permanentExecutors} bankAccounts={bankAccounts}
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); silentLoad(); toast.success("Сохранено"); }}
        />
      )}

      <AlertDialog open={!!checkTarget} onOpenChange={(o) => !o && setCheckTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Проверить работу?</AlertDialogTitle>
            <AlertDialogDescription>
              Статус сменится на «Проверено». Если сумма выплаты не заполнена — подставится сумма работы.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => checkTarget && handleCheck(checkTarget)}>Проверить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reworkTarget} onOpenChange={(o) => !o && setReworkTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отправить на доработку?</AlertDialogTitle>
            <AlertDialogDescription>
              Статус сменится на «Нужно доработать». Исполнитель сможет отредактировать строку.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => reworkTarget && handleRework(reworkTarget)}>На доработку</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить строку?</AlertDialogTitle>
            <AlertDialogDescription>Строка будет удалена без возможности восстановления.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteTarget && handleDelete(deleteTarget)}>
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!payTarget} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Оплатить выплату</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-neutral-600">
              {payTarget?.description}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Сумма работы</Label>
                <Input
                  type="number"
                  className="h-9"
                  value={payWorkAmount}
                  onChange={(e) => setPayWorkAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Сумма выплаты</Label>
                <Input
                  type="number"
                  className="h-9"
                  value={payPaymentAmount}
                  onChange={(e) => setPayPaymentAmount(e.target.value)}
                />
              </div>
            </div>
            {payWorkAmount !== "" &&
              payPaymentAmount !== "" &&
              parseFloat(payWorkAmount) !== parseFloat(payPaymentAmount) && (
                <p className="text-xs text-amber-600">
                  Сумма работы и сумма выплаты не равны
                </p>
              )}
            <div className="space-y-1.5">
              <Label>Дата оплаты</Label>
              <DateInput
                className="h-9"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>Отмена</Button>
            <Button
              onClick={() => payTarget && payDate && handlePay(payTarget, payDate)}
              disabled={
                !payDate ||
                !payWorkAmount ||
                !payPaymentAmount ||
                !(parseFloat(payWorkAmount) > 0) ||
                !(parseFloat(payPaymentAmount) > 0) ||
                parseFloat(payWorkAmount) !== parseFloat(payPaymentAmount)
              }
            >
              Оплатить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Форма создания / редактирования ─────────────────────────────────────────

function OtherExpenseFormDialog({
  isAdmin, canRework = false, projects, executors, workTypes, permanentExecutors, bankAccounts,
  initial, onClose, onSaved,
}: {
  isAdmin: boolean;
  canRework?: boolean;
  projects: ProjectRef[]; executors: Ref[]; workTypes: Ref[]; permanentExecutors: Ref[]; bankAccounts: Ref[];
  initial?: OtherExpense;
  onClose: () => void;
  onSaved: () => void;
}) {
  const now = new Date();
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [executorId, setExecutorId] = useState(initial?.executorId ?? "");
  const [workTypeId, setWorkTypeId] = useState(initial?.workTypeId ?? "");
  const [executorWorkTypeIds, setExecutorWorkTypeIds] = useState<string[] | null>(null);

  // Load work type IDs for selected executor
  React.useEffect(() => {
    if (!executorId) { setExecutorWorkTypeIds(null); return; }
    fetch(`/api/executors/${executorId}/work-type-ids`)
      .then(r => r.json())
      .then((ids: string[]) => { setExecutorWorkTypeIds(ids); })
      .catch(() => setExecutorWorkTypeIds(null));
  }, [executorId]);

  const filteredWorkTypes = React.useMemo(() => {
    if (!executorId) return [];
    if (executorWorkTypeIds) return workTypes.filter(w => executorWorkTypeIds.includes(w.id));
    return workTypes;
  }, [executorId, executorWorkTypeIds, workTypes]);
  // Ответственный = активный постоянный исполнитель. По умолчанию —
  // responsibleExecutorId проекта (подставляется при выборе проекта в новой строке).
  const [responsibleExecutorId, setResponsibleExecutorId] = useState(
    initial?.responsibleExecutorId ?? ""
  );
  const [bankAccountId, setBankAccountId] = useState(initial?.bankAccountId ?? "");
  const [year, setYear] = useState(String(initial?.executionYear ?? now.getFullYear()));
  const [month, setMonth] = useState(String(initial?.executionMonth ?? now.getMonth() + 1));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : "");
  const [paymentAmount, setPaymentAmount] = useState(
    initial?.paymentAmount != null
      ? String(initial.paymentAmount)
      : initial?.amount != null
        ? String(initial.amount)
        : ""
  );
  const [paymentAmountTouched, setPaymentAmountTouched] = useState(
    !!(initial?.paymentAmount != null && initial.paymentAmount !== initial.amount)
  );
  const [preferredPayMethod, setPreferredPayMethod] = useState(initial?.preferredPayMethod ?? "");
  const [plannedPayAt, setPlannedPayAt] = useState(
    initial?.plannedPayAt
      ? toLocalDateString(new Date(initial.plannedPayAt))
      : toLocalDateString(nearestPaymentDate())
  );
  const [workStatus, setWorkStatus] = useState(initial?.workStatus ?? "submitted");
  // Откат «Проверено» → «Выставлено»/«На доработку» + удаление выплаты
  const [revertStatus, setRevertStatus] = useState<string | null>(null);
  // Смена статуса выплаты (только admin: paid → planned)
  const [editPaymentStatus, setEditPaymentStatus] = useState<string>(initial?.paymentStatus ?? "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [saving, setSaving] = useState(false);

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const isEdit = !!initial;
  const paymentCreated = !!initial?.paymentStatus;
  const plannedPayEditable =
    !isEdit || initial!.workStatus === "submitted" || initial!.workStatus === "checked";
  const amountsMismatch =
    amount !== "" && paymentAmount !== "" && parseFloat(amount) !== parseFloat(paymentAmount);
  // Откат разрешён только если выплата ещё «Запланирована» (не оплачена)
  const canRevert = canRework && isEdit && initial?.workStatus === "checked" && initial?.paymentStatus === "planned";
  const responsibleLocked =
    isEdit && (initial!.workStatus === "checked" || initial!.workStatus === "paid");

  function handleAmountChange(value: string) {
    setAmount(value);
    if (!paymentAmountTouched) setPaymentAmount(value);
  }

  function handlePaymentAmountChange(value: string) {
    setPaymentAmountTouched(true);
    setPaymentAmount(value);
  }

  const responsibleOptions = React.useMemo(() => {
    const list = [...permanentExecutors];
    if (
      initial?.responsibleExecutor &&
      initial.responsibleExecutorId &&
      !list.some((e) => e.id === initial.responsibleExecutorId)
    ) {
      list.push(initial.responsibleExecutor);
    }
    return sortByNameRu(list);
  }, [permanentExecutors, initial]);

  async function handleSave() {
    if (!projectId || !executorId || !workTypeId || !responsibleExecutorId || !description || !amount || !paymentAmount) {
      toast.error("Заполните обязательные поля");
      return;
    }
    const amountNum = parseFloat(amount);
    const paymentAmountNum = parseFloat(paymentAmount);
    if (!(amountNum > 0) || !(paymentAmountNum > 0)) {
      toast.error("Сумма работы и сумма выплаты должны быть положительными");
      return;
    }
    if (amountsMismatch) {
      toast.error("Сумма работы и сумма выплаты не равны");
      return;
    }
    setSaving(true);
    try {
      const url = isEdit ? `/api/other-expenses/${initial!.id}` : "/api/other-expenses";
      const method = isEdit ? "PATCH" : "POST";

      const body: Record<string, unknown> = {
        projectId,
        executorId,
        workTypeId,
        executionYear: parseInt(year),
        executionMonth: parseInt(month),
        description,
        amount: amountNum,
        preferredPayMethod: preferredPayMethod || null,
        comment: comment || null,
        plannedPayAt: plannedPayAt || null,
      };

      if (!responsibleLocked) {
        body.responsibleExecutorId = responsibleExecutorId;
      }

      if (isEdit) {
        body.bankAccountId = bankAccountId || null;
      }

      if ((!isEdit || paymentCreated) && !revertStatus) {
        body.paymentAmount = paymentAmountNum;
      }

      if (revertStatus) {
        // Откат «Проверено»: меняем workStatus + удаляем выплату атомарно
        body.workStatus = revertStatus;
        body.paymentStatus = null;
      } else if (!isEdit) {
        // Создание: бэк сам ставит workStatus=submitted
      } else if (!paymentCreated) {
        // Редактирование без выплаты: можно менять submitted/rework
        body.workStatus = workStatus || "submitted";
      } else {
        // Admin может изменить статус выплаты
        if (isAdmin && editPaymentStatus !== (initial?.paymentStatus ?? "")) {
          body.paymentStatus = editPaymentStatus || null;
        }
      }

      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await readApiJson<{ error?: string }>(r);
        throw new Error(d.error ?? "Ошибка");
      }
      await readApiJson(r);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? "Редактировать" : "Новая трата"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 min-w-0">
            <Label>Год *</Label>
            <Select value={year} onValueChange={(v) => setYear(v ?? "")}>
              <SelectTrigger><SelectValue>{year} год</SelectValue></SelectTrigger>
              <SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y} год</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label>Месяц *</Label>
            <Select value={month} onValueChange={(v) => setMonth(v ?? "")}>
              <SelectTrigger><SelectValue>{MONTHS.find(m => m.value === month)?.label}</SelectValue></SelectTrigger>
              <SelectContent>{MONTHS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2 min-w-0">
            <Label>Проект *</Label>
            <SearchableSelect
              value={projectId}
              onValueChange={(v) => {
                const next = v;
                setProjectId(next);
                // Автозаполнение «Ответственного» только в новой строке.
                if (!isEdit) {
                  const pmId = projects.find((p) => p.id === next)?.responsibleExecutorId ?? null;
                  if (pmId) setResponsibleExecutorId(pmId);
                }
              }}
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
              placeholder="Выберите проект"
              contentClassName="max-w-lg"
              optionClassName="whitespace-normal"
            />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label>Исполнитель *</Label>
            <SearchableSelect
              value={executorId}
              onValueChange={(v) => {
                setExecutorId(v);
                setWorkTypeId("");
              }}
              options={executors.map((executor) => ({ value: executor.id, label: executor.name }))}
              placeholder="Выберите"
            />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label>Вид работ *</Label>
            <SearchableSelect
              value={workTypeId}
              onValueChange={setWorkTypeId}
              options={filteredWorkTypes.map((workType) => ({ value: workType.id, label: workType.name }))}
              disabled={!executorId}
              placeholder="Выберите"
              emptyMessage={executorId ? "Нет видов работ у исполнителя" : "Сначала выберите исполнителя"}
              contentClassName="w-80"
            />
          </div>
          <div className="space-y-1.5 col-span-2 min-w-0">
            <Label>Описание работы *</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание..." />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label>Ответственный *</Label>
            <SearchableSelect
              value={responsibleExecutorId}
              onValueChange={setResponsibleExecutorId}
              options={responsibleOptions.map((responsible) => ({
                value: responsible.id,
                label: responsible.name,
              }))}
              disabled={responsibleLocked}
              placeholder={initial?.responsibleExecutor?.name ?? "Выберите"}
            />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label>Способ оплаты</Label>
            <Select value={preferredPayMethod} onValueChange={(v) => setPreferredPayMethod(v ?? "")}>
              <SelectTrigger><SelectValue>{preferredPayMethod || "—"}</SelectValue></SelectTrigger>
              <SelectContent className="w-80">
                <SelectItem value="">—</SelectItem>
                {PREFERRED_PAY_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label>Сумма работы *</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label>Сумма выплаты *</Label>
            <Input
              type="number"
              value={paymentAmount}
              onChange={(e) => handlePaymentAmountChange(e.target.value)}
              placeholder="0"
            />
          </div>
          {amountsMismatch && (
            <p className="col-span-2 text-xs text-amber-600">
              Сумма работы и сумма выплаты не равны
            </p>
          )}
          <div className="space-y-1.5 min-w-0">
            <Label>Дата оплаты — план</Label>
            <DateInput
              className="h-9"
              value={plannedPayAt}
              onChange={(e) => setPlannedPayAt(e.target.value)}
              disabled={!plannedPayEditable}
            />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label>Статус работы</Label>
            {canRevert ? (
              // Откат «Проверено» → «Выставлено»/«На доработку» (только если выплата=«Запланировано»)
              <div className="space-y-1">
                <Select value={revertStatus ?? "checked"} onValueChange={(v) => setRevertStatus(v === "checked" ? null : v)}>
                  <SelectTrigger>
                    <SelectValue>{WORK_STATUSES[(revertStatus ?? "checked") as keyof typeof WORK_STATUSES]?.label ?? (revertStatus ?? "checked")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="submitted">{WORK_STATUSES.submitted.label}</SelectItem>
                    <SelectItem value="rework">{WORK_STATUSES.rework.label}</SelectItem>
                    <SelectItem value="checked">{WORK_STATUSES.checked.label}</SelectItem>
                  </SelectContent>
                </Select>
                {revertStatus && (
                  <p className="text-xs text-amber-600">
                    Выплата будет удалена при сохранении
                  </p>
                )}
              </div>
            ) : !isEdit || paymentCreated ? (
              // Создание или выплата оплачена — только read-only
              <Input
                value={WORK_STATUSES[(revertStatus ?? workStatus) as keyof typeof WORK_STATUSES]?.label ?? workStatus}
                disabled
                className="h-9"
              />
            ) : (
              // Редактирование без выплаты: submitted/rework
              <Select value={workStatus} onValueChange={(v) => v && setWorkStatus(v)}>
                <SelectTrigger>
                  <SelectValue>{WORK_STATUSES[workStatus as keyof typeof WORK_STATUSES]?.label ?? workStatus}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="submitted">{WORK_STATUSES.submitted.label}</SelectItem>
                  {canRework && <SelectItem value="rework">{WORK_STATUSES.rework.label}</SelectItem>}
                </SelectContent>
              </Select>
            )}
          </div>
          {/* Статус выплаты — только admin, только при редактировании с выплатой */}
          {isAdmin && isEdit && paymentCreated && (
            <div className="space-y-1.5 min-w-0">
              <Label>Статус выплаты</Label>
              {initial?.paymentStatus === "planned" ? (
                <Input value={PAYMENT_STATUSES.planned.label} disabled className="h-9" />
              ) : (
                <Select value={editPaymentStatus} onValueChange={(v) => v && setEditPaymentStatus(v)}>
                  <SelectTrigger>
                    <SelectValue>{PAYMENT_STATUSES[editPaymentStatus as keyof typeof PAYMENT_STATUSES]?.label ?? editPaymentStatus}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planned">{PAYMENT_STATUSES.planned.label}</SelectItem>
                    <SelectItem value="paid">{PAYMENT_STATUSES.paid.label}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          {isEdit && (
            <div className="space-y-1.5 min-w-0">
              <Label>Источник перевода</Label>
              <SearchableSelect
                value={bankAccountId}
                onValueChange={setBankAccountId}
                options={[
                  { value: "", label: "—" },
                  ...bankAccounts.map((bankAccount) => ({ value: bankAccount.id, label: bankAccount.name })),
                ]}
              />
            </div>
          )}
          <div className="space-y-1.5 min-w-0">
            <Label>Комментарий</Label>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </div>
        {isAdmin && initial && (
          <EntityActivityHistory
            entityType="OtherExpense"
            entityId={initial.id}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button
            onClick={handleSave}
            disabled={
              saving ||
              !amount ||
              !paymentAmount ||
              !(parseFloat(amount) > 0) ||
              !(parseFloat(paymentAmount) > 0) ||
              amountsMismatch
            }
          >
            {saving ? "Сохранение..." : isEdit ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
