"use client";

import * as React from "react";
import useSWR from "swr";
import Link from "next/link";
import { toast } from "sonner";
import { Pencil, CheckCircle2, X } from "lucide-react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { WORK_STATUSES, WORK_STATUSES_SETTABLE } from "@/lib/statuses";
import { formatMoney, formatMoneyRub, formatDateShort, weekLabel, monthLabel, MONTHS } from "@/lib/format";
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
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";

const periodYearMonthClass = "w-20 max-w-20 px-1";
const weekPayClass = "w-20 max-w-20 px-1";

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
  projectId: string;
  projectName: string;
  projectType: string;
  workTypeId: string;
  workTypeName: string;
  workTypeSegment: string;
  responsibleExecutorId: string | null;
  responsibleExecutorName: string | null;
  amount: number;
  workStatus: string;
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
  if (row.sourceType === "personal") return SMETA_LABEL.personal;
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
};

const IssuedWorkRow = React.memo(function IssuedWorkRow({
  row: r,
  rowIndex,
  checked,
  onSelect,
  onEdit,
  onCheck,
}: IssuedWorkRowProps) {
  const id = issuedWorkRowId(r);
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
      <TableCell className={cn(compactCell, "tabular-nums text-left", periodYearMonthClass)}>
        {r.executionYear}
      </TableCell>
      <TableCell className={cn(compactCell, "whitespace-nowrap", periodYearMonthClass)}>
        {monthLabel(r.executionMonth)}
      </TableCell>
      <TableCell className={cn(compactCell, "whitespace-nowrap", weekPayClass)}>
        {r.weekPlanFact != null ? weekLabel(r.weekPlanFact) : "—"}
      </TableCell>
      <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
        {r.executorAccessEmail ? (
          <Link href={`/admin/executors/${r.executorId}`} className="hover:underline text-neutral-900">
            {r.executorName}
          </Link>
        ) : (
          r.executorName
        )}
      </TableCell>
      <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
        {r.responsibleExecutorName ?? "—"}
      </TableCell>
      <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>{r.projectName}</TableCell>
      <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>{r.workTypeName}</TableCell>
      <TableCell className={cn(compactCell, "text-right tabular-nums font-semibold")}>{formatMoney(r.amount)}</TableCell>
      <TableCell className={compactCell}>
        <StatusBadge dict={WORK_STATUSES} value={r.workStatus} />
      </TableCell>
      <TableCell className={compactCell}>{formatDateShort(r.checkedAt)}</TableCell>
      <TableCell className={compactCell}>{formatDateShort(r.plannedPayAt)}</TableCell>
      <TableCell className={cn(compactCell, r.workStatus === "paid" && !r.paidAt && "bg-red-100 text-red-700")}>
        {formatDateShort(r.paidAt)}
      </TableCell>
      <TableCell className={compactCell}>{smetaTypeCell(r)}</TableCell>
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

  const [yearPlanFactFilter, setYearPlanFactFilter] = React.useState<string[]>([String(new Date().getFullYear())]);
  const [executionYearFilter, setExecutionYearFilter] = React.useState<string[]>([]);
  const [executionMonthFilter, setExecutionMonthFilter] = React.useState<string[]>([]);
  const [weekFilter, setWeekFilter] = React.useState<string[]>([]);
  const [executorFilter, setExecutorFilter] = React.useState<string[]>([]);
  const [projectFilter, setProjectFilter] = React.useState<string[]>([]);
  const [workTypeFilter, setWorkTypeFilter] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<string[]>([]);
  const [smetaFilter, setSmetaFilter] = React.useState<string[]>([]);
  const [groupBy, setGroupBy] = React.useState<"" | "executor" | "week" | "project" | "workType">("");
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => new Set());

  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }[]>([
    { field: "weekPlanFact", dir: "desc" },
    { field: "projectName", dir: "asc" },
    { field: "executorName", dir: "asc" },
    { field: "executionMonth", dir: "desc" },
  ]);

  const [editing, setEditing] = React.useState<Row | null>(null);

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
      projectFilter,
      workTypeFilter,
      statusFilter,
      smetaFilter,
      groupBy,
      collapsedGroups,
      sort,
    },
    (stored) => {
      if (stored.yearPlanFactFilter) setYearPlanFactFilter(stored.yearPlanFactFilter);
      if (stored.executionYearFilter) setExecutionYearFilter(stored.executionYearFilter);
      if (stored.executionMonthFilter) setExecutionMonthFilter(stored.executionMonthFilter);
      if (stored.weekFilter) setWeekFilter(stored.weekFilter);
      if (stored.executorFilter) setExecutorFilter(stored.executorFilter);
      if (stored.projectFilter) setProjectFilter(stored.projectFilter);
      if (stored.workTypeFilter) setWorkTypeFilter(stored.workTypeFilter);
      if (stored.statusFilter) setStatusFilter(stored.statusFilter);
      if (stored.smetaFilter) setSmetaFilter(stored.smetaFilter);
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
      projectFilter,
      workTypeFilter,
      statusFilter,
      smetaFilter,
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

  const yearOptions = React.useMemo(() => {
    const opts = Array.from(
      new Set(allRows.map((r) => r.yearPlanFact).filter((v): v is number => v != null))
    ).sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }));
    const hasEmpty = allRows.some((r) => r.yearPlanFact === null);
    return hasEmpty ? [{ value: "__empty__", label: "Пусто" }, ...opts] : opts;
  }, [allRows]);
  const execYearOptions = React.useMemo(
    () =>
      Array.from(new Set(allRows.map((r) => r.executionYear)))
        .sort((a, b) => b - a)
        .map((y) => ({ value: String(y), label: String(y) })),
    [allRows]
  );
  const monthOptions = MONTHS;
  const weekOptions = React.useMemo(() => {
    const opts = Array.from(
      new Set(allRows.map((r) => r.weekPlanFact).filter((v): v is number => v != null))
    ).sort((a, b) => a - b).map((w) => ({ value: String(w), label: weekLabel(w) }));
    const hasEmpty = allRows.some((r) => r.weekPlanFact === null);
    return hasEmpty ? [{ value: "__empty__", label: "Пусто" }, ...opts] : opts;
  }, [allRows]);
  const executorOptions = React.useMemo(
    () =>
      Array.from(new Map(allRows.map((r) => [r.executorId, r.executorName])).entries())
        .sort((a, b) => a[1].localeCompare(b[1], "ru"))
        .map(([value, label]) => ({ value, label })),
    [allRows]
  );
  const projectOptions = React.useMemo(
    () =>
      Array.from(new Map(allRows.map((r) => [r.projectId, r.projectName])).entries())
        .sort((a, b) => a[1].localeCompare(b[1], "ru"))
        .map(([value, label]) => ({ value, label })),
    [allRows]
  );
  const workTypeOptions = React.useMemo(() => {
    const map = new Map<string, { label: string; group: string }>();
    for (const r of allRows) {
      if (!map.has(r.workTypeId)) {
        map.set(r.workTypeId, { label: r.workTypeName, group: r.workTypeSegment ?? "" });
      }
    }
    return Array.from(map.entries())
      .sort((a, b) =>
        (a[1].group ?? "").localeCompare(b[1].group ?? "", "ru") ||
        a[1].label.localeCompare(b[1].label, "ru")
      )
      .map(([value, { label, group }]) => ({ value, label, group }));
  }, [allRows]);

  const rows = React.useMemo(() => {
    let list = allRows;
    if (yearPlanFactFilter.length)
      list = list.filter((r) => yearPlanFactFilter.includes(r.yearPlanFact === null ? "__empty__" : String(r.yearPlanFact)));
    if (executionYearFilter.length)
      list = list.filter((r) => executionYearFilter.includes(String(r.executionYear)));
    if (executionMonthFilter.length)
      list = list.filter((r) => executionMonthFilter.includes(String(r.executionMonth)));
    if (weekFilter.length) list = list.filter((r) => weekFilter.includes(r.weekPlanFact === null ? "__empty__" : String(r.weekPlanFact)));
    if (executorFilter.length) list = list.filter((r) => executorFilter.includes(r.executorId));
    if (projectFilter.length) list = list.filter((r) => projectFilter.includes(r.projectId));
    if (workTypeFilter.length) list = list.filter((r) => workTypeFilter.includes(r.workTypeId));
    if (statusFilter.length) list = list.filter((r) => statusFilter.includes(r.workStatus));
    if (smetaFilter.length) list = list.filter((r) => smetaFilter.includes(r.sourceType));
    return [...list].sort(compareRows);
  }, [
    allRows,
    yearPlanFactFilter,
    executionYearFilter,
    executionMonthFilter,
    weekFilter,
    executorFilter,
    projectFilter,
    workTypeFilter,
    statusFilter,
    smetaFilter,
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
              colSpan={16}
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
        />
      );
    },
    [flatItems, rows, rowIndexById, selectedIds, handleRowSelect, handleEdit, handleCheckRow, toggleGroup]
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
      <PageHeader title="Выставленные работы" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <GroupBySelect
          value={groupBy}
          onChange={handleGroupByChange}
          options={[...ISSUED_WORK_GROUP_OPTIONS]}
        />
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
          options={Object.entries(WORK_STATUSES).map(([value, { label }]) => ({ value, label }))}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <MultiSelectFilter
          label="Тип сметы"
          options={[
            { value: "personal", label: "Личная смета" },
            { value: "other-expense", label: "Прочие траты" },
          ]}
          value={smetaFilter}
          onChange={setSmetaFilter}
        />
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
        className={cn(compactTable, "min-w-[1776px]")}
        containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto"
        containerRef={scrollRef}
      >
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
              <TableHead className={cn(compactHead, "w-32 max-w-32")}>Ответственный</TableHead>
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
              <TableHead className={cn(compactHead, "w-32")}>Тип сметы</TableHead>
              <TableHead className={stickyActionsHead} />
            </TableRow>
          </TableHeader>
          <VirtualizedTableBody
            scrollRef={scrollRef}
            rowCount={flatItems ? flatItems.length : rows.length}
            colSpan={16}
            isLoading={isLoading}
            loading={
              <TableRow>
                <TableCell colSpan={16} className="text-center text-neutral-500 py-8">
                  Загрузка...
                </TableCell>
              </TableRow>
            }
            isEmpty={rows.length === 0}
            empty={
              <TableRow>
                <TableCell colSpan={16} className="text-center text-neutral-500 py-12">
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
          onSaved={() => {
            setEditing(null);
            mutate();
          }}
        />
      )}
    </div>
  );
}
