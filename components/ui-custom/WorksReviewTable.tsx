"use client";

import * as React from "react";
import useSWR from "swr";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, MessageSquare, ArrowUp, ArrowDown, ArrowUpDown, ExternalLink } from "lucide-react";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { WORK_STATUSES, WORK_STATUSES_SETTABLE } from "@/lib/statuses";
import { formatMoney, formatDateShort, monthLabel } from "@/lib/format";
import { getISOWeek, weekLabel } from "@/lib/iso-weeks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BulkSelectTableBody } from "@/components/ui-custom/BulkSelectTableBody";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner } from "@/lib/table-styles";
import { isUnknownExecutorName } from "@/lib/executor-names";

type ReviewRow = {
  sourceType: "personal" | "other-expense";
  sourceId: string;
  executionYear: number;
  executionMonth: number;
  executorId: string;
  executorName: string;
  executorCanOpenEstimate: boolean;
  projectId: string;
  projectName: string;
  workTypeId: string;
  workTypeName: string;
  responsibleExecutorId: string | null;
  responsibleExecutorName: string | null;
  amount: number;
  techTask: string | null;
  rate: number | null;
  workStatus: string;
  comment: string | null;
  checkedAt: string | null;
  paidAt: string | null;
  plannedPayAt: string | null;
};

type ExecutorRef = { id: string; name: string };

const fetcher = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<T>;
  });

function rowId(r: ReviewRow) {
  return `${r.sourceType}:${r.sourceId}`;
}

const PAID = new Set(["paid"]);

const SOURCE_TYPE_LABELS: Record<string, string> = {
  personal: "Личная",
  "other-expense": "Прочие траты",
};

/** Порядок статусов для сортировки по умолчанию: rework → submitted → checked → paid. */
const STATUS_ORDER: Record<string, number> = {
  rework: 0,
  submitted: 1,
  checked: 2,
  paid: 3,
};

type SortKey =
  | "executionYear"
  | "executionMonth"
  | "executorName"
  | "projectName"
  | "workTypeName"
  | "sourceType"
  | "responsibleExecutorName"
  | "techTask"
  | "rate"
  | "amount"
  | "workStatus"
  | "date";

type SortState = { key: SortKey; dir: 1 | -1 } | null;

function rowDate(r: ReviewRow): string {
  return r.paidAt ?? r.plannedPayAt ?? "";
}

function sortValue(r: ReviewRow, key: SortKey): string | number {
  switch (key) {
    case "date":
      return rowDate(r);
    case "workStatus":
      return STATUS_ORDER[r.workStatus] ?? 9;
    case "sourceType":
      return SOURCE_TYPE_LABELS[r.sourceType] ?? r.sourceType;
    case "responsibleExecutorName":
      return r.responsibleExecutorName ?? "";
    case "techTask":
      return r.techTask ?? "";
    case "rate":
      return r.rate ?? -Infinity;
    default:
      return r[key];
  }
}

function compareRows(a: ReviewRow, b: ReviewRow, sort: SortState): number {
  if (sort) {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    let cmp: number;
    if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb), "ru");
    if (cmp !== 0) return cmp * sort.dir;
    // стабилизация — дефолтным порядком
  }
  // Сортировка по умолчанию: статус → дата (ранние сверху)
  const sa = STATUS_ORDER[a.workStatus] ?? 9;
  const sb = STATUS_ORDER[b.workStatus] ?? 9;
  if (sa !== sb) return sa - sb;
  const da = rowDate(a);
  const db = rowDate(b);
  if (da !== db) {
    if (!da) return 1;
    if (!db) return -1;
    return da.localeCompare(db);
  }
  return 0;
}

function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
  topContent,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  className?: string;
  topContent?: React.ReactNode;
}) {
  const active = sort?.key === sortKey;
  return (
    <TableHead
      className={cn("cursor-pointer select-none hover:text-neutral-900 group/th", className)}
      onClick={() => onSort(sortKey)}
    >
      {topContent}
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active ? (
          sort!.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 text-neutral-300 group-hover/th:text-neutral-500" />
        )}
      </span>
    </TableHead>
  );
}

