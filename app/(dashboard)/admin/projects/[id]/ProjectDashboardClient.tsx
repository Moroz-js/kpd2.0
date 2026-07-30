"use client";

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ChevronLeft, Plus, Pencil, Check, TrendingUp, CreditCard, AlertTriangle, Trash2 } from "lucide-react";
import Link from "next/link";
import { CollapsibleSection, SectionChevron, useSectionCollapsed } from "@/components/ui-custom/CollapsibleSection";
import { buttonVariants, Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  weekLabel,
  getISOWeeksInYear,
  getISOWeek,
  firstVisibleDashboardWeek,
} from "@/lib/iso-weeks";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectCashflowChart } from "@/components/ui-custom/ProjectCashflowChart";
import { WorksReviewTable } from "@/components/ui-custom/WorksReviewTable";
import { usePersistedInterfaceState } from "@/components/PersistedInterfaceState";
import { useComparison } from "@/components/ComparisonProvider";

const fetcher = (url: string) => fetch(url).then(r => r.json());

function fmt(n: number) {
  if (n === 0) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

function fmtSign(n: number) {
  if (n === 0) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

/** Перерасход: минус — экономия (зелёный), плюс — превышение (красный) */
function overspendValueClass(v: number): string {
  if (v === 0) return "";
  if (v < 0) return "text-green-600 font-medium";
  return "text-red-600 font-medium";
}

/** Редактируемый «Стартовый баланс» проекта (аналог OpeningBalanceInput в общем кэшфлоу). */
function StartBalanceInput({
  projectId,
  initial,
  onSaved,
}: {
  projectId: string;
  initial: number;
  onSaved: (v: number) => void;
}) {
  const [numericValue, setNumericValue] = useState(initial || 0);
  const [display, setDisplay] = useState(formatMoneyInput(initial || 0));
  const [lastInitial, setLastInitial] = useState(initial);

  // Синхронизация с обновлённым initial (после mutate) без useEffect
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setNumericValue(initial || 0);
    setDisplay(formatMoneyInput(initial || 0));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const stripped = raw.replace(/[^\d,.-]/g, "").replace(",", ".");
    const parsed = parseFloat(stripped);
    const num = isNaN(parsed) ? 0 : parsed;
    setNumericValue(num);
    if (stripped.endsWith(".") || stripped === "-" || stripped === "") {
      setDisplay(raw.replace(/[^\d,.-]/g, ""));
    } else {
      setDisplay(formatMoneyInput(num));
    }
  }

  async function save() {
    setDisplay(formatMoneyInput(numericValue));
    if (numericValue === (initial || 0)) return;
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cashflowInitial: numericValue }),
    });
    if (res.ok) { onSaved(numericValue); toast.success("Стартовый баланс сохранён"); }
    else toast.error("Ошибка сохранения");
  }

  return (
    <input
      className="w-20 text-right text-[11px] leading-snug tabular-nums italic bg-transparent border border-neutral-300 rounded px-1 py-0 outline-none focus:border-blue-400 focus:bg-white"
      value={display}
      onChange={handleChange}
      onFocus={e => setTimeout(() => e.target.select(), 0)}
      onBlur={save}
      onKeyDown={e => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

function formatMoneyInput(n: number): string {
  if (!n && n !== 0) return "";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n);
}

type WeekHeader = { week: number; month: number; monthName: string };

type SummaryKey = "cashflow" | "incomePlanFact" | "incomeFact" | "incomePlan" | "incomeCumulative" | "marginPct" | "expenses" | "expensePlan" | "overspend";

const SUMMARY_DEFS: { key: SummaryKey; label: string; signed?: boolean; highlight?: boolean; tooltip?: string }[] = [
  {
    key: "cashflow",
    label: "Кэшфлоу (нараст.)",
    highlight: true,
    tooltip:
      "Для первой недели — значение, введённое вручную. Для последующих недель: значение строки «Кэшфлоу» предыдущей недели + «Доход, факт+план» за соответствующую неделю - «План-фикс расходов по статьям» за соответствующую неделю",
  },
  {
    key: "incomePlanFact",
    label: "Доход, факт+план",
    tooltip: "Сумма всех начислений с соответствующей неделей оплаты",
  },
  {
    key: "incomeFact",
    label: "Доход, факт",
    tooltip: "Сумма начислений со статусом «Оплачено» с соответствующей неделей оплаты",
  },
  {
    key: "incomePlan",
    label: "Доход, план",
    tooltip: "Сумма начислений со статусом, отличным от «Оплачено» с соответствующей неделей оплаты",
  },
  {
    key: "incomeCumulative",
    label: "Доход накоп. итогом",
    tooltip:
      "Значение строки «Доход накопленным итогом» предыдущей недели + «Доход, факт+план» за соответствующую неделю",
  },
  {
    key: "marginPct",
    label: "Маржа в моменте %",
    tooltip: "«Кэшфлоу» / «Доход накопленным итогом» за соответствующую неделю",
  },
  {
    key: "expenses",
    label: "Расходы (факт+долг+план)",
    tooltip: "Сумма выставленных работ с любым статусом за соответствующую неделю",
  },
];

type PlanLineRow = {
  id: string;
  executorId: string;
  executorName: string;
  executorHasPersonalSmeta: boolean;
  workTypeId: string;
  workTypeName: string;
  sourceType: string | null;
  weeks: (string | null)[];
  lineIds: (string | null)[];
};

type WorkTypeExpenseRow = {
  id: string;
  name: string;
  weeks: number[];
  executors: { id: string; name: string; weeks: number[] }[];
};

type DashboardData = {
  project: { id: string; name: string; status: string; client: string | null; responsible: string | null; cashflowInitial: number };
  year: number;
  weeks: WeekHeader[];
  summary: Record<SummaryKey | "expensePlan" | "overspend" | "paidWorks", number[]>;
  workTypes: WorkTypeExpenseRow[];
  planLines: PlanLineRow[];
  executors: { id: string; name: string; workTypeIds: string[] }[];
  availableWorkTypes: { id: string; name: string }[];
};

const CHANGED_CELL_CLASS = "bg-amber-100/80 font-medium text-amber-950";

function planCellDisplay(value: string | null): string {
  if (value === null) return "·";
  const number = parseFloat(value);
  return Number.isNaN(number) ? "·" : fmt(number);
}

/** Спец-записи «Пока не известен» (вид работ/исполнитель) определяются по имени. */
function isUnknownName(name: string): boolean {
  return /не\s*извест/i.test(name);
}

type EditingCell = {
  executorId: string;
  executorName: string;
  workTypeId: string;
  workTypeName: string;
  weekIdx: number;
  value: string;
  lineId: string | null;
};

function restoreStringSet(value: unknown): Set<string> | null {
  const values = value instanceof Set ? [...value] : Array.isArray(value) ? value : null;
  if (!values) return null;
  return new Set(values.filter((item): item is string => typeof item === "string"));
}

function AddPlanLineDialog({
  open,
  onClose,
  projectId,
  year,
  executors,
  workTypes,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  year: number;
  executors: { id: string; name: string; workTypeIds: string[] }[];
  workTypes: { id: string; name: string }[];
  onCreated: () => void;
}) {
  const [workTypeId, setWorkTypeId] = useState<string | null>(null);
  const [executorId, setExecutorId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // «Пока не известен»: вид работ доступен всем исполнителям,
  // исполнитель «Пока не известен» доступен для любых видов работ.
  const selectedWorkType = workTypeId ? workTypes.find(w => w.id === workTypeId) : null;
  const workTypeIsUnknown = selectedWorkType ? isUnknownName(selectedWorkType.name) : false;
  const filteredExecutors = workTypeId && !workTypeIsUnknown
    ? executors.filter(e => e.workTypeIds.includes(workTypeId) || isUnknownName(e.name))
    : executors;

  function handleWorkTypeChange(id: string) {
    setWorkTypeId(id);
    setExecutorId(null);
  }

  async function handleSave() {
    if (!executorId || !workTypeId) { toast.error("Выберите вид работ и исполнителя"); return; }
    setSaving(true);
    const res = await fetch(`/api/projects/${projectId}/spending-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executorId, workTypeId, year, week: 1, amount: 0 }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Не удалось создать строку");
      return;
    }
    onCreated();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Добавить строку плана</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Вид работ</Label>
            <Select value={workTypeId ?? ""} onValueChange={v => v && handleWorkTypeChange(v)}>
              <SelectTrigger className="mt-1 w-full" data-placeholder={!workTypeId || undefined}>
                <SelectValue>
                  {workTypeId
                    ? (workTypes.find(w => w.id === workTypeId)?.name ?? workTypeId)
                    : <span className="text-muted-foreground">Выберите вид работ…</span>}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {workTypes.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>
              Исполнитель
              {workTypeId && filteredExecutors.length === 0 && (
                <span className="ml-2 text-xs text-amber-600 font-normal">Нет исполнителей с этим видом работ</span>
              )}
              {workTypeId && filteredExecutors.length > 0 && (
                <span className="ml-2 text-xs text-neutral-400 font-normal">{filteredExecutors.length} доступно</span>
              )}
            </Label>
            <Select value={executorId ?? ""} onValueChange={v => v && setExecutorId(v)}>
              <SelectTrigger className="mt-1 w-full" data-placeholder={!executorId || undefined}>
                <SelectValue>
                  {executorId
                    ? (executors.find(e => e.id === executorId)?.name ?? executorId)
                    : <span className="text-muted-foreground">Выберите исполнителя…</span>}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {filteredExecutors.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "…" : "Добавить"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Editable cell for SpendingPlanLine
function PlanCell({
  value,
  lineId,
  projectId,
  executorId,
  workTypeId,
  year,
  week,
  onUpdate,
  changed,
}: {
  value: string | null;
  lineId: string | null;
  projectId: string;
  executorId: string;
  workTypeId: string;
  year: number;
  week: number;
  onUpdate: () => void;
  changed?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const amount = parseFloat(draft.replace(/\s/g, "").replace(",", "."));
    if (isNaN(amount)) { setEditing(false); return; }
    setSaving(true);
    const res = await fetch(`/api/projects/${projectId}/spending-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executorId, workTypeId, year, week, amount }),
    });
    setSaving(false);
    if (res.ok) { onUpdate(); }
    setEditing(false);
  }

  if (editing) {
    return (
      <Input
        autoFocus
        className="h-6 w-full text-right text-xs p-1"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
      />
    );
  }

  const num = value !== null ? parseFloat(value) : null;
  const display = num !== null ? (num === 0 ? "—" : fmt(num)) : "·";

  return (
    <div
      className={cn(
        "w-full h-full min-h-[22px] flex items-center justify-end px-1 cursor-pointer tabular-nums select-none",
        saving && "opacity-50",
        num !== null && num !== 0 ? "text-neutral-800" : "text-neutral-300",
        "hover:bg-neutral-100/70",
        changed && CHANGED_CELL_CLASS
      )}
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
    >
      {display}
    </div>
  );
}

