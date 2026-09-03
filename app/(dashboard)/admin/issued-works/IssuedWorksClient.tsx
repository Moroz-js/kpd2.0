"use client";

import * as React from "react";
import useSWR from "swr";
import Link from "next/link";
import { toast } from "sonner";
import { Pencil, CheckCircle2, X } from "lucide-react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { MoreFilters } from "@/components/ui-custom/MoreFilters";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { OverduePaymentSummary } from "@/components/ui-custom/OverduePaymentSummary";
import { FilterResetButton } from "@/components/ui-custom/FilterResetButton";
import { WORK_STATUSES, WORK_STATUSES_SETTABLE } from "@/lib/statuses";
import { formatMoney, formatMoneyRub, formatDateShort, weekLabel, monthLabel, MONTHS } from "@/lib/format";
import { isOverduePayment, overduePaymentTotal } from "@/lib/overdue-payments";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui-custom/DateInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { RowSelectCheckbox } from "@/components/ui-custom/RowSelectCheckbox";
import { useTableRowSelection } from "@/lib/useTableRowSelection";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner, compactTable, compactHead, compactPeriodHead, compactCell, compactCellClip } from "@/lib/table-styles";
import { IssuedWorkEditDialog, type SmetaType } from "./IssuedWorkEditDialog";
import { PayoutEditDialog } from "../payouts/PayoutEditDialog";
import type { PayoutRowDTO } from "../payouts/PayoutsClient";
import { isUnknownExecutorName } from "@/lib/executor-names";
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

const periodYearMonthClass = "w-20 max-w-20 px-1";
const weekPayClass = "w-20 max-w-20 px-1";
const COL_WIDTHS = [40, 96, 104, 80, 160, 110, 130, 112, 112, 112, 180, 150, 220, 150, 120, 100, 84, 128] as const;
const COL_COUNT = COL_WIDTHS.length;
const TABLE_MIN_WIDTH = COL_WIDTHS.reduce((sum, width) => sum + width, 0);

type Row = {
  sourceType: "personal" | "other-expense";
  sourceId: string;
  number: string | null;
  numberYear: number | null;
  numberSerial: number | null;
  executionYear: number;
  executionMonth: number;
  weekPlanFact: number | null;
  yearPlanFact: number | null;
  executorId: string;
  executorName: string;
  executorType: string;
  executorAccessEmail: string | null;
  executorCanOpenEstimate: boolean;
  projectId: string;
  projectName: string;
  projectType: string;
  workTypeId: string;
  workTypeName: string;
  workTypeSegment: string;
  responsibleExecutorId: string | null;
  responsibleExecutorName: string | null;
  amount: number;
  description: string | null;
  workStatus: string;
  paymentId: string | null;
  payoutNumber: string | null;
  paymentStatus: string | null;
  checkedAt: string | null;
  paidAt: string | null;
  plannedPayAt: string | null;
};
export type IssuedWorkRowDTO = Row;

type ProjectOption = { id: string; name: string; status: string };
type ExecutorOption = { id: string; name: string; status: string };
type WorkTypeOption = { id: string; name: string; status: string };

const fetcher = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<T>;
  });

type SortField =
  | "number"
  | "weekPlanFact"
  | "projectName"
  | "executorName"
  | "responsibleExecutorName"
  | "executionMonth"
  | "executionYear"
  | "workTypeName"
  | "amount"
  | "workStatus";
type SortDir = "asc" | "desc";

const SMETA_LABEL: Record<SmetaType, string> = {
  personal: "Личная смета",
  "other-expense": "Прочие траты",
};

function smetaTypeCell(row: Row) {
  if (row.sourceType === "personal") {
    if (
      row.executorCanOpenEstimate &&
      !isUnknownExecutorName(row.executorName)
    ) {
      return (
        <Link
          href={`/admin/executors/${row.executorId}?tab=works`}
          className="text-blue-600 hover:underline"
          title="Открыть личную смету"
        >
          {SMETA_LABEL.personal}
        </Link>
      );
    }
    return SMETA_LABEL.personal;
  }
  return SMETA_LABEL["other-expense"];
}

function issuedWorkRowId(r: Row) {
  return `${r.sourceType}:${r.sourceId}`;
}

function issuedWorkWeekKey(r: Row): string {
  if (r.weekPlanFact == null || r.yearPlanFact == null) return "__empty__";
  return `${r.yearPlanFact}-${String(r.weekPlanFact).padStart(2, "0")}`;
}

function issuedWorkWeekLabel(r: Row): string {
  if (r.weekPlanFact == null || r.yearPlanFact == null) return "Не указано";
  return `${weekLabel(r.weekPlanFact)} ${r.yearPlanFact}`;
}

const ISSUED_WORK_GROUP_OPTIONS = [
  { value: "executor", label: "Исполнитель" },
  { value: "week", label: "Неделя оплаты" },
  { value: "project", label: "Проект" },
  { value: "workType", label: "Вид работ" },
] as const;

