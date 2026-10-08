"use client";

import React, { useState, useRef } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getISOWeek, getISOWeekYear, isoWeekStart, toLocalDateString } from "@/lib/iso-weeks";
import { defaultCashflowRange, rangeToQuery, type CashflowRange } from "@/lib/cashflow-range";
import { CashflowRangePicker } from "./CashflowRangePicker";
import { formatMoneyWhole } from "@/lib/format";
import { CashflowChart } from "./CashflowChart";
import { CashflowCommentCell } from "@/components/ui-custom/CashflowCommentCell";
import { useComparison } from "@/components/ComparisonProvider";
import {
  cashflowCommentMapKey,
  cashflowHighlightCellClass,
  type CashflowCellMeta,
} from "@/lib/cashflow-comments";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";

const fetcher = (url: string) => fetch(url).then(r => r.json());

function cashflowCommentHistoryUrl(year: number, week: number, rowKey: string) {
  return `/api/activity/comment-history?${new URLSearchParams({
    kind: "cashflow",
    year: String(year),
    week: String(week),
    rowKey,
  })}`;
}

function fmt(n: number) {
  if (n === 0) return "—";
  return formatMoneyWhole(n);
}

function fmtSign(n: number) {
  if (n === 0) return "—";
  return formatMoneyWhole(n);
}

function fmtNullable(n: number | null) {
  if (n === null) return "—";
  if (n === 0) return "—";
  return formatMoneyWhole(n);
}

function fmtManualBalance(n: number | null) {
  if (n === null) return "—";
  return formatMoneyWhole(n);
}

type WeekHeader = { week: number; month: number; monthName: string; year: number };

type SummaryRows = {
  balanceStart: number[];
  incomeFact: number[];
  incomePlanOnly: number[];
  incomePlanFact: number[];
  expensePlanDP: number[];
  balanceEndDP: number[];
  manualBalance: (number | null)[];
  paidFromBudget: number[];
  unpaidFromBudget: number[];
  totalExpenseBudget: number[];
  deltaDP: number[];
  balanceEndBudget: number[];
};

type ProjectRow = {
  id: string;
  name: string;
  type: string;
  plan: number[];
  iw: number[];
  iwPaid: number[];
  charges: number[];
  cashflow: number[];
};

type Aggregates = {
  projectExpenses: number[];
  nonProjectExpenses: number[];
  taxes: number[];
  motivation: number[];
};

type CashflowData = {
  weeks: WeekHeader[];
  openingBalance: number;
  openingBalances: Record<number, number>;
  summary: SummaryRows;
  projects: ProjectRow[];
  externalProjects: ProjectRow[];
  internalProjects: ProjectRow[];
  aggregates: Aggregates;
  balanceInAccounts: (number | null)[];
  discrepancy: (number | null)[];
  discrepancyDPFact: number[];
  currentWeek: number;
  currentWeekYear: number;
};

type CashflowResponse = CashflowData | { error: string };

type SummaryDef = {
  key: Exclude<keyof SummaryRows, "manualBalance">;
  label: string;
  isEditable?: boolean;
  highlight?: boolean;
  signed?: boolean;
  balanceStartRow?: boolean;
  labelAlign?: "left" | "center" | "right";
  borderAfter?: boolean;
};

const ROW_BORDER = "border-b border-neutral-200";
const ROW_BORDER_STRONG = "border-b border-neutral-600";

const SUMMARY_DEFS: SummaryDef[] = [
  { key: "balanceStart", label: "Баланс на начало", isEditable: true, balanceStartRow: true, labelAlign: "left", borderAfter: true },
  { key: "incomeFact", label: "Приход (факт)", labelAlign: "center" },
  { key: "incomePlanOnly", label: "Приход (план)", labelAlign: "center" },
  { key: "incomePlanFact", label: "Приход (план+факт)", labelAlign: "center" },
  { key: "expensePlanDP", label: "Расход (план-факт) из ДП", labelAlign: "center", borderAfter: true },
  { key: "balanceEndDP", label: "Баланс (сметы/ДП)", signed: true, labelAlign: "right" },
  // Далее — balanceInAccounts, discrepancy (рендерятся отдельно)
  { key: "paidFromBudget", label: "Оплачено из смет", labelAlign: "right" },
  { key: "unpaidFromBudget", label: "Неоплачено из смет", labelAlign: "right", borderAfter: true },
  // Далее — discrepancyDPFact (рендерится отдельно)
];

