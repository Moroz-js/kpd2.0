"use client";

import * as React from "react";
import useSWR from "swr";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useComparison } from "@/components/ComparisonProvider";
import { ALL_PROJECTS, cashflowChartRequest, isCashflowId, type CashflowView } from "./cashflow-view";
import { fetchCashflowJson } from "./cashflow-fetch";
import { isoWeekStart, toLocalDateString } from "@/lib/iso-weeks";
import { snapshotLabel, type SnapshotOption } from "@/lib/snapshots/labels";

type WeekHeader = { week: number; month: number; monthName: string; year: number };
type ProjectRow = {
  id: string;
  name: string;
  cashflow: number[];
  budgetCashflow?: number[];
};
type Props = {
  view: CashflowView;
  update: (patch: Partial<CashflowView>) => void;
  currentISOWeek: number;
  currentISOYear: number;
};
type ChartSeries = {
  source: { id: string; businessDate?: string | null; cutoffAt?: string | null };
  data: {
    weeks: WeekHeader[];
    balanceEndDP: number[];
    balanceEndBudget: number[];
    projects: ProjectRow[];
  };
};
type ChartResponse = { seriesA: ChartSeries; seriesB: ChartSeries | null };

const COLORS = { dp: "#2563eb", budget: "#d97706" } as const;

function fmt(value: number) {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "−" : "";
  const absolute = Math.abs(rounded);
  if (absolute >= 1_000_000) return `${sign}${(absolute / 1_000_000).toFixed(1)}М`;
  if (absolute >= 1_000) return `${sign}${(absolute / 1_000).toFixed(0)}К`;
  return `${rounded}`;
}

function chartNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number | null }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const values = Object.fromEntries(payload.map((entry) => [String(entry.dataKey), entry.value ?? null]));
  const groups = [
    { label: "Баланс из ДП", a: values.dpA, b: values.dpB },
    { label: "Баланс из смет", a: values.budgetA, b: values.budgetB },
  ];
  return (
    <div className="min-w-56 rounded-md border bg-white p-3 text-xs shadow-lg">
      <p className="mb-2 font-semibold text-neutral-800">Неделя {label}</p>
      {groups.filter((group) => group.a !== undefined || group.b !== undefined).map((group) => (
        <div key={group.label} className="mb-2 last:mb-0">
          <p className="font-medium text-neutral-700">{group.label}</p>
          <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-neutral-600">
            <span>A</span><span className="text-right tabular-nums">{group.a == null ? "—" : fmt(Number(group.a))}</span>
            {group.b !== undefined && (
              <>
                <span>B</span><span className="text-right tabular-nums">{group.b == null ? "—" : fmt(Number(group.b))}</span>
                <span>Δ</span>
                <span className="text-right font-medium tabular-nums">
                  {group.a == null || group.b == null ? "—" : fmt(Number(group.b) - Number(group.a))}
                </span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CashflowChart({ view, update, currentISOWeek, currentISOYear }: Props) {
  const { mode, projectId, showDP, showBudget, showFromStart } = view;
  const comparison = useComparison();
  const catalog = useSWR<{ snapshots: SnapshotOption[] }>("/api/cashflow/snapshots", fetchCashflowJson);
  const snapshots = catalog.data?.snapshots;
  const request = cashflowChartRequest(view, comparison.panel ? comparison.activeSource : null, snapshots);
  const { sourceA, sourceB } = request;
  const chart = useSWR<ChartResponse>(request.url, fetchCashflowJson, { keepPreviousData: false });
  const remote = request.url && !chart.error ? chart.data : null;
  const matches = remote?.seriesA?.source.id === sourceA && (remote.seriesB?.source.id ?? null) === sourceB;
  const seriesA = matches ? remote.seriesA : null;
  const seriesB = matches ? remote.seriesB : null;
  const allProjects = React.useMemo(() => {
    const values = [...(seriesA?.data.projects ?? []), ...(seriesB?.data.projects ?? [])];
    return [...new Map(values.map((project) => [project.id, project])).values()].sort((a, b) =>
      a.name.localeCompare(b.name, "ru")
    );
  }, [seriesA, seriesB]);
  const selectedProject = allProjects.find((item) => item.id === projectId);
  const missingProject = seriesA && projectId !== ALL_PROJECTS && !selectedProject;
  const displayError = request.error ?? chart.error?.message ?? (
    remote && !matches ? "Нет данных для выбранных источников" :
    missingProject ? "Проект недоступен для выбранного периода и источников" : null
  );

  function sourceOptions(selected: string, blocked?: string) {
    return [
      { value: "live", label: "Актуальные данные", disabled: blocked === "live" },
      ...(selected !== "live" && !snapshots?.some((s) => s.id === selected) ? [{
        value: selected, disabled: true,
        label: snapshots || catalog.error || !isCashflowId(selected) ? "Снимок недоступен" : "Загрузка снимка…",
      }] : []),
      ...(snapshots?.map((s) => ({ value: s.id, label: snapshotLabel(s), disabled: s.id === blocked })) ?? []),
    ];
  }

  function enterComparison() {
    // Choose an alternative only on a user action, never when an async list arrives or on Back.
    const alternative = sourceA === "live" ? snapshots?.[0]?.id : "live";
    update({ mode: "compare", sourceB: view.sourceB === sourceA ? alternative ?? view.sourceB : view.sourceB });
  }

  const valuesFor = (series: ChartSeries, kind: "dp" | "budget") => {
    if (projectId === ALL_PROJECTS) {
      return kind === "dp" ? series.data.balanceEndDP : series.data.balanceEndBudget;
    }
    const project = series.data.projects.find((item) => item.id === projectId);
    return kind === "dp" ? project?.cashflow ?? [] : project?.budgetCashflow ?? [];
  };
  const weekKey = (week: WeekHeader) => `${week.year}-${week.week}`;
  const weekStartKey = (week: WeekHeader) => toLocalDateString(isoWeekStart(week.year, week.week));
  const cutoffDate = isoWeekStart(currentISOYear, currentISOWeek);
  cutoffDate.setDate(cutoffDate.getDate() - 3 * 7);
  const cutoffKey = toLocalDateString(cutoffDate);
  const comparisonWeeks = React.useMemo(() => {
    const values = [...(seriesA?.data.weeks ?? []), ...(seriesB?.data.weeks ?? [])];
    return [...new Map(values.map((week) => [`${week.year}-${week.week}`, week])).values()].sort(
      (a, b) => a.year - b.year || a.week - b.week
    );
  }, [seriesA, seriesB]);
  const hasOldWeeks = comparisonWeeks.some((week) => weekStartKey(week) < cutoffKey);
  const visibleWeeks = comparisonWeeks.filter(
    (week) => showFromStart || weekStartKey(week) >= cutoffKey
  );
  const barData = visibleWeeks.map((week) => {
    const indexA = seriesA?.data.weeks.findIndex((item) => weekKey(item) === weekKey(week)) ?? -1;
    const indexB = seriesB?.data.weeks.findIndex((item) => weekKey(item) === weekKey(week)) ?? -1;
    return {
      label: `${week.week}/${String(week.year).slice(2)}`,
      week: week.week,
      dpA: seriesA && indexA >= 0 ? chartNumber(valuesFor(seriesA, "dp")[indexA]) : null,
      dpB: seriesB && indexB >= 0 ? chartNumber(valuesFor(seriesB, "dp")[indexB]) : null,
      budgetA: seriesA && indexA >= 0 ? chartNumber(valuesFor(seriesA, "budget")[indexA]) : null,
      budgetB: seriesB && indexB >= 0 ? chartNumber(valuesFor(seriesB, "budget")[indexB]) : null,
    };
  });

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-800">
            {selectedProject?.name ?? "Динамика баланса"}
          </h2>
          <p className="mt-0.5 text-xs text-neutral-400">Значения на конец недели</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!comparison.panel && (
            <div className="flex rounded-md border p-0.5">
              <Button type="button" size="sm" variant={mode === "single" ? "secondary" : "ghost"} className="h-7 text-xs" onClick={() => update({ mode: "single" })}>
                Одна дата
              </Button>
              <Button type="button" size="sm" variant={mode === "compare" ? "secondary" : "ghost"} className="h-7 text-xs" onClick={enterComparison}>
                Сравнение
              </Button>
            </div>
          )}
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-xs font-medium text-neutral-600">Дата A</span>
            <SearchableSelect
              value={sourceA}
              disabled={comparison.panel !== null}
              onValueChange={(id) => {
                if (isCashflowId(id)) update({ sourceA: id, ...(sourceB === id ? { sourceB: sourceA } : {}) });
              }}
              options={sourceOptions(sourceA)}
              triggerClassName="h-8 w-52 text-xs"
            />
          </div>
          {sourceB !== null && (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-xs font-medium text-neutral-600">Дата B</span>
              <SearchableSelect
                value={sourceB}
                onValueChange={(id) => { if (isCashflowId(id) && id !== sourceA) update({ sourceB: id }); }}
                options={sourceOptions(sourceB, sourceA)}
                triggerClassName="h-8 w-52 text-xs"
              />
            </div>
          )}
          <SearchableSelect
            value={projectId}
            onValueChange={(id) => { if (isCashflowId(id)) update({ projectId: id }); }}
            options={[
              { value: ALL_PROJECTS, label: "Все проекты" },
              ...(projectId !== ALL_PROJECTS && !selectedProject ? [{ value: projectId, disabled: true,
                label: seriesA || displayError ? "Проект недоступен" : "Загрузка проекта…" }] : []),
              ...allProjects.map((project) => ({ value: project.id, label: project.name })),
            ]}
            triggerClassName="h-8 w-56 text-xs"
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-neutral-600">
        <label className="flex items-center gap-1.5"><Checkbox checked={showDP} onCheckedChange={(value) => update({ showDP: value === true })} />Баланс из ДП</label>
        <label className="flex items-center gap-1.5"><Checkbox checked={showBudget} onCheckedChange={(value) => update({ showBudget: value === true })} />Баланс из смет</label>
        {hasOldWeeks && (
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => update({ showFromStart: !showFromStart })}>
            {showFromStart ? "Свернуть" : "Показать с начала"}
          </Button>
        )}
        <span className="ml-auto inline-flex items-center gap-3 text-neutral-500">
          {showDP && <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-blue-600" />ДП</span>}
          {showBudget && <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-amber-600" />Сметы</span>}
          {seriesB && <span>A — сплошная, B — штриховка</span>}
        </span>
      </div>

      {catalog.error && <p role="alert" className="mb-2 text-xs text-red-700">
        Не удалось загрузить список снимков. <button className="underline" type="button" onClick={() => void catalog.mutate()}>Повторить</button>
      </p>}
      {displayError ? (
        <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {displayError}{chart.error && <button type="button" className="ml-2 underline" onClick={() => void chart.mutate()}>Повторить</button>}
        </div>
      ) : !seriesA ? (
        !catalog.error && <p role="status" className="text-sm text-neutral-500">Загрузка графика…</p>
      ) : !showDP && !showBudget ? (
        <p className="text-sm text-neutral-500">Выберите хотя бы один ряд баланса.</p>
      ) : (
      <ResponsiveContainer width="100%" height={390}>
        <BarChart data={barData} barGap={2} margin={{ top: 24, right: 20, left: 20, bottom: 8 }}>
          <defs>
            <pattern id="dp-b-pattern" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#ffffff" />
              <rect width="3" height="6" fill={COLORS.dp} fillOpacity="0.55" />
            </pattern>
            <pattern id="budget-b-pattern" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#ffffff" />
              <rect width="3" height="6" fill={COLORS.budget} fillOpacity="0.55" />
            </pattern>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <ReferenceLine y={0} stroke="#737373" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#737373" }} interval={0} />
          <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: "#737373" }} width={58} />
          <RechartsTooltip content={<ChartTooltip />} />
          {showDP && <Bar dataKey="dpA" name="ДП A" fill={COLORS.dp} radius={[2, 2, 0, 0]}><LabelList dataKey="week" position="top" className="fill-neutral-500 text-[10px]" /></Bar>}
          {showDP && seriesB && <Bar dataKey="dpB" name="ДП B" fill="url(#dp-b-pattern)" stroke={COLORS.dp} radius={[2, 2, 0, 0]} />}
          {showBudget && <Bar dataKey="budgetA" name="Сметы A" fill={COLORS.budget} radius={[2, 2, 0, 0]} />}
          {showBudget && seriesB && <Bar dataKey="budgetB" name="Сметы B" fill="url(#budget-b-pattern)" stroke={COLORS.budget} radius={[2, 2, 0, 0]} />}
        </BarChart>
      </ResponsiveContainer>
      )}
    </div>
  );
}