/**
 * Переиспользуемая таблица «работ на проверку» (KPD-287 дашборд проекта,
 * KPD-288 личная смета). Позволяет рецензенту менять статус, ответственного и
 * комментарий, массово «Проверить все», фильтровать и сортировать по всем колонкам.
 */
export function WorksReviewTable({
  fetchUrl,
  stateKey,
  emptyText = "Работ пока нет.",
  showProjectColumn = true,
  showExecutorFilter = true,
  showExecutorLinks = false,
}: {
  fetchUrl: string;
  stateKey: string;
  emptyText?: string;
  showProjectColumn?: boolean;
  showExecutorFilter?: boolean;
  showExecutorLinks?: boolean;
}) {
  const { data, isLoading, mutate } = useSWR<ReviewRow[]>(fetchUrl, fetcher);
  const { data: permanentExecutors } = useSWR<ExecutorRef[]>(
    "/api/executors/active-permanent",
    fetcher
  );

  const [executorFilter, setExecutorFilter] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<string[]>([]);
  const [projectFilter, setProjectFilter] = React.useState<string[]>([]);
  const [workTypeFilter, setWorkTypeFilter] = React.useState<string[]>([]);
  const [weekFilter, setWeekFilter] = React.useState<string[]>([]);
  const [monthFilter, setMonthFilter] = React.useState<string[]>([]);
  const [hidePaid, setHidePaid] = React.useState(false);
  const [busyIds, setBusyIds] = React.useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [sort, setSort] = React.useState<SortState>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  usePersistedInterfaceState(
    `works-review:${stateKey}`,
    {
      executorFilter,
      statusFilter,
      projectFilter,
      workTypeFilter,
      weekFilter,
      monthFilter,
      hidePaid,
      sort,
    },
    (stored) => {
      if (stored.executorFilter) setExecutorFilter(stored.executorFilter);
      if (stored.statusFilter) setStatusFilter(stored.statusFilter);
      if (stored.projectFilter) setProjectFilter(stored.projectFilter);
      if (stored.workTypeFilter) setWorkTypeFilter(stored.workTypeFilter);
      if (stored.weekFilter) setWeekFilter(stored.weekFilter);
      if (stored.monthFilter) setMonthFilter(stored.monthFilter);
      if ("hidePaid" in stored) setHidePaid(Boolean(stored.hidePaid));
      if ("sort" in stored) setSort(stored.sort ?? null);
    }
  );
  usePersistedScroll(scrollRef, `works-review:${stateKey}`, {
    enabled: !isLoading && !!data,
    signature: {
      executorFilter,
      statusFilter,
      projectFilter,
      workTypeFilter,
      weekFilter,
      monthFilter,
      hidePaid,
      sort,
    },
  });

  function handleSort(key: SortKey) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: 1 };
      if (prev.dir === 1) return { key, dir: -1 };
      return null; // третий клик — вернуться к сортировке по умолчанию
    });
  }

  const allRows = React.useMemo(() => data ?? [], [data]);

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

  const workTypeOptions = React.useMemo(
    () =>
      Array.from(new Map(allRows.map((r) => [r.workTypeId, r.workTypeName])).entries())
        .sort((a, b) => a[1].localeCompare(b[1], "ru"))
        .map(([value, label]) => ({ value, label })),
    [allRows]
  );

  const weekOptions = React.useMemo(() => {
    const weeks = new Set<string>();
    for (const r of allRows) {
      if (r.plannedPayAt) {
        const w = getISOWeek(new Date(r.plannedPayAt));
        weeks.add(String(w).padStart(2, "0"));
      }
    }
    return Array.from(weeks)
      .sort()
      .map((w) => ({ value: w, label: weekLabel(parseInt(w)) }));
  }, [allRows]);

  const monthOptions = React.useMemo(() => {
    const months = new Set<number>();
    for (const r of allRows) months.add(r.executionMonth);
    return Array.from(months)
      .sort((a, b) => a - b)
      .map((m) => ({ value: String(m), label: monthLabel(m) }));
  }, [allRows]);

  const rows = React.useMemo(() => {
    let list = allRows;
    if (executorFilter.length) list = list.filter((r) => executorFilter.includes(r.executorId));
    if (statusFilter.length) list = list.filter((r) => statusFilter.includes(r.workStatus));
    if (projectFilter.length) list = list.filter((r) => projectFilter.includes(r.projectId));
    if (workTypeFilter.length) list = list.filter((r) => workTypeFilter.includes(r.workTypeId));
    if (monthFilter.length) list = list.filter((r) => monthFilter.includes(String(r.executionMonth)));
    if (weekFilter.length) {
      list = list.filter((r) => {
        if (!r.plannedPayAt) return false;
        const w = String(getISOWeek(new Date(r.plannedPayAt))).padStart(2, "0");
        return weekFilter.includes(w);
      });
    }
    if (hidePaid) list = list.filter((r) => !PAID.has(r.workStatus));
    return [...list].sort((a, b) => compareRows(a, b, sort));
  }, [allRows, executorFilter, statusFilter, projectFilter, workTypeFilter, weekFilter, monthFilter, hidePaid, sort]);

  const checkableRows = rows.filter((r) => r.workStatus === "submitted" || r.workStatus === "rework");

  async function patchRow(r: ReviewRow, body: Record<string, unknown>) {
    const id = rowId(r);
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/issued-works/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Ошибка");
      }
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function checkRow(r: ReviewRow) {
    const id = rowId(r);
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/issued-works/${id}/check`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Ошибка");
      }
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleCheckAll() {
    if (checkableRows.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/issued-works/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: checkableRows.map(rowId), patch: { workStatus: "checked" } }),
      });
      if (!res.ok) throw new Error();
      const { updated } = (await res.json()) as { updated: number };
      toast.success(`Проверено работ: ${updated}`);
      await mutate();
    } catch {
      toast.error("Не удалось проверить работы");
    } finally {
      setBulkBusy(false);
    }
  }

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const colSpan = showProjectColumn ? 13 : 12;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleCheckAll}
          disabled={bulkBusy || checkableRows.length === 0}
        >
          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
          Проверить все{checkableRows.length > 0 ? ` (${checkableRows.length})` : ""}
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer select-none">
            <Checkbox checked={hidePaid} onCheckedChange={(v) => setHidePaid(Boolean(v))} />
            Свернуть оплаченные
          </label>
          {showProjectColumn && projectOptions.length > 1 && (
            <MultiSelectFilter
              label="Проект"
              options={projectOptions}
              value={projectFilter}
              onChange={setProjectFilter}
            />
          )}
          <MultiSelectFilter
            label="Вид работ"
            options={workTypeOptions}
            value={workTypeFilter}
            onChange={setWorkTypeFilter}
          />
          {monthOptions.length > 0 && (
            <MultiSelectFilter
              label="Месяц выполнения"
              options={monthOptions}
              value={monthFilter}
              onChange={setMonthFilter}
            />
          )}
          {weekOptions.length > 0 && (
            <MultiSelectFilter
              label="Неделя оплаты"
              options={weekOptions}
              value={weekFilter}
              onChange={setWeekFilter}
            />
          )}
          {showExecutorFilter && (
            <MultiSelectFilter
              label="Исполнитель"
              options={executorOptions}
              value={executorFilter}
              onChange={setExecutorFilter}
            />
          )}
          <MultiSelectFilter
            label="Статус"
            options={Object.entries(WORK_STATUSES).map(([value, { label }]) => ({ value, label }))}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </div>
      </div>

      {rows.length > 0 && (
        <div className="flex items-center gap-4 px-1 text-xs text-neutral-500">
          <span>{rows.length} записей</span>
        </div>
      )}

      <Table
        className="min-w-[1250px]"
        containerClassName="rounded-md border bg-white max-h-[60vh] overflow-auto"
        containerRef={scrollRef}
      >
        <TableHeader className="sticky top-0 z-10 bg-white">
          {rows.length > 0 && (
            <TableRow className="hover:bg-transparent border-b-0">
              <TableHead colSpan={showProjectColumn ? 9 : 8} className="h-6 py-0 border-b-0" />
              <TableHead className="h-6 py-0 text-right border-b-0">
                <span className="text-[11px] font-semibold tabular-nums text-neutral-800 whitespace-nowrap">
                  {formatMoney(total)} ₽
                </span>
              </TableHead>
              <TableHead colSpan={2} className="h-6 py-0 border-b-0" />
              <TableHead className={cn(stickyActionsHead, "h-6 py-0")} />
            </TableRow>
          )}
          <TableRow>
            <SortableHead label="Год" sortKey="executionYear" sort={sort} onSort={handleSort} className="w-16 text-[10px]" />
            <SortableHead label="Месяц" sortKey="executionMonth" sort={sort} onSort={handleSort} className="w-20 text-[10px]" />
            <SortableHead label="Исполнитель" sortKey="executorName" sort={sort} onSort={handleSort} />
            {showProjectColumn && (
              <SortableHead label="Проект" sortKey="projectName" sort={sort} onSort={handleSort} />
            )}
            <SortableHead label="Вид работ" sortKey="workTypeName" sort={sort} onSort={handleSort} />
            <SortableHead label="Тип сметы" sortKey="sourceType" sort={sort} onSort={handleSort} className="w-24 text-[10px]" />
            <SortableHead label="Ответственный" sortKey="responsibleExecutorName" sort={sort} onSort={handleSort} className="min-w-[150px]" />
            <SortableHead label="ТЗ" sortKey="techTask" sort={sort} onSort={handleSort} className="max-w-[140px]" />
            <SortableHead label="Ставка" sortKey="rate" sort={sort} onSort={handleSort} className="text-right" />
            <SortableHead label="Сумма" sortKey="amount" sort={sort} onSort={handleSort} className="text-right" />
            <SortableHead label="Статус" sortKey="workStatus" sort={sort} onSort={handleSort} className="min-w-[150px]" />
            <SortableHead label="Дата оплаты план-факт" sortKey="date" sort={sort} onSort={handleSort} className="whitespace-nowrap" />
            <TableHead className={stickyActionsHead} />
          </TableRow>
        </TableHeader>
        <BulkSelectTableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={colSpan + 1} className="text-center text-neutral-500 py-8">
                Загрузка...
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan + 1} className="text-center text-neutral-500 py-10">
                {emptyText}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => {
              const id = rowId(r);
              const busy = busyIds.has(id);
              const isPaid = PAID.has(r.workStatus);
              return (
                <TableRow key={id} className={cn(isPaid && "bg-neutral-50 text-neutral-400")}>
                  <TableCell className="text-xs tabular-nums">{r.executionYear}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{monthLabel(r.executionMonth)}</TableCell>
                  <TableCell className="text-sm">
                    {showExecutorLinks &&
                    r.executorCanOpenEstimate &&
                    !isUnknownExecutorName(r.executorName) ? (
                      <Link
                        href={`/admin/executors/${r.executorId}?tab=works`}
                        className="text-blue-600 hover:underline"
                        title="Открыть личную смету"
                      >
                        {r.executorName}
                      </Link>
                    ) : (
                      r.executorName
                    )}
                  </TableCell>
                  {showProjectColumn && <TableCell className="text-sm">{r.projectName}</TableCell>}
                  <TableCell className="text-sm">{r.workTypeName}</TableCell>
                  <TableCell className="text-xs text-neutral-500 whitespace-nowrap">
                    {SOURCE_TYPE_LABELS[r.sourceType] ?? r.sourceType}
                  </TableCell>
                  <TableCell>
                    <SearchableSelect
                      value={r.responsibleExecutorId ?? ""}
                      onValueChange={(v) => patchRow(r, { responsibleExecutorId: v })}
                      options={(permanentExecutors ?? []).map((e) => ({ value: e.id, label: e.name }))}
                      disabled={busy || isPaid}
                      placeholder={r.responsibleExecutorName ?? "—"}
                      triggerClassName="h-7 text-xs"
                    />
                  </TableCell>
                  <TableCell className="text-xs max-w-[140px]">
                    {r.techTask ? (
                      /^https?:\/\//i.test(r.techTask) ? (
                        <a
                          href={r.techTask}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
                        >
                          ТЗ
                          <ExternalLink className="h-3 w-3 opacity-60" />
                        </a>
                      ) : (
                        <span className="block truncate" title={r.techTask}>{r.techTask}</span>
                      )
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {r.rate != null ? formatMoney(r.rate) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-sm">{formatMoney(r.amount)}</TableCell>
                  <TableCell>
                    {isPaid ? (
                      <StatusBadge dict={WORK_STATUSES} value={r.workStatus} />
                    ) : (
                      <Select
                        value={r.workStatus}
                        onValueChange={(v) => v && v !== r.workStatus && patchRow(r, { workStatus: v })}
                        disabled={busy}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue>
                            {WORK_STATUSES[r.workStatus as keyof typeof WORK_STATUSES]?.label ?? r.workStatus}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {WORK_STATUSES_SETTABLE.map((k) => (
                            <SelectItem key={k} value={k}>{WORK_STATUSES[k].label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell className={cn("text-xs whitespace-nowrap", r.workStatus === "paid" && !r.paidAt && "bg-red-100 text-red-700")}>
                    {r.paidAt ? (
                      <span className="inline-flex items-center gap-1.5">
                        {formatDateShort(r.paidAt)}
                        <span className="text-[10px] font-medium text-green-600">факт</span>
                      </span>
                    ) : r.plannedPayAt ? (
                      <span className="inline-flex items-center gap-1.5">
                        {formatDateShort(r.plannedPayAt)}
                        <span className="text-[10px] font-medium text-neutral-400">план</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className={stickyActionsCell}>
                    <div className={stickyActionsInner}>
                      <CommentPopover
                        comment={r.comment}
                        disabled={busy}
                        readOnly={isPaid}
                        onSave={(v) => patchRow(r, { comment: v || null })}
                      />
                      {(r.workStatus === "submitted" || r.workStatus === "rework") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => checkRow(r)}
                          title="Проставить «Проверено»"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </BulkSelectTableBody>
      </Table>
    </div>
  );
}

function CommentPopover({
  comment,
  disabled,
  readOnly,
  onSave,
}: {
  comment: string | null;
  disabled?: boolean;
  readOnly?: boolean;
  onSave: (v: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(comment ?? "");

  React.useEffect(() => {
    if (open) setDraft(comment ?? "");
  }, [open, comment]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        title={comment ? comment : "Добавить комментарий"}
        className={cn(
          "inline-flex h-8 items-center justify-center rounded-md px-2 transition-colors border-0 bg-transparent cursor-pointer hover:bg-neutral-100",
          comment ? "text-blue-600 hover:text-blue-700" : "text-neutral-400 hover:text-neutral-600"
        )}
      >
        <MessageSquare className={cn("h-3.5 w-3.5", comment && "fill-blue-100")} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 space-y-2">
        <p className="text-xs font-medium text-neutral-600">Комментарий</p>
        {readOnly ? (
          <p className="text-xs text-neutral-600 whitespace-pre-wrap">{comment || "—"}</p>
        ) : (
          <>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="—"
              className="min-h-[72px] text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                Отмена
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (draft !== (comment ?? "")) onSave(draft);
                  setOpen(false);
                }}
              >
                Сохранить
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