const ROW_TOOLTIPS: Record<string, React.ReactNode> = {
  balanceStart:
    "Для первой недели — значение, введённое вручную. Для последующих недель — значение строки «Баланс (сметы/ДП)» предыдущей недели",
  incomeFact: "Сумма начислений со статусом «Оплачено» с соответствующей неделей оплаты",
  incomePlanOnly: "Сумма начислений со статусом, отличным от «Оплачено» с соответствующей неделей оплаты",
  incomePlanFact: "Сумма всех начислений с соответствующей неделей оплаты",
  expensePlanDP: (
    <div className="flex flex-col gap-1.5 text-left">
      <p>
        <span className="font-semibold">Прошедшие недели:</span>{" "}
        сумма выставленных работ со статусом «Оплачено» с соответствующей неделей оплаты.
      </p>
      <p>
        <span className="font-semibold">Текущая и будущие недели:</span>{" "}
        сумма планов расходов из дашбордов проектов за соответствующую неделю.
      </p>
      <p>Граница между «прошлым» и «текущим»: 00:00 MSK (воскресенье → понедельник)</p>
    </div>
  ),
  balanceEndDP:
    "Расчётный баланс: «Баланс на начало» + «Приход (план+факт)» − «Расход (план-факт) из ДП» за ту же неделю",
  manualBalance:
    "Ручное значение заменяет входящий баланс ДП следующей недели и действует до следующего ручного значения. На баланс из смет не влияет",
  balanceInAccounts: "Значение из колонки «Рубли» раздела «Остаток банковские счета» за соответствующую неделю",
  discrepancy:
    "Несхождение расчётного баланса и фактического остатка на счетах. «Баланс (сметы/ДП)» − «Баланс на счетах». Красный текст при значении ≠ 0",
  paidFromBudget:
    "Сумма выставленных работ со статусом «Оплачено» за соответствующую неделю. Учитываются все проекты, включая неактивные",
  unpaidFromBudget:
    "Сумма выставленных работ со статусом, отличным от «Оплачено», за соответствующую неделю. Учитываются все проекты, включая неактивные",
  discrepancyDPFact:
    "Разница: сумма выставленных работ со статусом «Оплачено» − сумма планов расходов из дашбордов проектов за соответствующую неделю. Красный текст при значении ≠ 0. По клику — список проектов с несхождением",
};

function RowLabelTooltip({ label, tooltip }: { label: string; tooltip?: React.ReactNode }) {
  if (!tooltip) return <>{label}</>;
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">
          {label}
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-sm items-start text-left whitespace-normal">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type AggregateDef = { key: keyof Aggregates; label: string; bold: boolean };
const AGGREGATE_DEFS: AggregateDef[] = [
  { key: "projectExpenses", label: "Проектные расходы", bold: true },
  { key: "nonProjectExpenses", label: "Непроектные расходы", bold: true },
];

function formatMoneyInput(n: number): string {
  if (!n && n !== 0) return "";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n);
}