export function ProjectDashboardClient({ projectId, isAdmin, canManagePlan }: { projectId: string; isAdmin: boolean; canManagePlan?: boolean }) {
  const { panel, sourceA, sourceB, onlyChanges } = useComparison();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRow, setConfirmRow] = useState<PlanLineRow | null>(null);
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);
  const [showOldWeeks, setShowOldWeeks] = useState(false);

  // Сворачиваемые секции ДП (localStorage)
  const [summaryExpanded, toggleSummary] = useSectionCollapsed("summary", true);
  const [expensesExpanded, toggleExpenses] = useSectionCollapsed("expenses", true);
  const [planExpanded, togglePlan] = useSectionCollapsed("plan", true);
  // Раскрытие видов работ внутри блоков (по умолчанию все свёрнуты)
  const [expandedExpenseWT, setExpandedExpenseWT] = useState<Set<string>>(new Set());
  const [expandedPlanWT, setExpandedPlanWT] = useState<Set<string>>(new Set());
  const [compareResult, setCompareResult] = useState<{
    key: string;
    data: DashboardData;
  } | null>(null);
  const [compareError, setCompareError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const otherSource = panel === "A" ? sourceB : sourceA;
  const compareRequestKey = panel
    ? `${projectId}\0${year}\0${otherSource || "live"}`
    : null;
  const compareData =
    compareResult?.key === compareRequestKey ? compareResult.data : null;

  usePersistedInterfaceState(
    `project:${projectId}:dashboard`,
    { year, showOldWeeks, expandedExpenseWT, expandedPlanWT },
    (stored) => {
      if (
        typeof stored.year === "number" &&
        Number.isInteger(stored.year) &&
        stored.year >= currentYear - 1 &&
        stored.year <= currentYear + 1
      ) {
        setYear(stored.year);
      }
      if (typeof stored.showOldWeeks === "boolean") {
        setShowOldWeeks(stored.showOldWeeks);
      }
      const expenseWorkTypes = restoreStringSet(stored.expandedExpenseWT);
      if (expenseWorkTypes) setExpandedExpenseWT(expenseWorkTypes);
      const planWorkTypes = restoreStringSet(stored.expandedPlanWT);
      if (planWorkTypes) setExpandedPlanWT(planWorkTypes);
    }
  );

  const toggleSetItem = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (id: string) =>
    setter(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleExpenseWT = toggleSetItem(setExpandedExpenseWT);
  const togglePlanWT = toggleSetItem(setExpandedPlanWT);

  async function deletePlanRow(pl: PlanLineRow) {
    const ids = pl.lineIds.filter((id): id is string => id !== null);
    if (ids.length === 0) { setConfirmRow(null); return; }
    setDeletingRowId(pl.id);
    setConfirmRow(null);
    await Promise.all(
      ids.map(id =>
        fetch(`/api/projects/${projectId}/spending-plan`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        })
      )
    );
    setDeletingRowId(null);
    mutate();
    toast.success("Строка плана удалена");
  }

  const { data, mutate } = useSWR<DashboardData>(
    `/api/projects/${projectId}/dashboard?year=${year}`,
    fetcher
  );

  React.useEffect(() => {
    if (!panel || !compareRequestKey) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      year: String(year),
      source: otherSource || "live",
    });
    fetch(`/api/projects/${projectId}/dashboard?${query.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить данные для сравнения");
        return (await response.json()) as DashboardData;
      })
      .then((otherData) => {
        setCompareResult({ key: compareRequestKey, data: otherData });
        setCompareError(null);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setCompareResult(null);
        setCompareError({
          key: compareRequestKey,
          message: error instanceof Error ? error.message : "Не удалось загрузить сравнение",
        });
        console.error(error);
      });
    return () => controller.abort();
  }, [panel, otherSource, projectId, year, compareRequestKey]);

  const weeksCount = data?.weeks.length ?? getISOWeeksInYear(year);
  const activeCompareError =
    compareError?.key === compareRequestKey ? compareError.message : null;
  const currentISOWeek = getISOWeek(new Date());

  const visibleWeeks = React.useMemo(() => {
    if (!data) return [];
    if (showOldWeeks || year !== currentYear) return data.weeks;
    const fromWeek = firstVisibleDashboardWeek(currentISOWeek);
    return data.weeks.filter((wh) => wh.week >= fromWeek);
  }, [data, showOldWeeks, year, currentYear, currentISOWeek]);

  const visibleWeekIndices = React.useMemo(
    () => visibleWeeks.map((vw) => (data?.weeks ?? []).findIndex((w) => w.week === vw.week)),
    [visibleWeeks, data]
  );

  const YEARS = [currentYear - 1, currentYear, currentYear + 1];

  if (!data) return <div className="p-6 text-sm text-neutral-500">Загрузка…</div>;

  const { project, summary, planLines: rawPlanLines, executors, availableWorkTypes } = data;
  const workTypes = [...(data.workTypes ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, "ru")
  );
  const planLines = [...rawPlanLines].sort((a, b) =>
    a.workTypeName.localeCompare(b.workTypeName, "ru")
  );

  // Группировка строк плана по видам работ
  const planGroupMap = new Map<string, { workTypeId: string; workTypeName: string; lines: PlanLineRow[]; weekTotals: number[] }>();
  for (const pl of planLines) {
    if (!planGroupMap.has(pl.workTypeId)) {
      planGroupMap.set(pl.workTypeId, {
        workTypeId: pl.workTypeId,
        workTypeName: pl.workTypeName,
        lines: [],
        weekTotals: new Array(weeksCount).fill(0),
      });
    }
    const group = planGroupMap.get(pl.workTypeId)!;
    group.lines.push(pl);
    pl.weeks.forEach((v, i) => {
      if (v !== null) group.weekTotals[i] += parseFloat(v) || 0;
    });
  }
  const planGroups = Array.from(planGroupMap.values()).sort((a, b) =>
    a.workTypeName.localeCompare(b.workTypeName, "ru")
  );
  for (const g of planGroups) {
    g.lines.sort((a, b) => a.executorName.localeCompare(b.executorName, "ru"));
  }

  const compareWeekIndex = new Map(
    (compareData?.weeks ?? []).map((week, index) => [week.week, index])
  );
  const compareWorkTypes = new Map(
    (compareData?.workTypes ?? []).map((workType) => [workType.id, workType])
  );
  const compareExecutors = new Map<string, WorkTypeExpenseRow["executors"][number]>();
  for (const workType of compareData?.workTypes ?? []) {
    for (const executor of workType.executors) {
      compareExecutors.set(`${workType.id}\0${executor.id}`, executor);
    }
  }
  const comparePlanLines = new Map(
    (compareData?.planLines ?? []).map((line) => [
      `${line.executorId}\0${line.workTypeId}`,
      line,
    ])
  );
  const comparePlanGroupWeeks = new Map<string, number[]>();
  for (const line of compareData?.planLines ?? []) {
    const totals =
      comparePlanGroupWeeks.get(line.workTypeId) ??
      new Array(compareData?.weeks.length ?? 0).fill(0);
    line.weeks.forEach((value, index) => {
      if (value !== null) totals[index] += parseFloat(value) || 0;
    });
    comparePlanGroupWeeks.set(line.workTypeId, totals);
  }

  const compareReady = panel !== null && compareData !== null;
  const valueChanged = (current: string, other: string | undefined) =>
    compareReady && current !== other;
  const numberAtWeek = (values: number[], week: number) => {
    const index = compareWeekIndex.get(week);
    return index === undefined ? undefined : values[index] ?? 0;
  };
  const planAtWeek = (values: (string | null)[], week: number) => {
    const index = compareWeekIndex.get(week);
    return index === undefined ? undefined : values[index] ?? null;
  };
  const summaryCellChanged = (key: SummaryKey | "expensePlan" | "overspend", week: number) => {
    if (!compareReady) return false;
    const currentIndex = data.weeks.findIndex((item) => item.week === week);
    const currentValue = (summary[key] ?? [])[currentIndex] ?? 0;
    const otherValue = numberAtWeek(compareData.summary[key] ?? [], week);
    const display = (value: number) =>
      key === "marginPct"
        ? (value === 0 ? "—" : `${(value * 100).toFixed(0)}%`)
        : fmt(value);
    return valueChanged(display(currentValue), otherValue === undefined ? undefined : display(otherValue));
  };
  const summaryTotalDisplay = (
    source: DashboardData,
    key: SummaryKey
  ): string => {
    if (key === "cashflow") return fmt(source.project.cashflowInitial ?? 0);
    if (key === "incomeCumulative" || key === "marginPct") return "—";
    return fmt(rowTotal(source.summary[key] ?? []));
  };
  const summaryTotalChanged = (key: SummaryKey) =>
    compareReady &&
    valueChanged(summaryTotalDisplay(data, key), summaryTotalDisplay(compareData, key));
  const aggregateTotalChanged = (key: "expenses" | "expensePlan" | "overspend") =>
    compareReady &&
    valueChanged(
      fmt(rowTotal(summary[key] ?? [])),
      fmt(rowTotal(compareData.summary[key] ?? []))
    );
  const startBalanceChanged =
    compareReady &&
    valueChanged(
      fmt(project.cashflowInitial ?? 0),
      fmt(compareData.project.cashflowInitial ?? 0)
    );
  const summaryRowChanged = (key: SummaryKey) =>
    !compareReady ||
    summaryTotalChanged(key) ||
    visibleWeeks.some((week) => summaryCellChanged(key, week.week));
  const rowOutline = (existsInOther: boolean) => {
    if (!compareReady || existsInOther) return undefined;
    return panel === "B"
      ? "outline outline-1 -outline-offset-1 outline-green-400"
      : "outline outline-1 -outline-offset-1 outline-red-400";
  };
  const workTypeCellChanged = (workType: WorkTypeExpenseRow, week: number) => {
    if (!compareReady) return false;
    const other = compareWorkTypes.get(workType.id);
    const currentIndex = data.weeks.findIndex((item) => item.week === week);
    return valueChanged(
      fmt(workType.weeks[currentIndex] ?? 0),
      other ? fmt(numberAtWeek(other.weeks, week) ?? 0) : undefined
    );
  };
  const executorCellChanged = (
    workTypeId: string,
    executor: WorkTypeExpenseRow["executors"][number],
    week: number
  ) => {
    if (!compareReady) return false;
    const other = compareExecutors.get(`${workTypeId}\0${executor.id}`);
    const currentIndex = data.weeks.findIndex((item) => item.week === week);
    return valueChanged(
      fmt(executor.weeks[currentIndex] ?? 0),
      other ? fmt(numberAtWeek(other.weeks, week) ?? 0) : undefined
    );
  };
  const executorRowChanged = (
    workTypeId: string,
    executor: WorkTypeExpenseRow["executors"][number]
  ) => {
    if (!compareReady) return true;
    const other = compareExecutors.get(`${workTypeId}\0${executor.id}`);
    return (
      !other ||
      valueChanged(executor.name, other.name) ||
      valueChanged(fmt(rowTotal(executor.weeks)), fmt(rowTotal(other.weeks))) ||
      visibleWeeks.some((week) => executorCellChanged(workTypeId, executor, week.week))
    );
  };
  const workTypeRowChanged = (workType: WorkTypeExpenseRow) => {
    if (!compareReady) return true;
    const other = compareWorkTypes.get(workType.id);
    return (
      !other ||
      valueChanged(workType.name, other.name) ||
      valueChanged(fmt(rowTotal(workType.weeks)), fmt(rowTotal(other.weeks))) ||
      visibleWeeks.some((week) => workTypeCellChanged(workType, week.week)) ||
      workType.executors.some((executor) => executorRowChanged(workType.id, executor)) ||
      other.executors.some(
        (otherExecutor) =>
          !workType.executors.some((executor) => executor.id === otherExecutor.id)
      )
    );
  };
  const planLineCellChanged = (line: PlanLineRow, week: number) => {
    if (!compareReady) return false;
    const other = comparePlanLines.get(`${line.executorId}\0${line.workTypeId}`);
    const currentIndex = data.weeks.findIndex((item) => item.week === week);
    return valueChanged(
      planCellDisplay(line.weeks[currentIndex] ?? null),
      other ? planCellDisplay(planAtWeek(other.weeks, week) ?? null) : undefined
    );
  };
  const planLineRowChanged = (line: PlanLineRow) => {
    if (!compareReady) return true;
    const other = comparePlanLines.get(`${line.executorId}\0${line.workTypeId}`);
    const currentAmounts = line.weeks.map((value) => (value ? parseFloat(value) : 0));
    const otherAmounts = other?.weeks.map((value) => (value ? parseFloat(value) : 0));
    return (
      !other ||
      valueChanged(line.executorName, other.executorName) ||
      valueChanged(fmt(rowTotal(currentAmounts)), otherAmounts ? fmt(rowTotal(otherAmounts)) : undefined) ||
      visibleWeeks.some((week) => planLineCellChanged(line, week.week))
    );
  };
  const planGroupCellChanged = (workTypeId: string, values: number[], week: number) => {
    if (!compareReady) return false;
    const other = comparePlanGroupWeeks.get(workTypeId);
    const currentIndex = data.weeks.findIndex((item) => item.week === week);
    return valueChanged(
      fmt(values[currentIndex] ?? 0),
      other ? fmt(numberAtWeek(other, week) ?? 0) : undefined
    );
  };
  const planGroupRowChanged = (group: (typeof planGroups)[number]) => {
    if (!compareReady) return true;
    const otherWeeks = comparePlanGroupWeeks.get(group.workTypeId);
    const otherName = (compareData.planLines ?? []).find(
      (line) => line.workTypeId === group.workTypeId
    )?.workTypeName;
    return (
      !otherWeeks ||
      valueChanged(group.workTypeName, otherName) ||
      valueChanged(fmt(rowTotal(group.weekTotals)), fmt(rowTotal(otherWeeks))) ||
      visibleWeeks.some((week) =>
        planGroupCellChanged(group.workTypeId, group.weekTotals, week.week)
      ) ||
      group.lines.some(planLineRowChanged) ||
      (compareData.planLines ?? []).some(
        (otherLine) =>
          otherLine.workTypeId === group.workTypeId &&
          !group.lines.some((line) => line.executorId === otherLine.executorId)
      )
    );
  };
  const visibleSummaryDefs =
    onlyChanges && panel ? SUMMARY_DEFS.filter(({ key }) => summaryRowChanged(key)) : SUMMARY_DEFS;
  const visibleWorkTypes =
    onlyChanges && panel ? workTypes.filter(workTypeRowChanged) : workTypes;
  const visiblePlanGroups =
    onlyChanges && panel ? planGroups.filter(planGroupRowChanged) : planGroups;

  // Group month headers
  const monthGroups: { label: string; count: number }[] = [];
  for (const wh of visibleWeeks) {
    const last = monthGroups[monthGroups.length - 1];
    const label = wh.monthName;
    if (last && last.label === label) last.count++;
    else monthGroups.push({ label, count: 1 });
  }

  // Row totals
  function rowTotal(arr: number[]) {
    return arr.reduce((a, b) => a + b, 0);
  }

  const tdCls = "px-2 py-1 text-right text-xs tabular-nums whitespace-nowrap border-r border-neutral-100 last:border-0";
  const thCls = "px-2 py-1 text-right text-xs font-medium text-neutral-600 border-r border-neutral-100 last:border-0 bg-neutral-50 whitespace-nowrap";
  const stickyLbl = "sticky left-0 z-10 bg-white px-3 py-1 text-xs font-medium text-neutral-700 border-r border-neutral-200 whitespace-nowrap w-[200px] min-w-[200px] max-w-[200px] overflow-hidden shadow-[1px_0_0_0_#e5e7eb]";
  const stickyHdr = "sticky left-0 z-[15] bg-neutral-50 border-r border-neutral-200 shadow-[1px_0_0_0_#e5e7eb] px-3 py-1 text-xs font-semibold text-neutral-500 tracking-wide uppercase whitespace-nowrap w-[200px] min-w-[200px] max-w-[200px]";
  const stickyTotal = "sticky left-[200px] z-10 bg-neutral-50 px-2 py-1 text-right text-xs tabular-nums whitespace-nowrap font-medium border-r border-neutral-200 min-w-[104px] shadow-[1px_0_0_0_#e5e7eb]";
  const stickyTotalHdr = "sticky left-[200px] top-0 z-30 bg-neutral-100 px-2 py-1 text-right text-xs font-semibold text-neutral-600 whitespace-nowrap min-w-[104px] border-r border-neutral-200 shadow-[1px_0_0_0_#e5e7eb]";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href={isAdmin ? "/admin/projects" : "/responsible/projects"}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> К списку
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">{project.name}</h1>
            <p className="text-sm text-neutral-500">
              {project.responsible ?? "Без ответственного"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onValueChange={v => v && setYear(parseInt(v))}>
            <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {activeCompareError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {activeCompareError}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center gap-2 text-neutral-500 text-xs mb-1"><TrendingUp className="h-3.5 w-3.5" />Приход</div>
          <p className={cn(
            "text-lg font-semibold",
            compareReady &&
              valueChanged(
                fmt(rowTotal(summary.incomeFact)),
                fmt(rowTotal(compareData.summary.incomeFact))
              ) &&
              CHANGED_CELL_CLASS
          )}>{rowTotal(summary.incomeFact).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center gap-2 text-neutral-500 text-xs mb-1"><CreditCard className="h-3.5 w-3.5" />Расходы</div>
          <p className={cn("text-lg font-semibold", aggregateTotalChanged("expenses") && CHANGED_CELL_CLASS)}>
            {rowTotal(summary.expenses).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽
          </p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center gap-2 text-neutral-500 text-xs mb-1">Кэшфлоу</div>
          <p className={cn(
            "text-lg font-semibold",
            compareReady &&
              valueChanged(
                fmtSign(summary.cashflow[summary.cashflow.length - 1] ?? 0),
                fmtSign(compareData.summary.cashflow[compareData.summary.cashflow.length - 1] ?? 0)
              ) &&
              CHANGED_CELL_CLASS
          )}>
            {fmtSign(summary.cashflow[summary.cashflow.length - 1])} ₽
          </p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center gap-2 text-neutral-500 text-xs mb-1"><AlertTriangle className="h-3.5 w-3.5" />Перерасход</div>
          <p className={cn("text-lg font-semibold", aggregateTotalChanged("overspend") && CHANGED_CELL_CLASS)}>
            {fmtSign(rowTotal(summary.overspend ?? []))} ₽
          </p>
        </div>
      </div>

      <CollapsibleSection sectionId="cashflow-chart" title="График кэшфлоу" defaultExpanded={false}>
        <ProjectCashflowChart
          weeks={visibleWeeks}
          cashflow={visibleWeekIndices.map((i) => summary.cashflow[i] ?? 0)}
          expensePlan={visibleWeekIndices.map((i) => summary.expensePlan[i] ?? 0)}
          incomePlanFact={visibleWeekIndices.map((i) => summary.incomePlanFact[i] ?? 0)}
        />
      </CollapsibleSection>

      {/* Main grid */}
      <div className="rounded-lg border border-neutral-200 bg-white flex flex-col max-h-[90dvh] min-h-0 overflow-hidden">
        {year === currentYear && (
          <div className="shrink-0 px-3 pt-2 pb-0">
            <button
              className="text-xs text-neutral-400 hover:text-neutral-700 hover:underline underline-offset-2"
              onClick={() => setShowOldWeeks((v) => !v)}
            >
              {showOldWeeks
                ? "Скрыть прошлые недели"
                : `Показать ${(data?.weeks.length ?? 0) - visibleWeeks.length} прошлых недель`}
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="min-w-max border-collapse text-sm">
            <thead className="sticky top-0 z-20">
              {/* Month row */}
              <tr className="bg-neutral-50 border-b border-neutral-100">
                <th className={cn(stickyLbl, "z-30 font-semibold text-neutral-600 bg-neutral-50")} rowSpan={2}>Показатель</th>
                <th className={stickyTotalHdr} rowSpan={2}>Итого</th>
                {monthGroups.map((mg, i) => (
                  <th key={i} colSpan={mg.count} className="px-2 py-1 text-center text-xs font-medium text-neutral-500 border-r border-neutral-100 bg-neutral-50">
                    {mg.label}
                  </th>
                ))}
              </tr>
              {/* Week row */}
              <tr className="bg-neutral-50 border-b border-neutral-200">
                {visibleWeeks.map(wh => (
                  <th key={wh.week} className={cn(thCls, "bg-neutral-50", wh.week === currentISOWeek && year === currentYear ? "!bg-blue-50 font-semibold" : wh.week < currentISOWeek && year === currentYear ? "text-neutral-400" : "")}>
                    {wh.week}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <td className={cn(stickyHdr, "cursor-pointer select-none")} onClick={toggleSummary}>
                  <span className="inline-flex items-center gap-1">
                    <SectionChevron expanded={summaryExpanded} />
                    Сводка
                  </span>
                </td>
                <td className={cn(stickyTotal, "bg-neutral-50")} />
                <td colSpan={visibleWeeks.length} className="bg-neutral-50" />
              </tr>
              {/* Стартовый баланс: редактируемый input в ячейке первой недели */}
              {summaryExpanded && (!onlyChanges || !panel || !compareReady || startBalanceChanged) && (
                <tr className="hover:bg-neutral-50 border-b border-neutral-100">
                  <td className={cn(stickyLbl, "font-normal italic text-neutral-500")}>Стартовый баланс</td>
                  <td className={cn(stickyTotal, startBalanceChanged && CHANGED_CELL_CLASS)}>
                    {fmt(project.cashflowInitial ?? 0)}
                  </td>
                  {visibleWeekIndices.map((idx, vi) => {
                    const wh = visibleWeeks[vi];
                    return (
                      <td key={idx} className={cn(tdCls,
                        wh?.week === currentISOWeek && year === currentYear ? "bg-blue-50" : wh?.week < currentISOWeek && year === currentYear ? "bg-neutral-50/40" : "",
                        idx === 0 && startBalanceChanged && CHANGED_CELL_CLASS,
                      )}>
                        {idx === 0
                          ? (isAdmin
                              ? <StartBalanceInput projectId={projectId} initial={project.cashflowInitial ?? 0} onSaved={() => mutate()} />
                              : fmt(project.cashflowInitial ?? 0))
                          : ""}
                      </td>
                    );
                  })}
                </tr>
              )}
              {summaryExpanded && visibleSummaryDefs.map(({ key, label, signed, highlight, tooltip }) => {
                const arr = summary[key] ?? [];
                const totalRaw: number | null =
                  key === "cashflow"
                    ? (project.cashflowInitial ?? 0)
                    : key === "incomeCumulative" || key === "marginPct"
                    ? null
                    : rowTotal(arr);
                const cellVal = (v: number) =>
                  key === "marginPct"
                    ? (v === 0 ? "—" : `${(v * 100).toFixed(0)}%`)
                    : signed ? fmtSign(v) : fmt(v);
                return (
                  <tr key={key} className={cn(
                    "hover:bg-neutral-50 border-b border-neutral-100",
                    highlight && "bg-blue-50 font-semibold"
                  )}>
                    <td className={cn(stickyLbl, !highlight && "font-normal italic text-neutral-500")}>
                      {tooltip ? (
                        <TooltipProvider delay={200}>
                          <Tooltip>
                            <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">
                              {label}
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs">
                              {tooltip}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        label
                      )}
                    </td>
                    <td className={cn(
                      stickyTotal,
                      highlight && "font-semibold",
                      summaryTotalChanged(key) && CHANGED_CELL_CLASS
                    )}>
                      {totalRaw === null ? "—" : cellVal(totalRaw)}
                    </td>
                    {visibleWeekIndices.map((idx, vi) => {
                      const v = arr[idx] ?? 0;
                      const wh = visibleWeeks[vi];
                      return (
                        <td key={idx} className={cn(tdCls,
                          wh?.week === currentISOWeek && year === currentYear ? "bg-blue-50 font-semibold" : wh?.week < currentISOWeek && year === currentYear ? "text-neutral-400 bg-neutral-50/40" : "",
                          summaryCellChanged(key, wh.week) && CHANGED_CELL_CLASS,
                        )}>
                          {cellVal(v)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Block 2: Расходы из смет (все статусы работ) — итоги в строке заголовка */}
              <tr className="bg-neutral-50 border-t-2 border-b border-neutral-200 font-semibold">
                <td className={cn(stickyHdr, "cursor-pointer select-none")} onClick={toggleExpenses}>
                  <span className="inline-flex items-center gap-1">
                    <SectionChevron expanded={expensesExpanded} />
                    Расходы из смет
                  </span>
                </td>
                <td className={cn(
                  stickyTotal,
                  "font-semibold",
                  aggregateTotalChanged("expenses") && CHANGED_CELL_CLASS
                )}>{fmt(rowTotal(summary.expenses ?? []))}</td>
                {visibleWeekIndices.map((idx, vi) => {
                  const wh = visibleWeeks[vi];
                  const v = (summary.expenses ?? [])[idx] ?? 0;
                  return (
                    <td key={idx} className={cn(
                      tdCls,
                      "bg-neutral-50",
                      wh?.week === currentISOWeek && year === currentYear ? "!bg-blue-50" : "",
                      summaryCellChanged("expenses", wh.week) && CHANGED_CELL_CLASS
                    )}>
                      {fmt(v)}
                    </td>
                  );
                })}
              </tr>
              {expensesExpanded && (
                <>
                  {visibleWorkTypes.length === 0 && (
                    <tr>
                      <td className={stickyLbl}>—</td>
                      <td className={stickyTotal}>—</td>
                      {visibleWeeks.map((_, i) => <td key={i} className={tdCls}>—</td>)}
                    </tr>
                  )}
                  {visibleWorkTypes.map(wt => {
                    const wtExpanded = expandedExpenseWT.has(wt.id);
                    const otherWorkType = compareWorkTypes.get(wt.id);
                    return (
                      <React.Fragment key={wt.id}>
                        <tr
                          className={cn(
                            "hover:bg-neutral-50 border-b border-neutral-100 cursor-pointer select-none",
                            rowOutline(!!otherWorkType)
                          )}
                          onClick={() => toggleExpenseWT(wt.id)}
                        >
                          <td className={cn(
                            stickyLbl,
                            "font-normal",
                            compareReady &&
                              valueChanged(wt.name, otherWorkType?.name) &&
                              CHANGED_CELL_CLASS
                          )}>
                            <span className="inline-flex items-center gap-1">
                              <SectionChevron expanded={wtExpanded} />
                              {wt.name}
                            </span>
                          </td>
                          <td className={cn(
                            stickyTotal,
                            compareReady &&
                              valueChanged(
                                fmt(rowTotal(wt.weeks)),
                                otherWorkType ? fmt(rowTotal(otherWorkType.weeks)) : undefined
                              ) &&
                              CHANGED_CELL_CLASS
                          )}>{fmt(rowTotal(wt.weeks))}</td>
                          {visibleWeekIndices.map((idx, vi) => {
                            const wh = visibleWeeks[vi];
                            const v = wt.weeks[idx] ?? 0;
                            return (
                              <td key={idx} className={cn(
                                tdCls,
                                wh?.week === currentISOWeek && year === currentYear ? "bg-blue-50 font-semibold" : wh?.week < currentISOWeek && year === currentYear ? "text-neutral-400 bg-neutral-50/40" : "",
                                workTypeCellChanged(wt, wh.week) && CHANGED_CELL_CLASS
                              )}>
                                {fmt(v)}
                              </td>
                            );
                          })}
                        </tr>
                        {wtExpanded && wt.executors
                          .filter((executor) => !onlyChanges || !panel || executorRowChanged(wt.id, executor))
                          .map(ex => {
                          const otherExecutor = compareExecutors.get(`${wt.id}\0${ex.id}`);
                          return (
                          <tr
                            key={`${wt.id}:${ex.id}`}
                            className={cn(
                              "hover:bg-neutral-50 border-b border-neutral-100",
                              rowOutline(!!otherExecutor)
                            )}
                          >
                            <td className={cn(
                              stickyLbl,
                              "font-normal",
                              compareReady &&
                                valueChanged(ex.name, otherExecutor?.name) &&
                                CHANGED_CELL_CLASS
                            )}>
                              <span className="pl-6 text-neutral-500 text-[11px] truncate block">{ex.name}</span>
                            </td>
                            <td className={cn(
                              stickyTotal,
                              "font-normal text-neutral-500",
                              compareReady &&
                                valueChanged(
                                  fmt(rowTotal(ex.weeks)),
                                  otherExecutor ? fmt(rowTotal(otherExecutor.weeks)) : undefined
                                ) &&
                                CHANGED_CELL_CLASS
                            )}>{fmt(rowTotal(ex.weeks))}</td>
                            {visibleWeekIndices.map((idx, vi) => {
                              const wh = visibleWeeks[vi];
                              const v = ex.weeks[idx] ?? 0;
                              return (
                                <td key={idx} className={cn(
                                  tdCls,
                                  "text-neutral-500",
                                  wh?.week === currentISOWeek && year === currentYear ? "bg-blue-50" : wh?.week < currentISOWeek && year === currentYear ? "bg-neutral-50/40" : "",
                                  executorCellChanged(wt.id, ex, wh.week) && CHANGED_CELL_CLASS
                                )}>
                                  {fmt(v)}
                                </td>
                              );
                            })}
                          </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </>
              )}

              {/* Block 3: Overspend (row41 = expenses − expensePlan) */}
              {(!onlyChanges ||
                !panel ||
                !compareReady ||
                aggregateTotalChanged("overspend") ||
                visibleWeeks.some((week) => summaryCellChanged("overspend", week.week))) && (
                <tr className="bg-neutral-50 border-t-2 border-b border-neutral-200">
                <td className={cn(stickyLbl, "bg-neutral-50 font-medium text-neutral-800")}>
                  <TooltipProvider delay={200}>
                    <Tooltip>
                      <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">
                        Перерасход
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        Сумма выставленных работ с любым статусом − сумма планов расходов за соответствующую неделю. Красный текст при значении ≠ 0. По клику — список проектов с несхождением
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </td>
                <td className={cn(
                  stickyTotal,
                  overspendValueClass(rowTotal(summary.overspend ?? [])),
                  aggregateTotalChanged("overspend") && CHANGED_CELL_CLASS
                )}>
                  {rowTotal(summary.overspend ?? []) === 0 ? "—" : fmtSign(rowTotal(summary.overspend ?? []))}
                </td>
                {visibleWeekIndices.map((idx, vi) => {
                  const wh = visibleWeeks[vi];
                  const v = (summary.overspend ?? [])[idx] ?? 0;
                  return (
                    <td
                      key={idx}
                      className={cn(
                        tdCls,
                        "bg-neutral-50",
                        overspendValueClass(v),
                        wh?.week === currentISOWeek && year === currentYear
                          ? "!bg-blue-50 font-semibold"
                          : wh?.week < currentISOWeek && year === currentYear && v === 0
                            ? "text-neutral-400"
                            : "",
                        summaryCellChanged("overspend", wh.week) && CHANGED_CELL_CLASS
                      )}
                    >
                      {v === 0 ? "—" : fmtSign(v)}
                    </td>
                  );
                })}
                </tr>
              )}

              {/* Block 4: SpendingPlan — группировка по видам работ, итоги в строке заголовка */}
              <tr className="bg-neutral-50 border-t-2 border-b border-neutral-200 font-semibold">
                <td className={cn(stickyHdr, "cursor-pointer select-none")} onClick={togglePlan}>
                  <span className="inline-flex items-center gap-1">
                    <SectionChevron expanded={planExpanded} />
                    План расходов
                  </span>
                </td>
                <td className={cn(
                  stickyTotal,
                  "font-semibold",
                  aggregateTotalChanged("expensePlan") && CHANGED_CELL_CLASS
                )}>{fmt(rowTotal(summary.expensePlan ?? []))}</td>
                {visibleWeekIndices.map((idx, vi) => {
                  const wh = visibleWeeks[vi];
                  const v = (summary.expensePlan ?? [])[idx] ?? 0;
                  return (
                    <td key={idx} className={cn(
                      tdCls,
                      "bg-neutral-50",
                      wh?.week === currentISOWeek && year === currentYear ? "!bg-blue-50" : "",
                      summaryCellChanged("expensePlan", wh.week) && CHANGED_CELL_CLASS
                    )}>
                      {fmt(v)}
                    </td>
                  );
                })}
              </tr>
              {planExpanded && (
                <>
                  {visiblePlanGroups.length === 0 && !canManagePlan && (
                    <tr className="border-b border-neutral-100">
                      <td className={cn(stickyLbl, "font-normal text-neutral-400")}>Нет строк плана</td>
                      <td className={stickyTotal}>—</td>
                      {visibleWeeks.map((_, i) => (
                        <td key={i} className={tdCls}>—</td>
                      ))}
                    </tr>
                  )}
                  {visiblePlanGroups.map(group => {
                    const groupExpanded = expandedPlanWT.has(group.workTypeId);
                    const otherGroupWeeks = comparePlanGroupWeeks.get(group.workTypeId);
                    const otherGroupName = compareData?.planLines.find(
                      (line) => line.workTypeId === group.workTypeId
                    )?.workTypeName;
                    return (
                      <React.Fragment key={group.workTypeId}>
                        {/* Строка вида работ (агрегат) */}
                        <tr
                          className={cn(
                            "hover:bg-neutral-50 border-b border-neutral-100 cursor-pointer select-none",
                            rowOutline(!!otherGroupWeeks)
                          )}
                          onClick={() => togglePlanWT(group.workTypeId)}
                        >
                          <td className={cn(
                            stickyLbl,
                            "font-normal",
                            compareReady &&
                              valueChanged(group.workTypeName, otherGroupName) &&
                              CHANGED_CELL_CLASS
                          )}>
                            <span className="inline-flex items-center gap-1">
                              <SectionChevron expanded={groupExpanded} />
                              <span className="truncate font-medium text-neutral-900">{group.workTypeName}</span>
                            </span>
                          </td>
                          <td className={cn(
                            stickyTotal,
                            compareReady &&
                              valueChanged(
                                fmt(rowTotal(group.weekTotals)),
                                otherGroupWeeks ? fmt(rowTotal(otherGroupWeeks)) : undefined
                              ) &&
                              CHANGED_CELL_CLASS
                          )}>{fmt(rowTotal(group.weekTotals))}</td>
                          {visibleWeekIndices.map((idx, vi) => {
                            const wh = visibleWeeks[vi];
                            const v = group.weekTotals[idx] ?? 0;
                            return (
                              <td key={idx} className={cn(
                                tdCls,
                                wh?.week === currentISOWeek && year === currentYear ? "bg-blue-50 font-semibold" : wh?.week < currentISOWeek && year === currentYear ? "text-neutral-400 bg-neutral-50/40" : "",
                                planGroupCellChanged(group.workTypeId, group.weekTotals, wh.week) && CHANGED_CELL_CLASS
                              )}>
                                {fmt(v)}
                              </td>
                            );
                          })}
                        </tr>
                        {/* Строки исполнителей */}
                        {groupExpanded && group.lines
                          .filter((line) => !onlyChanges || !panel || planLineRowChanged(line))
                          .map(pl => {
                          const weekAmounts = pl.weeks.map(v => (v ? parseFloat(v) : 0));
                          const isDeleting = deletingRowId === pl.id;
                          const otherPlanLine = comparePlanLines.get(`${pl.executorId}\0${pl.workTypeId}`);
                          return (
                            <tr key={pl.id} className={cn(
                              "group hover:bg-neutral-50 border-b border-neutral-100",
                              isDeleting && "opacity-40 pointer-events-none",
                              rowOutline(!!otherPlanLine)
                            )}>
                              <td className={cn(
                                stickyLbl,
                                "font-normal",
                                compareReady &&
                                  valueChanged(pl.executorName, otherPlanLine?.executorName) &&
                                  CHANGED_CELL_CLASS
                              )}>
                                <div className="flex items-center gap-1 min-w-0 pl-6">
                                  <div className="flex flex-col leading-tight min-w-0 flex-1">
                                    {isAdmin && pl.executorHasPersonalSmeta ? (
                                      <Link
                                        href={`/admin/executors/${pl.executorId}?fromProject=${projectId}`}
                                        className="text-[11px] text-blue-600 hover:underline truncate max-w-full"
                                        title="Открыть личную смету"
                                      >
                                        <span className="truncate">{pl.executorName}</span>
                                      </Link>
                                    ) : !isAdmin ? (
                                      <Link
                                        href={`/executor/executors/${pl.executorId}?tab=settings`}
                                        className="text-[11px] text-blue-600 hover:underline truncate max-w-full"
                                        title="Открыть настройки исполнителя"
                                      >
                                        <span className="truncate">{pl.executorName}</span>
                                      </Link>
                                    ) : (
                                      <span className="text-neutral-500 text-[11px] truncate">{pl.executorName}</span>
                                    )}
                                  </div>
                                  {canManagePlan && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-neutral-400 hover:text-red-500 hover:bg-red-50"
                                      onClick={() => setConfirmRow(pl)}
                                      disabled={isDeleting}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </td>
                              <td className={cn(
                                stickyTotal,
                                compareReady &&
                                  valueChanged(
                                    fmt(rowTotal(weekAmounts)),
                                    otherPlanLine
                                      ? fmt(rowTotal(otherPlanLine.weeks.map(
                                          (value) => (value ? parseFloat(value) : 0)
                                        )))
                                      : undefined
                                  ) &&
                                  CHANGED_CELL_CLASS
                              )}>{fmt(rowTotal(weekAmounts))}</td>
                              {visibleWeekIndices.map((idx, vi) => {
                                const wh = visibleWeeks[vi];
                                const v = pl.weeks[idx] ?? null;
                                return (
                                  <td key={idx} className={cn(
                                    "p-0 text-right border-r border-neutral-100 last:border-0",
                                    wh?.week === currentISOWeek && year === currentYear ? "bg-blue-50" : wh?.week < currentISOWeek && year === currentYear ? "bg-neutral-50/40" : "",
                                    !canManagePlan && planLineCellChanged(pl, wh.week) && CHANGED_CELL_CLASS
                                  )}>
                                    {canManagePlan ? (
                                      <PlanCell
                                        value={v}
                                        lineId={pl.lineIds[idx]}
                                        projectId={projectId}
                                        executorId={pl.executorId}
                                        workTypeId={pl.workTypeId}
                                        year={year}
                                        week={visibleWeeks[vi]?.week ?? idx + 1}
                                        onUpdate={() => mutate()}
                                        changed={planLineCellChanged(pl, wh.week)}
                                      />
                                    ) : (
                                      <span className="text-xs tabular-nums">{v ? fmt(parseFloat(v)) : "·"}</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                  {canManagePlan && (
                    <tr className="border-b border-neutral-100 hover:bg-neutral-50/50">
                      <td className={cn(stickyLbl, "font-normal py-1.5")}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 -ml-2 text-xs font-normal text-neutral-600 hover:text-neutral-900"
                          onClick={() => setAddOpen(true)}
                        >
                          <Plus className="h-3.5 w-3.5 mr-0.5 shrink-0" />
                          строка плана
                        </Button>
                      </td>
                      <td className={stickyTotal} />
                      {visibleWeeks.map((wh, i) => (
                        <td
                          key={i}
                          className={cn(
                            tdCls,
                            wh?.week === currentISOWeek && year === currentYear ? "bg-blue-50" : ""
                          )}
                        />
                      ))}
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Все работы по проекту (KPD-287) */}
      <CollapsibleSection sectionId="works" title="Все работы по проекту">
        <WorksReviewTable
          fetchUrl={`/api/projects/${projectId}/works`}
          stateKey={`project:${projectId}:works`}
          emptyText="По проекту ещё нет работ (Личные сметы и Прочие траты)."
          showProjectColumn={false}
        />
      </CollapsibleSection>

      {addOpen && (
        <AddPlanLineDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          projectId={projectId}
          year={year}
          executors={executors}
          workTypes={availableWorkTypes}
          onCreated={() => mutate()}
        />
      )}

      <AlertDialog open={!!confirmRow} onOpenChange={open => { if (!open) setConfirmRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить строку плана?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRow && (
                <>
                  <span className="font-medium">{confirmRow.executorName}</span>
                  {" / "}{confirmRow.workTypeName}
                  <br />
                  Будут удалены все {confirmRow.lineIds.filter(Boolean).length} записей по неделям для этой строки. Действие необратимо.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={() => confirmRow && deletePlanRow(confirmRow)}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