type IssuedWorkRowProps = {
  row: Row;
  rowIndex: number;
  checked: boolean;
  onSelect: (index: number, id: string, shiftKey: boolean) => void;
  onEdit: (row: Row) => void;
  onCheck: (row: Row) => void;
  onOpenPayment: (row: Row) => void;
};

const IssuedWorkRow = React.memo(function IssuedWorkRow({
  row: r,
  rowIndex,
  checked,
  onSelect,
  onEdit,
  onCheck,
  onOpenPayment,
}: IssuedWorkRowProps) {
  const id = issuedWorkRowId(r);
  const overdue = isOverduePayment({
    status: r.workStatus,
    paidAt: r.paidAt,
    plannedPayAt: r.plannedPayAt,
  });
  return (
    <TableRow
      className={`${checked ? "bg-blue-50" : ""} ${r.workStatus === "archived" ? "bg-neutral-50 text-neutral-400" : ""}`.trim()}
    >
      <TableCell>
        <RowSelectCheckbox
          checked={checked}
          rowIndex={rowIndex}
          rowId={id}
          onSelect={onSelect}
        />
      </TableCell>
      <TableCell className={cn(compactCell, "w-24 whitespace-nowrap tabular-nums")}>
        {r.number ?? "—"}
      </TableCell>
      <TableCell className={cn(compactCell, "whitespace-nowrap", periodYearMonthClass)}>
        {monthLabel(r.executionMonth)}
      </TableCell>
      <TableCell className={cn(compactCell, "whitespace-nowrap", weekPayClass)}>
        {r.weekPlanFact != null ? weekLabel(r.weekPlanFact) : "—"}
      </TableCell>
      <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
        {r.executorName}
      </TableCell>
      <TableCell className={cn(compactCell, "text-right tabular-nums font-semibold")}>{formatMoney(r.amount)}</TableCell>
      <TableCell className={compactCell}>
        <StatusBadge dict={WORK_STATUSES} value={r.workStatus} />
      </TableCell>
      <TableCell className={compactCell}>{formatDateShort(r.checkedAt)}</TableCell>
      <TableCell className={cn(compactCell, !r.paidAt && overdue && "bg-red-100 text-red-700")}>{formatDateShort(r.plannedPayAt)}</TableCell>
      <TableCell className={cn(compactCell, (r.workStatus === "paid" && !r.paidAt || (!!r.paidAt && overdue)) && "bg-red-100 text-red-700")}>
        {formatDateShort(r.paidAt)}
      </TableCell>
      <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>{r.projectName}</TableCell>
      <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>{r.workTypeName}</TableCell>
      <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")} title={r.description ?? undefined}>
        <div className="truncate">{r.description ?? "—"}</div>
      </TableCell>
      <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
        {r.responsibleExecutorName ?? "—"}
      </TableCell>
      <TableCell className={cn(compactCell, compactCellClip, "tabular-nums")}>
        {r.paymentId && r.payoutNumber ? (
          <button
            type="button"
            title={r.payoutNumber}
            className="block w-full truncate text-left text-blue-600 hover:underline"
            onClick={() => onOpenPayment(r)}
          >
            {r.payoutNumber}
          </button>
        ) : "—"}
      </TableCell>
      <TableCell className={compactCell}>{smetaTypeCell(r)}</TableCell>
      <TableCell className={cn(compactCell, "tabular-nums text-left", periodYearMonthClass)}>
        {r.executionYear}
      </TableCell>
      <TableCell
        className={cn(
          stickyActionsCell,
          checked && "bg-blue-50",
          r.workStatus === "archived" && "bg-neutral-50"
        )}
      >
        <div className={stickyActionsInner}>
          <Button size="sm" variant="ghost" onClick={() => onEdit(r)} title="Редактировать">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {r.workStatus === "submitted" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onCheck(r)}
              title="Проставить «Проверено»"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
});

export function IssuedWorksClient() {
  const { data, isLoading, mutate } = useSWR<Row[]>("/api/issued-works", fetcher);
  const { data: projects } = useSWR<ProjectOption[]>("/api/projects/options", fetcher);
  const { data: executors } = useSWR<ExecutorOption[]>("/api/executors", fetcher);
  const { data: workTypes } = useSWR<WorkTypeOption[]>("/api/work-types", fetcher);
  const { data: payouts } = useSWR<PayoutRowDTO[]>("/api/payouts", fetcher);
  const { data: banks } = useSWR<{ id: string; name: string; status: string }[]>("/api/bank-accounts", fetcher);

  const [yearPlanFactFilter, setYearPlanFactFilter] = React.useState<string[]>([String(new Date().getFullYear())]);
  const [executionYearFilter, setExecutionYearFilter] = React.useState<string[]>([]);
  const [executionMonthFilter, setExecutionMonthFilter] = React.useState<string[]>([]);
  const [weekFilter, setWeekFilter] = React.useState<string[]>([]);
  const [executorFilter, setExecutorFilter] = React.useState<string[]>([]);
  const [responsibleExecutorFilter, setResponsibleExecutorFilter] = React.useState<string[]>([]);
  const [projectFilter, setProjectFilter] = React.useState<string[]>([]);
  const [workTypeFilter, setWorkTypeFilter] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<string[]>([]);
  const [smetaFilter, setSmetaFilter] = React.useState<string[]>([]);
  const [overdueOnly, setOverdueOnly] = React.useState(false);
  const [groupBy, setGroupBy] = React.useState<"" | "executor" | "week" | "project" | "workType">("");
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => new Set());

  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }[]>([
    { field: "weekPlanFact", dir: "desc" },
    { field: "projectName", dir: "asc" },
    { field: "executorName", dir: "asc" },
    { field: "executionMonth", dir: "desc" },
  ]);

  const [editing, setEditing] = React.useState<Row | null>(null);
  const [editingPayment, setEditingPayment] = React.useState<PayoutRowDTO | null>(null);
  const hasActiveFilters =
    executionYearFilter.length > 0 || executionMonthFilter.length > 0 ||
    weekFilter.length > 0 || executorFilter.length > 0 || responsibleExecutorFilter.length > 0 ||
    projectFilter.length > 0 || workTypeFilter.length > 0 || statusFilter.length > 0 ||
    smetaFilter.length > 0 || overdueOnly;
  const resetFilters = () => {
    setExecutionYearFilter([]); setExecutionMonthFilter([]); setWeekFilter([]);
    setExecutorFilter([]); setResponsibleExecutorFilter([]); setProjectFilter([]);
    setWorkTypeFilter([]); setStatusFilter([]); setSmetaFilter([]); setOverdueOnly(false);
  };
  const showOverdue = () => {
    // Сумма в шапке не ограничена годом и прочими фильтрами, поэтому показываем
    // ровно те строки, которые в неё входят.
    setYearPlanFactFilter(
      Array.from(
        new Set(
          (data ?? []).map((row) =>
            row.yearPlanFact === null ? "__empty__" : String(row.yearPlanFact)
          )
        )
      )
    );
    setExecutionYearFilter([]); setExecutionMonthFilter([]); setWeekFilter([]);
    setExecutorFilter([]); setResponsibleExecutorFilter([]); setProjectFilter([]);
    setWorkTypeFilter([]); setStatusFilter([]); setSmetaFilter([]);
    setOverdueOnly(true);
  };

  const urlFilters = useUrlSyncedFilters([
    { stateKey: "yearPlanFactFilter", param: "planYear", kind: "array", value: yearPlanFactFilter, defaultValue: [String(new Date().getFullYear())], setValue: setYearPlanFactFilter },
    { stateKey: "executionYearFilter", param: "execYear", kind: "array", value: executionYearFilter, defaultValue: [], setValue: setExecutionYearFilter },
    { stateKey: "executionMonthFilter", param: "execMonth", kind: "array", value: executionMonthFilter, defaultValue: [], setValue: setExecutionMonthFilter },
    { stateKey: "weekFilter", param: "week", kind: "array", value: weekFilter, defaultValue: [], setValue: setWeekFilter },
    { stateKey: "executorFilter", param: "executor", kind: "array", value: executorFilter, defaultValue: [], setValue: setExecutorFilter },
    { stateKey: "responsibleExecutorFilter", param: "responsible", kind: "array", value: responsibleExecutorFilter, defaultValue: [], setValue: setResponsibleExecutorFilter },
    { stateKey: "projectFilter", param: "project", kind: "array", value: projectFilter, defaultValue: [], setValue: setProjectFilter },
    { stateKey: "workTypeFilter", param: "workType", kind: "array", value: workTypeFilter, defaultValue: [], setValue: setWorkTypeFilter },
    { stateKey: "statusFilter", param: "status", kind: "array", value: statusFilter, defaultValue: [], setValue: setStatusFilter },
    { stateKey: "smetaFilter", param: "smeta", kind: "array", value: smetaFilter, defaultValue: [], setValue: setSmetaFilter },
    { stateKey: "overdueOnly", param: "overdue", kind: "boolean", value: overdueOnly, defaultValue: false, setValue: setOverdueOnly },
  ]);

  // Bulk
  const [bulkStatus, setBulkStatus] = React.useState("");
  const [bulkPlannedPayAt, setBulkPlannedPayAt] = React.useState("");
  const [bulkSaving, setBulkSaving] = React.useState(false);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  usePersistedInterfaceState(
    "issued-works",
    {
      yearPlanFactFilter,
      executionYearFilter,
      executionMonthFilter,
      weekFilter,
      executorFilter,
      responsibleExecutorFilter,
      projectFilter,
      workTypeFilter,
      statusFilter,
      smetaFilter,
      overdueOnly,
      groupBy,
      collapsedGroups,
      sort,
    },
    (stored) => {
      urlFilters.restorePersisted(stored);
      if (stored.groupBy !== undefined) setGroupBy(stored.groupBy);
      if (stored.collapsedGroups instanceof Set) setCollapsedGroups(stored.collapsedGroups);
      if (stored.sort) setSort(stored.sort);
    }
  );
  usePersistedScroll(scrollRef, "issued-works-table", {
    enabled: !isLoading && !!data,
    signature: {
      yearPlanFactFilter,
      executionYearFilter,
      executionMonthFilter,
      weekFilter,
      executorFilter,
      responsibleExecutorFilter,
      projectFilter,
      workTypeFilter,
      statusFilter,
      smetaFilter,
      overdueOnly,
      groupBy,
      collapsedGroups,
      sort,
    },
  });

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
  const overdueTotal = React.useMemo(
    () => overduePaymentTotal(allRows.map((row) => ({
      status: row.workStatus,
      paidAt: row.paidAt,
      plannedPayAt: row.plannedPayAt,
      amount: row.amount,
    }))),
    [allRows]
  );

  const compatibleValues = useCompatibleFilterOptions(allRows, [
    {
      key: "yearPlanFact", value: yearPlanFactFilter, setValue: setYearPlanFactFilter,
      matches: (row, values) => !values.length || values.includes(row.yearPlanFact === null ? "__empty__" : String(row.yearPlanFact)),
      values: (row) => [row.yearPlanFact === null ? "__empty__" : String(row.yearPlanFact)],
      protectedFromAutoClear: true,
    },
    {
      key: "execYear", value: executionYearFilter, setValue: setExecutionYearFilter,
      matches: (row, values) => !values.length || values.includes(String(row.executionYear)),
      values: (row) => [String(row.executionYear)],
    },
    {
      key: "execMonth", value: executionMonthFilter, setValue: setExecutionMonthFilter,
      matches: (row, values) => !values.length || values.includes(String(row.executionMonth)),
      values: (row) => [String(row.executionMonth)],
    },
    {
      key: "week", value: weekFilter, setValue: setWeekFilter,
      matches: (row, values) => !values.length || values.includes(issuedWorkWeekKey(row)),
      values: (row) => [issuedWorkWeekKey(row)],
    },
    {
      key: "executor", value: executorFilter, setValue: setExecutorFilter,
      matches: (row, values) => !values.length || values.includes(row.executorId),
      values: (row) => [row.executorId],
    },
    {
      key: "responsible", value: responsibleExecutorFilter, setValue: setResponsibleExecutorFilter,
      matches: (row, values) => !values.length || values.includes(row.responsibleExecutorId ?? "__empty__"),
      values: (row) => [row.responsibleExecutorId ?? "__empty__"],
    },
    {
      key: "project", value: projectFilter, setValue: setProjectFilter,
      matches: (row, values) => !values.length || values.includes(row.projectId),
      values: (row) => [row.projectId],
    },
    {
      key: "workType", value: workTypeFilter, setValue: setWorkTypeFilter,
      matches: (row, values) => !values.length || values.includes(row.workTypeId),
      values: (row) => [row.workTypeId],
    },
    {
      key: "status", value: statusFilter, setValue: setStatusFilter,
      matches: (row, values) => !values.length || values.includes(row.workStatus),
      values: (row) => [row.workStatus],
    },
    {
      key: "smeta", value: smetaFilter, setValue: setSmetaFilter,
      matches: (row, values) => !values.length || values.includes(row.sourceType),
      values: (row) => [row.sourceType],
    },
  ]);

  const yearOptions = React.useMemo(() => {
    const opts = Array.from(
      new Set(allRows.map((r) => r.yearPlanFact).filter((v): v is number => v != null))
    ).sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }))
      .filter((option) => compatibleValues.yearPlanFact?.has(option.value));
    const hasEmpty = allRows.some((r) => r.yearPlanFact === null);
    return hasEmpty && compatibleValues.yearPlanFact?.has("__empty__")
      ? [{ value: "__empty__", label: "Пусто" }, ...opts]
      : opts;
  }, [allRows, compatibleValues.yearPlanFact]);
  const execYearOptions = React.useMemo(
    () =>
      Array.from(new Set(allRows.map((r) => r.executionYear)))
        .sort((a, b) => b - a)
        .map((y) => ({ value: String(y), label: String(y) }))
        .filter((option) => compatibleValues.execYear?.has(option.value)),
    [allRows, compatibleValues.execYear]
  );
  const monthOptions = React.useMemo(() => {
    // Серость месяца — в контексте выбранного года выполнения, а не всех лет вперемешку.
    const yearScoped = executionYearFilter.length
      ? allRows.filter((row) => executionYearFilter.includes(String(row.executionYear)))
      : allRows;
    return MONTHS
      .filter((month) => allRows.some((row) => String(row.executionMonth) === month.value))
      .filter((month) => compatibleValues.execMonth?.has(month.value))
      .map((month) => ({
        ...month,
        ...getMonthFilterMetadata(
          yearScoped
            .filter((row) => String(row.executionMonth) === month.value)
            .map((row) => ({ year: row.executionYear, month: row.executionMonth })),
        ),
      }));
  }, [allRows, compatibleValues.execMonth, executionYearFilter]);
  const weekOptions = React.useMemo(() => {
    // Ключ включает год ("YYYY-WW"): неделя №2 2025-го и неделя №2 2026-го — это
    // разные календарные периоды и не должны схлопываться в один вариант фильтра
    // (иначе «прошлое» и «будущее» смешиваются под одним номером недели).
    const map = new Map<string, { year: number; week: number }>();
    for (const row of allRows) {
      if (row.weekPlanFact == null || row.yearPlanFact == null) continue;
      const key = issuedWorkWeekKey(row);
      if (!map.has(key)) map.set(key, { year: row.yearPlanFact, week: row.weekPlanFact });
    }
    const opts = Array.from(map.entries())
      .filter(([key]) => compatibleValues.week?.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, period]) => ({
        value: key,
        label: `${weekLabel(period.week)} ${period.year}`,
        ...getWeekFilterMetadata([period]),
      }));
    const hasEmpty = allRows.some((r) => r.weekPlanFact === null);
    return hasEmpty && compatibleValues.week?.has("__empty__")
      ? [{ value: "__empty__", label: "Пусто" }, ...opts]
      : opts;
  }, [allRows, compatibleValues.week]);
  const executorOptions = React.useMemo(
    () =>
      Array.from(new Map(allRows.map((r) => [r.executorId, r.executorName])).entries())
        .filter(([value]) => compatibleValues.executor?.has(value))
        .sort((a, b) => a[1].localeCompare(b[1], "ru"))
        .map(([value, label]) => ({ value, label })),
    [allRows, compatibleValues.executor]
  );
  const responsibleExecutorOptions = React.useMemo(() => {
    const optionsById = new Map<string, string>();
    let hasEmpty = false;
    for (const row of allRows) {
      if (!row.responsibleExecutorId) {
        hasEmpty = true;
      } else if (!optionsById.has(row.responsibleExecutorId)) {
        optionsById.set(
          row.responsibleExecutorId,
          row.responsibleExecutorName ?? row.responsibleExecutorId
        );
      }
    }
    const options = Array.from(optionsById.entries())
      .filter(([value]) => compatibleValues.responsible?.has(value))
      .sort((a, b) => a[1].localeCompare(b[1], "ru"))
      .map(([value, label]) => ({ value, label }));
    return hasEmpty && compatibleValues.responsible?.has("__empty__")
      ? [{ value: "__empty__", label: "Не указано" }, ...options]
      : options;
  }, [allRows, compatibleValues.responsible]);
  const projectOptions = React.useMemo(
    () =>
      Array.from(new Map(allRows.map((r) => [r.projectId, r.projectName])).entries())
        .filter(([value]) => compatibleValues.project?.has(value))
        .sort((a, b) => a[1].localeCompare(b[1], "ru"))
        .map(([value, label]) => ({ value, label })),
    [allRows, compatibleValues.project]
  );
  const workTypeOptions = React.useMemo(() => {
    const map = new Map<string, { label: string; group: string }>();
    for (const r of allRows) {
      if (!map.has(r.workTypeId)) {
        map.set(r.workTypeId, { label: r.workTypeName, group: r.workTypeSegment ?? "" });
      }
    }
    return Array.from(map.entries())
      .filter(([value]) => compatibleValues.workType?.has(value))
      .sort((a, b) =>
        (a[1].group ?? "").localeCompare(b[1].group ?? "", "ru") ||
        a[1].label.localeCompare(b[1].label, "ru")
      )
      .map(([value, { label, group }]) => ({ value, label, group }));
  }, [allRows, compatibleValues.workType]);

  const rows = React.useMemo(() => {
    let list = allRows;
    if (yearPlanFactFilter.length)
      list = list.filter((r) => yearPlanFactFilter.includes(r.yearPlanFact === null ? "__empty__" : String(r.yearPlanFact)));
    if (executionYearFilter.length)
      list = list.filter((r) => executionYearFilter.includes(String(r.executionYear)));
    if (executionMonthFilter.length)
      list = list.filter((r) => executionMonthFilter.includes(String(r.executionMonth)));
    if (weekFilter.length) list = list.filter((r) => weekFilter.includes(issuedWorkWeekKey(r)));
    if (executorFilter.length) list = list.filter((r) => executorFilter.includes(r.executorId));
    if (responsibleExecutorFilter.length)
      list = list.filter((r) =>
        responsibleExecutorFilter.includes(r.responsibleExecutorId ?? "__empty__")
      );
    if (projectFilter.length) list = list.filter((r) => projectFilter.includes(r.projectId));
    if (workTypeFilter.length) list = list.filter((r) => workTypeFilter.includes(r.workTypeId));
    if (statusFilter.length) list = list.filter((r) => statusFilter.includes(r.workStatus));
    if (smetaFilter.length) list = list.filter((r) => smetaFilter.includes(r.sourceType));
    if (overdueOnly) {
      list = list.filter((r) => isOverduePayment({
        status: r.workStatus,
        paidAt: r.paidAt,
        plannedPayAt: r.plannedPayAt,
      }));
    }
    return [...list].sort(compareRows);
  }, [
    allRows,
    yearPlanFactFilter,
    executionYearFilter,
    executionMonthFilter,
    weekFilter,
    executorFilter,
    responsibleExecutorFilter,
    projectFilter,
    workTypeFilter,
    statusFilter,
    smetaFilter,
    overdueOnly,
    sort,
  ]);

  const orderedRowIds = React.useMemo(() => rows.map(issuedWorkRowId), [rows]);
  const rowIndexById = React.useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r, i) => map.set(issuedWorkRowId(r), i));
    return map;
  }, [rows]);
  const { selectedIds, handleRowSelect, toggleAll, clearSelection } = useTableRowSelection(orderedRowIds);

  const flatItems = React.useMemo((): FlatGroupItem<Row>[] | null => {
    if (!groupBy) return null;
    const getKey = (r: Row): string => {
      if (groupBy === "executor") return r.executorId || "__empty__";
      if (groupBy === "week") return issuedWorkWeekKey(r);
      if (groupBy === "project") return r.projectId || "__empty__";
      return r.workTypeId || "__empty__";
    };
    const getLabel = (r: Row): string => {
      if (groupBy === "executor") return r.executorName || "Не указано";
      if (groupBy === "week") return issuedWorkWeekLabel(r);
      if (groupBy === "project") return r.projectName || "Не указано";
      return r.workTypeName || "Не указано";
    };
    const primary = sort[0];
    const groupAligned =
      (groupBy === "executor" && primary?.field === "executorName") ||
      (groupBy === "week" && primary?.field === "weekPlanFact") ||
      (groupBy === "project" && primary?.field === "projectName") ||
      (groupBy === "workType" && primary?.field === "workTypeName");
    // Неделя — от новой к старой; остальное — по алфавиту (если сорт по полю группы — берём его направление)
    const defaultGroupDir: SortDir = groupBy === "week" ? "desc" : "asc";
    const groupDir: SortDir = groupAligned ? (primary?.dir ?? defaultGroupDir) : defaultGroupDir;
    return buildGroupedFlatList(rows, getKey, getLabel, (r) => r.amount, collapsedGroups, {
      compareRows,
      compareGroups: (a, b) =>
        groupBy === "week"
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
      v === "executor" || v === "week" || v === "project" || v === "workType" ? v : ""
    );
    setCollapsedGroups(new Set());
  }, []);

  const { displayCount, displaySum } = React.useMemo(() => {
    if (selectedIds.size === 0) {
      let sum = 0;
      for (const r of rows) sum += r.amount;
      return { displayCount: rows.length, displaySum: sum };
    }
    let sum = 0;
    let count = 0;
    for (const r of rows) {
      if (selectedIds.has(issuedWorkRowId(r))) {
        sum += r.amount;
        count += 1;
      }
    }
    return { displayCount: count, displaySum: sum };
  }, [rows, selectedIds]);

  const handleEdit = React.useCallback((row: Row) => setEditing(row), []);
  const handleOpenPayment = React.useCallback((row: Row) => {
    // Для «Личной сметы» Payout.sourceId — это id выплаты (Payment.id), а не id работы,
    // поэтому сопоставляем по row.paymentId; для «Прочих трат» sourceId совпадает.
    const targetId = row.sourceType === "personal" ? row.paymentId : row.sourceId;
    if (!targetId) return toast.error("Выплата не найдена");
    const payment = payouts?.find(
      (item) => item.sourceType === row.sourceType && item.sourceId === targetId
    );
    if (!payment) return toast.error("Выплата не найдена");
    setEditingPayment(payment);
  }, [payouts]);

  const handleCheckRow = React.useCallback(
    async (row: Row) => {
      const compositeId = `${row.sourceType}:${row.sourceId}`;
      const res = await fetch(`/api/issued-works/${compositeId}/check`, { method: "POST" });
      if (!res.ok) return toast.error("Не удалось проставить «Проверено»");
      toast.success("Работа проверена");
      mutate();
    },
    [mutate]
  );

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
              colSpan={COL_COUNT}
            />
          );
        }
        const r = item.row;
        const id = issuedWorkRowId(r);
        const rowIndex = rowIndexById.get(id) ?? 0;
        return (
          <IssuedWorkRow
            key={id}
            row={r}
            rowIndex={rowIndex}
            checked={selectedIds.has(id)}
            onSelect={handleRowSelect}
            onEdit={handleEdit}
            onCheck={handleCheckRow}
            onOpenPayment={handleOpenPayment}
          />
        );
      }
      const r = rows[index];
      if (!r) return null;
      const id = issuedWorkRowId(r);
      return (
        <IssuedWorkRow
          key={id}
          row={r}
          rowIndex={index}
          checked={selectedIds.has(id)}
          onSelect={handleRowSelect}
          onEdit={handleEdit}
          onCheck={handleCheckRow}
          onOpenPayment={handleOpenPayment}
        />
      );
    },
    [flatItems, rows, rowIndexById, selectedIds, handleRowSelect, handleEdit, handleCheckRow, handleOpenPayment, toggleGroup]
  );

  async function handleBulkApply() {
    const ids = Array.from(selectedIds);
    const patch: Record<string, unknown> = {};
    if (bulkStatus) patch.workStatus = bulkStatus;
    if (bulkPlannedPayAt) patch.plannedPayAt = new Date(bulkPlannedPayAt).toISOString();
    if (Object.keys(patch).length === 0) return toast.error("Выберите хотя бы одно поле");
    setBulkSaving(true);
    const res = await fetch("/api/issued-works/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, patch }),
    });
    setBulkSaving(false);
    if (!res.ok) return toast.error("Ошибка массового обновления");
    const { updated } = await res.json() as { updated: number };
    toast.success(`Обновлено ${updated} записей`);
    clearSelection();
    setBulkStatus("");
    setBulkPlannedPayAt("");
    mutate();
  }

  function activeSortField(): SortField {
    return sort[0]?.field ?? "weekPlanFact";
  }

  function activeSortDir(): SortDir {
    return sort[0]?.dir ?? "desc";
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Выставленные работы"
        actions={<OverduePaymentSummary amount={overdueTotal} onClick={showOverdue} active={overdueOnly} />}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterResetButton active={hasActiveFilters} onClick={resetFilters} />
        <GroupBySelect
          value={groupBy}
          onChange={handleGroupByChange}
          options={[...ISSUED_WORK_GROUP_OPTIONS]}
        />
        <MultiSelectFilter
          label="Месяц"
          options={monthOptions}
          value={executionMonthFilter}
          onChange={setExecutionMonthFilter}
        />
        <MultiSelectFilter
          label="Неделя"
          options={weekOptions}
          value={weekFilter}
          onChange={setWeekFilter}
        />
        <MultiSelectFilter
          label="Исполнитель"
          options={executorOptions}
          value={executorFilter}
          onChange={setExecutorFilter}
        />
        <MultiSelectFilter
          label="Ответственный"
          options={responsibleExecutorOptions}
          value={responsibleExecutorFilter}
          onChange={setResponsibleExecutorFilter}
        />
        <MultiSelectFilter
          label="Проект"
          options={projectOptions}
          value={projectFilter}
          onChange={setProjectFilter}
        />
        <MultiSelectFilter
          label="Вид работ"
          options={workTypeOptions}
          value={workTypeFilter}
          onChange={setWorkTypeFilter}
        />
        <MultiSelectFilter
          label="Статус"
          options={Object.entries(WORK_STATUSES)
            .map(([value, { label }]) => ({ value, label }))
            .filter((option) => compatibleValues.status?.has(option.value))}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <MultiSelectFilter
          label="Тип сметы"
          options={[
            { value: "personal", label: "Личная смета" },
            { value: "other-expense", label: "Прочие траты" },
          ].filter((option) => compatibleValues.smeta?.has(option.value))}
          value={smetaFilter}
          onChange={setSmetaFilter}
        />
        <MoreFilters activeCount={yearPlanFactFilter.length + executionYearFilter.length}>
          <MultiSelectFilter
            label="Год оплаты план-факт"
            options={yearOptions}
            value={yearPlanFactFilter}
            onChange={setYearPlanFactFilter}
          />
          <MultiSelectFilter
            label="Год выполнения"
            options={execYearOptions}
            value={executionYearFilter}
            onChange={setExecutionYearFilter}
          />
        </MoreFilters>
      </div>

      {(rows.length > 0 || selectedIds.size > 0) && (
        <div className="flex items-center gap-4 px-1 py-1.5 text-xs text-neutral-500">
          <span>{displayCount} {selectedIds.size > 0 ? "выбрано" : "записей"}</span>
          <span className="text-xs font-medium tabular-nums text-neutral-800">
            {formatMoneyRub(displaySum)}
          </span>
        </div>
      )}

      {/* Bulk toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
          <span className="text-xs font-medium text-blue-700">{selectedIds.size} выбрано</span>
          <Select value={bulkStatus} onValueChange={(v) => v && setBulkStatus(v)}>
            <SelectTrigger className="h-7 w-44 text-xs">
              <SelectValue>{bulkStatus ? (WORK_STATUSES[bulkStatus as keyof typeof WORK_STATUSES]?.label ?? "Статус") : "Статус"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {WORK_STATUSES_SETTABLE.map((k) => (
                <SelectItem key={k} value={k}>{WORK_STATUSES[k].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <span className="text-xs text-neutral-500">Дата план:</span>
            <DateInput className="h-7 text-xs w-36" value={bulkPlannedPayAt} onChange={(e) => setBulkPlannedPayAt(e.target.value)} />
          </div>
          <Button size="sm" className="h-7 text-xs" onClick={handleBulkApply} disabled={bulkSaving}>
            {bulkSaving ? "..." : "Применить"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { clearSelection(); setBulkStatus(""); setBulkPlannedPayAt(""); }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <Table
        className={cn(compactTable, "table-fixed w-full")}
        style={{ minWidth: TABLE_MIN_WIDTH }}
        containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto"
        containerRef={scrollRef}
      >
          <colgroup>
            {COL_WIDTHS.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox checked={selectedIds.size === rows.length && rows.length > 0} onCheckedChange={() => toggleAll(orderedRowIds)} />
              </TableHead>
              <SortableHead
                field="number"
                sortBy={activeSortField()}
                sortDir={activeSortDir()}
                onSort={handleSort}
                className={cn(compactHead, "w-24 text-[10px]")}
              >
                Номер
              </SortableHead>
              <SortableHead
                field="executionMonth"
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
                className={cn(weekPayClass, compactPeriodHead)}
              >
                <span className="block text-left">
                  Неделя
                  <br />
                  оплаты
                </span>
              </SortableHead>
              <SortableHead
                field="executorName"
                sortBy={activeSortField()}
                sortDir={activeSortDir()}
                onSort={handleSort}
                className={cn(compactHead, "w-32 max-w-32")}
              >
                Исполнитель
              </SortableHead>
              <SortableHead
                field="amount"
                sortBy={activeSortField()}
                sortDir={activeSortDir()}
                onSort={handleSort}
                className={cn(compactHead, "text-right w-28")}
              >
                Сумма
              </SortableHead>
              <SortableHead
                field="workStatus"
                sortBy={activeSortField()}
                sortDir={activeSortDir()}
                onSort={handleSort}
                className={cn(compactHead, "w-32")}
              >
                Статус
              </SortableHead>
              <TableHead className={cn(compactHead, "w-28")}>Дата проверки</TableHead>
              <TableHead className={cn(compactHead, "w-28")}>Дата оплаты план</TableHead>
              <TableHead className={cn(compactHead, "w-28")}>Дата оплаты факт</TableHead>
              <SortableHead
                field="projectName"
                sortBy={activeSortField()}
                sortDir={activeSortDir()}
                onSort={handleSort}
                className={cn(compactHead, "w-44 max-w-44")}
              >
                Проект
              </SortableHead>
              <SortableHead
                field="workTypeName"
                sortBy={activeSortField()}
                sortDir={activeSortDir()}
                onSort={handleSort}
                className={cn(compactHead, "w-32 max-w-32")}
              >
                Вид работ
              </SortableHead>
              <TableHead className={cn(compactHead, "w-48 max-w-48")}>Описание</TableHead>
              <SortableHead
                field="responsibleExecutorName"
                sortBy={activeSortField()}
                sortDir={activeSortDir()}
                onSort={handleSort}
                className={cn(compactHead, "w-32 max-w-32")}
              >
                Ответственный
              </SortableHead>
              <TableHead className={cn(compactHead, "w-24 max-w-24")}>Выплата</TableHead>
              <TableHead className={cn(compactHead, "w-32")}>Тип сметы</TableHead>
              <SortableHead
                field="executionYear"
                sortBy={activeSortField()}
                sortDir={activeSortDir()}
                onSort={handleSort}
                className={cn(periodYearMonthClass, compactPeriodHead, "text-left")}
              >
                <span className="block text-left">
                  Год
                  <br />
                  выполнения
                </span>
              </SortableHead>
              <TableHead className={stickyActionsHead} />
            </TableRow>
          </TableHeader>
          <VirtualizedTableBody
            scrollRef={scrollRef}
            rowCount={flatItems ? flatItems.length : rows.length}
            colSpan={COL_COUNT}
            isLoading={isLoading}
            loading={
              <TableRow>
                <TableCell colSpan={COL_COUNT} className="text-center text-neutral-500 py-8">
                  Загрузка...
                </TableCell>
              </TableRow>
            }
            isEmpty={rows.length === 0}
            empty={
              <TableRow>
                <TableCell colSpan={COL_COUNT} className="text-center text-neutral-500 py-12">
                  Пока нет ни одной работы. Они появятся после создания строк в Личных сметах
                  и Прочих тратах (Phase 3).
                </TableCell>
              </TableRow>
            }
            renderRow={renderRow}
          />
        </Table>

      {editing && (
        <IssuedWorkEditDialog
          row={editing}
          projects={projects ?? []}
          executors={executors ?? []}
          workTypes={workTypes ?? []}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            // Ждём обновления данных до закрытия — иначе при быстром повторном
            // открытии форма показывает не обновлённый кэш SWR.
            await mutate();
            setEditing(null);
          }}
        />
      )}
      {editingPayment && (
        <PayoutEditDialog
          row={editingPayment}
          executors={executors ?? []}
          banks={banks ?? []}
          onClose={() => setEditingPayment(null)}
          onSaved={async () => {
            await mutate();
            setEditingPayment(null);
          }}
        />
      )}
    </div>
  );
}