function OpeningBalanceInput({
  year,
  initial,
  onSaved,
  compact,
}: {
  year: number;
  initial: number;
  onSaved: (v: number) => void;
  compact?: boolean;
}) {
  const [numericValue, setNumericValue] = useState(initial || 0);
  const [display, setDisplay] = useState(formatMoneyInput(initial || 0));
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Оставляем только цифры, знак минус, запятую/точку
    const stripped = raw.replace(/[^\d,.-]/g, "").replace(",", ".");
    const parsed = parseFloat(stripped);
    const num = isNaN(parsed) ? 0 : parsed;
    setNumericValue(num);
    // Форматируем только если строка не заканчивается на разделитель (чтобы не мешать вводу)
    if (stripped.endsWith(".") || stripped === "-" || stripped === "") {
      setDisplay(raw.replace(/[^\d,.-]/g, ""));
    } else {
      setDisplay(formatMoneyInput(num));
    }
  }

  async function save() {
    setDisplay(formatMoneyInput(numericValue));
    const res = await fetch("/api/cashflow/opening-balance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, amount: numericValue }),
    });
    if (res.ok) { onSaved(numericValue); toast.success("Баланс сохранён"); }
  }

  return (
    <input
      ref={inputRef}
      className={
        compact
          ? "w-20 text-right text-[11px] leading-snug tabular-nums italic bg-transparent border border-neutral-300 rounded px-1 py-0 outline-none focus:border-blue-400 focus:bg-white"
          : "h-7 w-28 text-right text-xs tabular-nums border border-neutral-300 rounded px-1.5 outline-none focus:border-blue-400"
      }
      value={display}
      onChange={handleChange}
      onFocus={e => setTimeout(() => e.target.select(), 0)}
      onBlur={save}
      onKeyDown={e => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

function ManualBalanceInput({
  year,
  week,
  initial,
  onSaved,
}: {
  year: number;
  week: number;
  initial: number | null;
  onSaved: (value: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [display, setDisplay] = useState(initial === null ? "" : formatMoneyInput(initial));
  const [isSaving, setIsSaving] = useState(false);
  const lastSavedRef = useRef<number | null>(initial);
  const draftRef = useRef(display);
  const savingRef = useRef(false);

  function parseDisplay(value: string): number | null | undefined {
    const normalized = value.replace(/\s/g, "").replace(",", ".");
    if (!normalized) return null;
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  async function save() {
    if (savingRef.current) return;

    const amount = parseDisplay(draftRef.current);
    if (amount === undefined) {
      toast.error("Введите корректное число");
      const rollback =
        lastSavedRef.current === null ? "" : formatMoneyInput(lastSavedRef.current);
      draftRef.current = rollback;
      setDisplay(rollback);
      return;
    }
    const formatted = amount === null ? "" : formatMoneyInput(amount);
    draftRef.current = formatted;
    setDisplay(formatted);
    if (Object.is(amount, lastSavedRef.current)) {
      setEditing(false);
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    try {
      const res = await fetch("/api/cashflow/manual-balance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, week, amount }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? "Не удалось сохранить баланс");
      }
      lastSavedRef.current = amount;
    } catch (error) {
      const rollback =
        lastSavedRef.current === null ? "" : formatMoneyInput(lastSavedRef.current);
      draftRef.current = rollback;
      setDisplay(rollback);
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить баланс");
      savingRef.current = false;
      setIsSaving(false);
      return;
    }

    try {
      await onSaved(amount);
      setEditing(false);
    } catch {
      toast.error("Баланс сохранён, но данные не удалось обновить");
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`Изменить баланс руками, неделя ${week}`}
        className="min-h-[22px] w-full cursor-pointer px-1 text-right text-[11px] leading-snug tabular-nums text-neutral-500 hover:bg-neutral-100/70"
        onClick={() => {
          const next =
            lastSavedRef.current === null
              ? ""
              : formatMoneyInput(lastSavedRef.current);
          draftRef.current = next;
          setDisplay(next);
          setEditing(true);
        }}
      >
        {fmtManualBalance(initial)}
      </button>
    );
  }

  return (
    <input
      aria-label={`Баланс руками, неделя ${week}`}
      className="w-20 rounded border border-neutral-300 bg-transparent px-1 py-0 text-right text-[11px] leading-snug tabular-nums outline-none focus:border-blue-400 focus:bg-white"
      value={display}
      disabled={isSaving}
      aria-busy={isSaving}
      onChange={(event) => {
        if (savingRef.current) return;
        draftRef.current = event.target.value;
        setDisplay(event.target.value);
      }}
      onFocus={(event) => setTimeout(() => event.target.select(), 0)}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          const rollback =
            lastSavedRef.current === null ? "" : formatMoneyInput(lastSavedRef.current);
          draftRef.current = rollback;
          setDisplay(rollback);
          setEditing(false);
        }
      }}
    />
  );
}

type DiscrepancyModalState = {
  weekIdx: number;
  week: number;
  year: number;
} | null;

export function CashflowClient() {
  const comparison = useComparison();
  const now = new Date();
  const currentISOWeek = getISOWeek(now);
  const currentISOYear = getISOWeekYear(now);
  const [range, setRange] = useState<CashflowRange>(() => defaultCashflowRange());
  const rangeQuery = rangeToQuery(range);
  const [activeTab, setActiveTab] = useState<"table" | "chart">("table");
  const [discrepancyModal, setDiscrepancyModal] = useState<DiscrepancyModalState>(null);

  const { data, mutate } = useSWR<CashflowResponse>(
    `/api/cashflow?${rangeQuery}&source=${encodeURIComponent(comparison.activeSource)}`,
    fetcher
  );

  const { data: cellMeta, mutate: mutateCellMeta } = useSWR<Record<string, CashflowCellMeta>>(
    comparison.readOnly ? null : `/api/cashflow/comments?${rangeQuery}`,
    fetcher
  );

  async function saveCellMeta(
    rowKey: string,
    year: number,
    week: number,
    payload: { text: string; highlight: string | null }
  ) {
    if (comparison.readOnly) {
      toast.error("Исторические данные доступны только для чтения");
      return;
    }
    const res = await fetch("/api/cashflow/comments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, week, rowKey, ...payload }),
    });
    if (!res.ok) {
      toast.error("Не удалось сохранить");
      return;
    }
    await mutateCellMeta();
  }

  function getCellMeta(rowKey: string, year: number, week: number): CashflowCellMeta | undefined {
    return cellMeta?.[cashflowCommentMapKey(rowKey, year, week)];
  }

  const [showOldWeeks, setShowOldWeeks] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  usePersistedInterfaceState(
    "cashflow",
    { range, activeTab, showOldWeeks },
    (stored) => {
      if (stored.range !== undefined) setRange(stored.range);
      if (stored.activeTab !== undefined) setActiveTab(stored.activeTab);
      if (stored.showOldWeeks !== undefined) setShowOldWeeks(stored.showOldWeeks);
    }
  );
  usePersistedScroll(tableScrollRef, `cashflow-table:${activeTab}`, {
    enabled: !!data,
    signature: { range, activeTab, showOldWeeks },
  });

  const weeks = React.useMemo(
    () => (data && !("error" in data) ? data.weeks : []),
    [data]
  );
  // Свёрнуты все недели раньше «текущая − 4».
  const cutoffKey = React.useMemo(() => {
    const d = isoWeekStart(currentISOYear, currentISOWeek);
    d.setDate(d.getDate() - 4 * 7);
    return toLocalDateString(d);
  }, [currentISOYear, currentISOWeek]);
  const isOldWeek = React.useCallback(
    (wh: WeekHeader) => toLocalDateString(isoWeekStart(wh.year, wh.week)) < cutoffKey,
    [cutoffKey]
  );
  const oldWeeksCount = React.useMemo(() => weeks.filter(isOldWeek).length, [weeks, isOldWeek]);
  const visibleWeeks = React.useMemo(() => {
    if (showOldWeeks) return weeks;
    return weeks.filter((wh) => !isOldWeek(wh));
  }, [weeks, showOldWeeks, isOldWeek]);

  const visibleWeekIndices = React.useMemo(
    () => visibleWeeks.map((vw) => weeks.findIndex((w) => w.week === vw.week && w.year === vw.year)),
    [visibleWeeks, weeks]
  );

  const chartProjects = React.useMemo(() => {
    if (!data || "error" in data) return [];
    return [
      ...(data.externalProjects ?? data.projects),
      ...(data.internalProjects ?? []),
    ];
  }, [data]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-neutral-500">
        Загрузка…
      </div>
    );
  }
  if ("error" in data) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-neutral-500">
        {data.error}
      </div>
    );
  }

  const { summary, aggregates, balanceInAccounts, discrepancy, discrepancyDPFact } = data;
  const externalProjects = [...(data.externalProjects ?? data.projects ?? [])].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const internalProjects = [...(data.internalProjects ?? [])].sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const numCls = "px-2 py-1 text-right text-xs tabular-nums whitespace-nowrap border-r border-neutral-100 last:border-0";
  const tdCls = numCls;
  const compactTdCls =
    "px-2 py-0.5 text-right text-[11px] leading-snug tabular-nums whitespace-nowrap border-r border-neutral-100 last:border-0";
  const thCls =
    "px-2 py-0.5 text-center text-xs leading-snug font-medium text-neutral-500 border-r border-neutral-100 whitespace-nowrap";
  const stickyLbl = "sticky left-0 z-10 bg-white px-3 py-1 text-[10px] leading-snug border-r border-neutral-200 whitespace-nowrap overflow-hidden text-ellipsis w-[240px] min-w-[200px] max-w-[240px] shadow-[1px_0_0_0_#e5e7eb]";
  const compactLbl =
    "sticky left-0 z-10 bg-white px-2.5 py-0.5 text-[10px] leading-snug border-r border-neutral-200 whitespace-nowrap overflow-hidden text-ellipsis w-[240px] min-w-[200px] max-w-[240px] shadow-[1px_0_0_0_#e5e7eb]";
  const stickyHdr = "sticky left-0 z-[15] bg-neutral-50 border-r border-neutral-200 shadow-[1px_0_0_0_#e5e7eb] px-3 py-1 text-[10px] leading-snug font-semibold text-neutral-500 tracking-wide uppercase whitespace-nowrap overflow-hidden text-ellipsis w-[240px] min-w-[200px] max-w-[240px]";
  const compactHdr =
    "sticky left-0 z-[15] bg-neutral-50 border-r border-neutral-200 shadow-[1px_0_0_0_#e5e7eb] px-2.5 py-0.5 text-[10px] font-semibold text-neutral-500 tracking-wide uppercase whitespace-nowrap overflow-hidden text-ellipsis w-[240px] min-w-[200px] max-w-[240px]";
  const stickyTotalHdr = "bg-neutral-100 px-2 py-0.5 text-right text-xs font-semibold text-neutral-600 whitespace-nowrap min-w-[104px] border-r border-neutral-200";
  const stickyTotal = "bg-neutral-50 px-2 py-0.5 text-right text-[11px] tabular-nums whitespace-nowrap font-medium border-r border-neutral-200 min-w-[104px]";
  const weekOrder = (wIdx: number) => (weeks[wIdx]?.year ?? 0) * 100 + (weeks[wIdx]?.week ?? 0);
  const currentOrder = currentISOYear * 100 + currentISOWeek;
  const isFuture = (wIdx: number) => weekOrder(wIdx) > currentOrder;
  const isCurrent = (wIdx: number) => weekOrder(wIdx) === currentOrder;
  const isPast = (wIdx: number) => weekOrder(wIdx) < currentOrder;

  function weekCellClass(idx: number, extra?: string, compact?: boolean) {
    return cn(
      compact ? compactTdCls : tdCls,
      isCurrent(idx)
        ? compact
          ? "bg-blue-50 font-medium"
          : "bg-blue-50 font-semibold"
        : isPast(idx)
          ? "text-neutral-400 bg-neutral-50/30"
          : isFuture(idx)
            ? "bg-neutral-800/5 text-neutral-700"
            : "",
      extra
    );
  }

  function renderWeekCell(
    rowKey: string,
    idx: number,
    content: React.ReactNode,
    extraTdClass?: string,
    compact?: boolean
  ) {
    const week = weeks[idx]?.week;
    const wYear = weeks[idx]?.year ?? 0;
    if (week == null) return null;
    const meta = getCellMeta(rowKey, wYear, week);
    const highlightClass = cashflowHighlightCellClass(meta?.highlight);
    return (
      <td
        key={idx}
        className={weekCellClass(idx, cn(extraTdClass, highlightClass), compact)}
      >
        <CashflowCommentCell
          meta={meta}
          compact={compact}
          historyUrl={cashflowCommentHistoryUrl(wYear, week, rowKey)}
          onSave={(payload) => saveCellMeta(rowKey, wYear, week, payload)}
        >
          {content}
        </CashflowCommentCell>
      </td>
    );
  }

  // Месяц начинается над ISO-неделей, которая содержит его первое число.
  const visibleMonthGroups: { label: string; count: number }[] = [];
  const monthFormatter = new Intl.DateTimeFormat("ru-RU", { month: "short" });
  let activeMonthLabel: string | null = null;
  for (const wh of visibleWeeks) {
    const start = isoWeekStart(wh.year, wh.week);
    let label: string | null = null;
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      if (d.getDate() === 1) {
        label = `${monthFormatter.format(d)} ${d.getFullYear()}`;
        break;
      }
    }
    label = label ?? activeMonthLabel ?? `${monthFormatter.format(start)} ${start.getFullYear()}`;
    activeMonthLabel = label;
    const last = visibleMonthGroups[visibleMonthGroups.length - 1];
    if (last && last.label === label) last.count++;
    else visibleMonthGroups.push({ label, count: 1 });
  }

  function rowTotal(arr: number[]) { return arr.reduce((a, b) => a + b, 0); }

  // ─── Modal: Расхождение план/факт в ДП ────────────────────────
  const allProjectsForModal = [...externalProjects, ...internalProjects];

  function getDiscrepancyProjectsForWeek(weekIdx: number) {
    return allProjectsForModal
      .map(p => {
        const paid = (p.iwPaid ?? [])[weekIdx] ?? 0;
        const plan = p.plan[weekIdx] ?? 0;
        const diff = paid - plan;
        return { id: p.id, name: p.name, paid, plan, diff };
      })
      .filter(r => Math.round(r.diff) !== 0)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  }

  const modalProjects = discrepancyModal !== null
    ? getDiscrepancyProjectsForWeek(discrepancyModal.weekIdx)
    : [];

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Кэшфлоу проектов</h1>
          {comparison.activeSource !== "live" && (
            <p className="text-xs text-neutral-500">Исторический снимок · только чтение</p>
          )}
        </div>
        <CashflowRangePicker range={range} onChange={setRange} />
      </div>

      {/* Tab bar */}
      <div className="shrink-0 border-b border-neutral-200">
        <nav className="flex gap-0">
          {(["table", "chart"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-neutral-500 hover:text-neutral-800 hover:border-neutral-300"
              }`}
            >
              {tab === "table" ? "Таблица" : "График"}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "chart" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <CashflowChart
            weeks={weeks}
            manualBalance={summary.manualBalance}
            balanceEndDP={summary.balanceEndDP}
            balanceEndBudget={summary.balanceEndBudget}
            projects={chartProjects}
            currentISOWeek={currentISOWeek}
            currentISOYear={currentISOYear}
            range={range}
          />
        </div>
      )}

      {activeTab === "table" && (
      <div className="flex flex-col flex-1 min-h-0 rounded-lg border border-neutral-200 bg-white overflow-hidden">
        {oldWeeksCount > 0 && (
          <div className="shrink-0 px-3 pt-2 pb-0">
            <button
              className="text-xs text-neutral-400 hover:text-neutral-700 hover:underline underline-offset-2"
              onClick={() => setShowOldWeeks((v) => !v)}
            >
              {showOldWeeks
                ? "Скрыть прошлые недели"
                : `Показать ${oldWeeksCount} прошлых недель`}
            </button>
          </div>
        )}
        <div ref={tableScrollRef} className="flex-1 min-h-0 overflow-auto">
          <table className="min-w-max border-collapse text-sm">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-100">
                <th className={cn(compactLbl, "z-30 font-medium text-neutral-600 bg-neutral-50 py-0.5")}>
                  Показатель / Проект
                </th>
                <th rowSpan={2} className={stickyTotalHdr}>Итого</th>
                {visibleMonthGroups.map((mg, i) => (
                  <th key={i} colSpan={mg.count} className={cn(thCls, "bg-neutral-50 text-left")}>
                    {mg.label}
                  </th>
                ))}
              </tr>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className={cn(stickyLbl, "z-30 text-left font-semibold text-neutral-600 bg-neutral-50")}>
                  Неделя
                </th>
                {visibleWeeks.map((wh, vi) => {
                  const realIdx = visibleWeekIndices[vi]!;
                  return (
                    <th key={`${wh.year}-${wh.week}`} className={cn(
                      thCls,
                      isCurrent(realIdx) ? "!bg-blue-50 font-semibold text-neutral-900" : isPast(realIdx) ? "text-neutral-400 bg-neutral-50/30" : "bg-neutral-50"
                    )}>
                      {wh.week}
                      <span className="block text-[9px] font-normal leading-none text-neutral-400">{wh.year}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <td className={compactHdr}>Сводка</td>
                <td className={cn(stickyTotal, "bg-neutral-50")} />
                <td colSpan={visibleWeeks.length} className="bg-neutral-50 py-0" />
              </tr>

              {/* Основные строки из SUMMARY_DEFS (до balanceEndDP включительно) */}
              {SUMMARY_DEFS.slice(0, 6).map(def => {
                const arr = summary[def.key];
                const total = rowTotal(arr);
                const valueCls = def.balanceStartRow ? "italic" : undefined;
                return (
                  <tr
                    key={def.key}
                    className={cn(
                      def.borderAfter ? ROW_BORDER_STRONG : ROW_BORDER,
                      "hover:bg-neutral-50",
                      def.highlight ? "bg-neutral-50/50" : ""
                    )}
                  >
                    <td
                      className={cn(
                        compactLbl,
                        def.labelAlign === "center"
                          ? "text-center"
                          : def.labelAlign === "left" || def.balanceStartRow
                            ? "text-left"
                            : "text-right",
                        def.balanceStartRow && "font-normal italic text-neutral-600",
                        def.highlight ? "font-medium bg-neutral-50 text-neutral-800" : "font-normal italic text-neutral-500"
                      )}
                    >
                      <RowLabelTooltip label={def.label} tooltip={ROW_TOOLTIPS[def.key]} />
                    </td>
                    <td className={cn(stickyTotal, valueCls, def.highlight && "font-medium")}>
                      {def.key === "balanceStart" ? fmt(summary.balanceStart[0] ?? 0) : ("signed" in def && def.signed ? fmtSign(total) : fmt(total))}
                    </td>
                    {visibleWeekIndices.map((idx) => {
                      // Первая неделя строки «Баланс на начало» — редактируемый input
                      if (def.key === "balanceStart" && weeks[idx]?.week === 1) {
                        const week = weeks[idx]?.week;
                        const wYear = weeks[idx]?.year ?? 0;
                        if (week == null) return null;
                        const meta = getCellMeta(`summary:${def.key}`, wYear, week);
                        const highlightClass = cashflowHighlightCellClass(meta?.highlight);
                        return (
                          <td key={idx} className={weekCellClass(idx, cn(highlightClass), true)}>
                            <CashflowCommentCell
                              meta={meta}
                              compact
                              historyUrl={cashflowCommentHistoryUrl(wYear, week, `summary:${def.key}`)}
                              onSave={(payload) => saveCellMeta(`summary:${def.key}`, wYear, week, payload)}
                            >
                              {comparison.readOnly ? (
                                <span className="italic">{fmt(summary.balanceStart[idx] ?? 0)}</span>
                              ) : (
                                <OpeningBalanceInput
                                  key={`${wYear}:${data.openingBalances[wYear] ?? 0}`}
                                  year={wYear}
                                  initial={data.openingBalances[wYear] ?? 0}
                                  onSaved={() => { mutate(); }}
                                  compact
                                />
                              )}
                            </CashflowCommentCell>
                          </td>
                        );
                      }
                      return renderWeekCell(
                        `summary:${def.key}`,
                        idx,
                        <span className={valueCls}>
                          {"signed" in def && def.signed ? fmtSign(arr[idx] ?? 0) : fmt(arr[idx] ?? 0)}
                        </span>,
                        cn(valueCls, def.highlight && "font-medium"),
                        true
                      );
                    })}
                  </tr>
                );
              })}

              {/* Ручной баланс недели задаёт входящий баланс ДП следующей недели */}
              <tr className={cn(ROW_BORDER_STRONG, "hover:bg-neutral-50")}>
                <td className={cn(compactLbl, "text-right font-normal italic text-neutral-500")}>
                  <RowLabelTooltip label="Баланс руками" tooltip={ROW_TOOLTIPS.manualBalance} />
                </td>
                <td className={stickyTotal}>—</td>
                {visibleWeekIndices.map((idx) => {
                  const week = weeks[idx]?.week;
                  const wYear = weeks[idx]?.year ?? 0;
                  if (week == null) return null;
                  const value = summary.manualBalance[idx] ?? null;
                  const rowKey = "summary:manualBalance";
                  const meta = getCellMeta(rowKey, wYear, week);
                  const highlightClass = cashflowHighlightCellClass(meta?.highlight);
                  return (
                    <td key={idx} className={weekCellClass(idx, highlightClass, true)}>
                      <CashflowCommentCell
                        meta={meta}
                        compact
                        historyUrl={cashflowCommentHistoryUrl(wYear, week, rowKey)}
                        onSave={(payload) => saveCellMeta(rowKey, wYear, week, payload)}
                      >
                        {comparison.readOnly ? (
                          <span>{fmtManualBalance(value)}</span>
                        ) : (
                          <ManualBalanceInput
                            key={`${wYear}:${week}:${value ?? "null"}`}
                            year={wYear}
                            week={week}
                            initial={value}
                            onSaved={async () => {
                              await mutate();
                            }}
                          />
                        )}
                      </CashflowCommentCell>
                    </td>
                  );
                })}
              </tr>

              {/* Баланс на счетах (из DB) */}
              <tr className={cn(ROW_BORDER, "hover:bg-neutral-50")}>
                <td className={cn(compactLbl, "text-right font-normal italic text-neutral-500")}>
                  <RowLabelTooltip label="Баланс на счетах" tooltip={ROW_TOOLTIPS.balanceInAccounts} />
                </td>
                <td className={cn(stickyTotal)}>
                  {fmtNullable(
                    balanceInAccounts.reduce<number | null>((sum, v) => {
                      if (v === null) return sum;
                      return (sum ?? 0) + v;
                    }, null)
                  )}
                </td>
                {visibleWeekIndices.map((idx) => {
                  const val = balanceInAccounts[idx] ?? null;
                  const week = weeks[idx]?.week;
                  const wYear = weeks[idx]?.year ?? 0;
                  if (week == null) return null;
                  const meta = getCellMeta("summary:balanceInAccounts", wYear, week);
                  const highlightClass = cashflowHighlightCellClass(meta?.highlight);
                  return (
                    <td key={idx} className={weekCellClass(idx, cn(highlightClass), true)}>
                      <CashflowCommentCell
                        meta={meta}
                        compact
                        historyUrl={cashflowCommentHistoryUrl(wYear, week, "summary:balanceInAccounts")}
                        onSave={(payload) => saveCellMeta("summary:balanceInAccounts", wYear, week, payload)}
                      >
                        {fmtNullable(val)}
                      </CashflowCommentCell>
                    </td>
                  );
                })}
              </tr>

              {/* Несхождение = Баланс (сметы/ДП) − Баланс на счетах */}
              <tr className={cn(ROW_BORDER_STRONG, "hover:bg-neutral-50")}>
                <td className={cn(compactLbl, "text-right font-normal italic text-neutral-500")}>
                  <RowLabelTooltip label="Несхождение" tooltip={ROW_TOOLTIPS.discrepancy} />
                </td>
                <td className={cn(stickyTotal)}>
                  {fmtNullable(
                    discrepancy.reduce<number | null>((sum, v) => {
                      if (v === null) return sum;
                      return (sum ?? 0) + v;
                    }, null)
                  )}
                </td>
                {visibleWeekIndices.map((idx) => {
                  const val = discrepancy[idx] ?? null;
                  const week = weeks[idx]?.week;
                  const wYear = weeks[idx]?.year ?? 0;
                  if (week == null) return null;
                  const isNonZero = val !== null && Math.round(val) !== 0;
                  const meta = getCellMeta("summary:discrepancy", wYear, week);
                  const highlightClass = cashflowHighlightCellClass(meta?.highlight);
                  return (
                    <td key={idx} className={weekCellClass(idx, cn(isNonZero && "bg-red-50", highlightClass), true)}>
                      <CashflowCommentCell
                        meta={meta}
                        compact
                        historyUrl={cashflowCommentHistoryUrl(wYear, week, "summary:discrepancy")}
                        onSave={(payload) => saveCellMeta("summary:discrepancy", wYear, week, payload)}
                      >
                        <span className={cn(isNonZero && "text-red-600 font-medium")}>
                          {fmtNullable(val)}
                        </span>
                      </CashflowCommentCell>
                    </td>
                  );
                })}
              </tr>

              {/* paidFromBudget, unpaidFromBudget */}
              {SUMMARY_DEFS.slice(6).map(def => {
                const arr = summary[def.key];
                const total = rowTotal(arr);
                const valueCls = def.balanceStartRow ? "italic" : undefined;
                return (
                  <tr
                    key={def.key}
                    className={cn(
                      def.borderAfter ? ROW_BORDER_STRONG : ROW_BORDER,
                      "hover:bg-neutral-50",
                      def.highlight ? "bg-neutral-50/50" : ""
                    )}
                  >
                    <td
                      className={cn(
                        compactLbl,
                        def.labelAlign === "center"
                          ? "text-center"
                          : def.labelAlign === "left" || def.balanceStartRow
                            ? "text-left"
                            : "text-right",
                        def.balanceStartRow && "font-normal italic text-neutral-600",
                        def.highlight ? "font-medium bg-neutral-50 text-neutral-800" : "font-normal italic text-neutral-500"
                      )}
                    >
                      <RowLabelTooltip label={def.label} tooltip={ROW_TOOLTIPS[def.key]} />
                    </td>
                    <td className={cn(stickyTotal, valueCls, def.highlight && "font-medium")}>
                      {"signed" in def && def.signed ? fmtSign(total) : fmt(total)}
                    </td>
                    {visibleWeekIndices.map((idx) =>
                      renderWeekCell(
                        `summary:${def.key}`,
                        idx,
                        <span className={valueCls}>
                          {"signed" in def && def.signed ? fmtSign(arr[idx] ?? 0) : fmt(arr[idx] ?? 0)}
                        </span>,
                        cn(valueCls, def.highlight && "font-medium"),
                        true
                      )
                    )}
                  </tr>
                );
              })}

              {/* Несхождение план и факт в ДП = iwPaid − planTotal */}
              <tr className={cn(ROW_BORDER_STRONG, "hover:bg-neutral-50")}>
                <td className={cn(compactLbl, "text-right font-normal italic text-neutral-500")}>
                  <RowLabelTooltip label="Несхождение план и факт в ДП" tooltip={ROW_TOOLTIPS.discrepancyDPFact} />
                </td>
                <td className={cn(stickyTotal)}>
                  {fmtSign(rowTotal(discrepancyDPFact))}
                </td>
                {visibleWeekIndices.map((idx) => {
                  const val = discrepancyDPFact[idx] ?? 0;
                  const isNonZero = Math.round(val) !== 0;
                  const week = weeks[idx]?.week;
                  const wYear = weeks[idx]?.year ?? 0;
                  if (week == null) return null;
                  const meta = getCellMeta("summary:discrepancyDPFact", wYear, week);
                  const highlightClass = cashflowHighlightCellClass(meta?.highlight);
                  return (
                    <td key={idx} className={weekCellClass(idx, cn(isNonZero && "bg-red-50", highlightClass), true)}>
                      <CashflowCommentCell
                        meta={meta}
                        compact
                        historyUrl={cashflowCommentHistoryUrl(wYear, week, "summary:discrepancyDPFact")}
                        onSave={(payload) => saveCellMeta("summary:discrepancyDPFact", wYear, week, payload)}
                      >
                        <button
                          type="button"
                          className={cn(
                            "w-full text-right tabular-nums",
                            isNonZero ? "text-red-600 font-medium hover:underline cursor-pointer" : "cursor-default"
                          )}
                          disabled={!isNonZero}
                          onClick={isNonZero ? () => setDiscrepancyModal({ weekIdx: idx, week, year: wYear }) : undefined}
                        >
                          {fmtSign(val)}
                        </button>
                      </CashflowCommentCell>
                    </td>
                  );
                })}
              </tr>

              {/* Aggregate rows */}
              {aggregates && AGGREGATE_DEFS.map(def => {
                const arr = aggregates[def.key];
                const total = rowTotal(arr);
                return (
                  <tr key={`agg-${def.key}`} className="border-b border-neutral-100 hover:bg-neutral-50">
                    <td
                      className={cn(
                        compactLbl,
                        "text-right",
                        def.bold ? "font-medium bg-neutral-50 text-neutral-800" : "font-normal italic text-neutral-500"
                      )}
                    >
                      {def.label}
                    </td>
                    <td className={cn(stickyTotal, def.bold ? "font-medium" : "")}>
                      {fmt(total)}
                    </td>
                    {visibleWeekIndices.map((idx) =>
                      renderWeekCell(
                        `aggregate:${def.key}`,
                        idx,
                        fmt(arr[idx] ?? 0),
                        def.bold ? "font-medium" : "",
                        true
                      )
                    )}
                  </tr>
                );
              })}

              {/* Helper: render project block with external/internal separator */}
              {(["plan", "iw", "charges"] as const).map((blockKey) => {
                const blockLabels = {
                  plan: "План расходов из дашбордов проектов",
                  iw: "План-факт расходов из работ",
                  charges: "План доходов",
                };
                const extProjects = externalProjects;
                const intProjects = internalProjects;
                const allInBlock = [...extProjects, ...intProjects];
                const hasInternal = intProjects.length > 0;

                return (
                  <React.Fragment key={blockKey}>
                    <tr aria-hidden><td colSpan={visibleWeeks.length + 2} className="h-1 bg-neutral-50/60 p-0 border-0" /></tr>
                    <tr className="bg-neutral-50 border-t-2 border-b border-neutral-200">
                      <td className={stickyHdr} title={blockLabels[blockKey]}>
                        <span className="block truncate">{blockLabels[blockKey]}</span>
                      </td>
                      <td className={cn(stickyTotal, "bg-neutral-50")} />
                      <td colSpan={visibleWeeks.length} className="bg-neutral-50" />
                    </tr>
                    {extProjects.map(p => {
                      const arr = blockKey === "plan" ? p.plan : blockKey === "iw" ? p.iw : p.charges;
                      return (
                        <tr key={`${blockKey}-${p.id}`} className="border-b border-neutral-100 hover:bg-neutral-50">
                          <td className={cn(stickyLbl, "font-normal")} title={p.name}>
                            <Link
                              href={`/admin/projects/${p.id}`}
                              className="block truncate hover:text-blue-600 hover:underline"
                            >
                              {p.name}
                            </Link>
                          </td>
                          <td className={cn(stickyTotal, "font-medium")}>
                            {fmt(rowTotal(arr))}
                          </td>
                          {visibleWeekIndices.map((idx) =>
                            renderWeekCell(
                              `project:${p.id}:${blockKey}`,
                              idx,
                              fmt(arr[idx] ?? 0)
                            )
                          )}
                        </tr>
                      );
                    })}
                    {hasInternal && (
                      <tr>
                        <td colSpan={visibleWeeks.length + 2} className="border-t-2 border-neutral-300 bg-neutral-100 h-0.5 p-0" />
                      </tr>
                    )}
                    {intProjects.map(p => {
                      const arr = blockKey === "plan" ? p.plan : blockKey === "iw" ? p.iw : p.charges;
                      return (
                        <tr key={`${blockKey}-${p.id}`} className="border-b border-neutral-100 hover:bg-neutral-50">
                          <td className={cn(stickyLbl, "font-normal text-neutral-500")} title={p.name}>
                            <Link
                              href={`/admin/projects/${p.id}`}
                              className="block truncate hover:text-blue-600 hover:underline"
                            >
                              {p.name}
                            </Link>
                          </td>
                          <td className={cn(stickyTotal, "font-medium text-neutral-500")}>
                            {fmt(rowTotal(arr))}
                          </td>
                          {visibleWeekIndices.map((idx) =>
                            renderWeekCell(
                              `project:${p.id}:${blockKey}`,
                              idx,
                              fmt(arr[idx] ?? 0),
                              "text-neutral-500"
                            )
                          )}
                        </tr>
                      );
                    })}
                    {allInBlock.length === 0 && (
                      <tr><td colSpan={visibleWeeks.length + 2} className={cn(stickyLbl, "text-neutral-400 font-normal")}>Нет данных</td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Модал: расхождение план/факт в ДП по проектам */}
      <Dialog open={discrepancyModal !== null} onOpenChange={(open) => !open && setDiscrepancyModal(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Несхождение план и факт в ДП — Неделя {discrepancyModal?.week} {discrepancyModal?.year}
            </DialogTitle>
          </DialogHeader>
          {modalProjects.length === 0 ? (
            <p className="text-sm text-neutral-500 py-4 text-center">Нет расхождений</p>
          ) : (
            <table className="w-full text-xs mt-2">
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-500">
                  <th className="text-left py-1.5 font-medium">Проект</th>
                  <th className="text-right py-1.5 font-medium pr-2">Оплачено</th>
                  <th className="text-right py-1.5 font-medium pr-2">План</th>
                  <th className="text-right py-1.5 font-medium">Разница</th>
                </tr>
              </thead>
              <tbody>
                {modalProjects.map(p => (
                  <tr key={p.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                    <td className="py-1.5">
                      <Link
                        href={`/admin/projects/${p.id}`}
                        className="text-blue-600 hover:underline truncate block max-w-[200px]"
                        title={p.name}
                        onClick={() => setDiscrepancyModal(null)}
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td className="text-right py-1.5 pr-2 tabular-nums">
                      {fmt(p.paid)}
                    </td>
                    <td className="text-right py-1.5 pr-2 tabular-nums">
                      {fmt(p.plan)}
                    </td>
                    <td className={cn(
                      "text-right py-1.5 tabular-nums font-medium",
                      p.diff > 0 ? "text-red-600" : "text-green-600"
                    )}>
                      {p.diff > 0 ? "+" : ""}{fmtSign(p.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
