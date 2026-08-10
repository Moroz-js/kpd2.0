"use client";

import * as React from "react";
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
import {
  snapshotLabel,
  snapshotSourceLabel,
  type SnapshotOption,
} from "@/lib/snapshots/labels";

type WeekHeader = { week: number; month: number; monthName: string };
type ProjectRow = {
  id: string;
  name: string;
  plan: number[];
  charges: number[];
  cashflow: number[];
  budgetCashflow?: number[];
  iw: number[];
};
type Props = {
  weeks: WeekHeader[];
  manualBalance: (number | null)[];
  balanceEndDP: number[];
  balanceEndBudget: number[];
  projects: ProjectRow[];
  currentISOWeek: number;
  currentISOYear: number;
  year: number;
};
type ChartSeries = {
  source: { id: string; businessDate?: string | null; cutoffAt?: string | null };
  data: {
    weeks: WeekHeader[];
    manualBalance: (number | null)[];
    balanceEndDP: number[];
    balanceEndBudget: number[];
    projects: ProjectRow[];
  };
};
type ChartResponse = { seriesA: ChartSeries; seriesB: ChartSeries | null; error?: string };

const ALL_PROJECTS = "_all";
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
      {groups.map((group) => (
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

export function CashflowChart({
  weeks,
  manualBalance,
  balanceEndDP,
  balanceEndBudget,
  projects,
  currentISOWeek,
  currentISOYear,
  year,
}: Props) {
  const globalComparison = useComparison();
  const [mode, setMode] = React.useState<"single" | "compare">("single");
  const [sourceA, setSourceA] = React.useState(globalComparison.activeSource);
  const [sourceB, setSourceB] = React.useState("live");
  const [snapshots, setSnapshots] = React.useState<SnapshotOption[]>([]);
  const [remote, setRemote] = React.useState<ChartResponse | null>(null);
  const [remoteError, setRemoteError] = React.useState("");
  const [projectId, setProjectId] = React.useState(ALL_PROJECTS);
  const [showDP, setShowDP] = React.useState(true);
  const [showBudget, setShowBudget] = React.useState(true);
  const [showFromStart, setShowFromStart] = React.useState(false);

  React.useEffect(() => {
    fetch(`/api/cashflow/snapshots?year=${year}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload: { snapshots?: SnapshotOption[] }) => {
        const options = payload.snapshots ?? [];
        setSnapshots(options);
        setSourceB((current) => current === sourceA ? options.find((item) => item.id !== sourceA)?.id ?? "live" : current);
      })
      .catch(() => setSnapshots([]));
  }, [year, sourceA]);

  React.useEffect(() => {
    const controller = new AbortController();
    const compare = mode === "compare" && !globalComparison.panel;
    if (compare && sourceA === sourceB) {
      return () => controller.abort();
    }
    const url = `/api/cashflow/chart?year=${year}&sourceA=${encodeURIComponent(sourceA)}${
      compare ? `&sourceB=${encodeURIComponent(sourceB)}` : ""
    }`;
    fetch(url, { signal: controller.signal })
      .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
      .then(({ ok, payload }) => {
        if (!ok) throw new Error((payload as { error?: string }).error ?? "Не удалось загрузить график");
        setRemote(payload as ChartResponse);
        setRemoteError("");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setRemote(null);
        setRemoteError(error instanceof Error ? error.message : "Не удалось загрузить график");
      });
    return () => controller.abort();
  }, [year, sourceA, sourceB, mode, globalComparison.panel]);

  const liveFallback: ChartSeries = {
    source: { id: "live" },
    data: { weeks, manualBalance, balanceEndDP, balanceEndBudget, projects },
  };
  const wantsComparison = mode === "compare" && !globalComparison.panel;
  const matchingRemote =
    remote?.seriesA.source.id === sourceA &&
    (!wantsComparison || remote.seriesB?.source.id === sourceB)
      ? remote
      : null;
  const seriesA = matchingRemote?.seriesA ?? liveFallback;
  const seriesB =
    wantsComparison && sourceA !== sourceB ? matchingRemote?.seriesB ?? null : null;
  const displayError =
    wantsComparison && sourceA === sourceB
      ? "Для сравнения выберите разные даты"
      : remoteError;
  const allProjects = React.useMemo(() => {
    const values = [...seriesA.data.projects, ...(seriesB?.data.projects ?? [])];
    return [...new Map(values.map((project) => [project.id, project])).values()].sort((a, b) =>
      a.name.localeCompare(b.name, "ru")
    );
  }, [seriesA, seriesB]);

  const valuesFor = (series: ChartSeries, kind: "dp" | "budget") => {
    if (projectId === ALL_PROJECTS) {
      return kind === "dp" ? series.data.balanceEndDP : series.data.balanceEndBudget;
    }
    const project = series.data.projects.find((item) => item.id === projectId);
    return kind === "dp" ? project?.cashflow ?? [] : project?.budgetCashflow ?? [];
  };
  const isCurrentYear = year === currentISOYear;
  const fromWeek = Math.max(1, currentISOWeek - 3);
  const comparisonWeeks = React.useMemo(() => {
    const values = [...seriesA.data.weeks, ...(seriesB?.data.weeks ?? [])];
    return [...new Map(values.map((week) => [week.week, week])).values()].sort(
      (a, b) => a.week - b.week
    );
  }, [seriesA, seriesB]);
  const visibleWeeks = comparisonWeeks.filter(
    (week) => !isCurrentYear || showFromStart || week.week >= fromWeek
  );
  const barData = visibleWeeks.map((week) => {
    const indexA = seriesA.data.weeks.findIndex((item) => item.week === week.week);
    const indexB = seriesB?.data.weeks.findIndex((item) => item.week === week.week) ?? -1;
    return {
      week: week.week,
      dpA: indexA >= 0 ? chartNumber(valuesFor(seriesA, "dp")[indexA]) : null,
      dpB: seriesB && indexB >= 0 ? chartNumber(valuesFor(seriesB, "dp")[indexB]) : null,
      budgetA: indexA >= 0 ? chartNumber(valuesFor(seriesA, "budget")[indexA]) : null,
      budgetB: seriesB && indexB >= 0 ? chartNumber(valuesFor(seriesB, "budget")[indexB]) : null,
    };
  });

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-800">
            {projectId === ALL_PROJECTS ? "Динамика баланса" : allProjects.find((item) => item.id === projectId)?.name}
          </h2>
          <p className="mt-0.5 text-xs text-neutral-400">Значения на конец недели</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!globalComparison.panel && (
            <div className="flex rounded-md border p-0.5">
              <Button type="button" size="sm" variant={mode === "single" ? "secondary" : "ghost"} className="h-7 text-xs" onClick={() => setMode("single")}>
                Одна дата
              </Button>
              <Button type="button" size="sm" variant={mode === "compare" ? "secondary" : "ghost"} className="h-7 text-xs" onClick={() => setMode("compare")}>
                Сравнение
              </Button>
            </div>
          )}
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-xs font-medium text-neutral-600">Дата A</span>
            <SearchableSelect
              value={sourceA}
              onValueChange={setSourceA}
              options={[
                { value: "live", label: "Актуальные данные" },
                ...(sourceA !== "live" && !snapshots.some((snapshot) => snapshot.id === sourceA)
                  ? [{ value: sourceA, label: snapshotSourceLabel(sourceA, snapshots), disabled: true }]
                  : []),
                ...snapshots.map((snapshot) => ({ value: snapshot.id, label: snapshotLabel(snapshot) })),
              ]}
              triggerClassName="h-8 w-52 text-xs"
            />
          </div>
          {mode === "compare" && !globalComparison.panel && (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-xs font-medium text-neutral-600">Дата B</span>
              <SearchableSelect
                value={sourceB}
                onValueChange={setSourceB}
                options={[
                  { value: "live", label: "Актуальные данные", disabled: sourceA === "live" },
                  ...(sourceB !== "live" && !snapshots.some((snapshot) => snapshot.id === sourceB)
                    ? [{ value: sourceB, label: snapshotSourceLabel(sourceB, snapshots), disabled: true }]
                    : []),
                  ...snapshots.map((snapshot) => ({
                    value: snapshot.id,
                    label: snapshotLabel(snapshot),
                    disabled: sourceA === snapshot.id,
                  })),
                ]}
                triggerClassName="h-8 w-52 text-xs"
              />
            </div>
          )}
          <SearchableSelect
            value={projectId}
            onValueChange={setProjectId}
            options={[
              { value: ALL_PROJECTS, label: "Все проекты" },
              ...allProjects.map((project) => ({ value: project.id, label: project.name })),
            ]}
            triggerClassName="h-8 w-56 text-xs"
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-neutral-600">
        <label className="flex items-center gap-1.5"><Checkbox checked={showDP} onCheckedChange={(value) => setShowDP(value === true)} />Баланс из ДП</label>
        <label className="flex items-center gap-1.5"><Checkbox checked={showBudget} onCheckedChange={(value) => setShowBudget(value === true)} />Баланс из смет</label>
        {isCurrentYear && (
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowFromStart((value) => !value)}>
            {showFromStart ? "Свернуть" : "Показать с начала"}
          </Button>
        )}
        <span className="ml-auto inline-flex items-center gap-3 text-neutral-500">
          <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-blue-600" />ДП</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-amber-600" />Сметы</span>
          {seriesB && <span>A — сплошная, B — штриховка</span>}
        </span>
      </div>

      {displayError && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {displayError}
        </div>
      )}

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
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#737373" }} interval={0} />
          <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: "#737373" }} width={58} />
          <RechartsTooltip content={<ChartTooltip />} />
          {showDP && <Bar dataKey="dpA" name="ДП A" fill={COLORS.dp} radius={[2, 2, 0, 0]}><LabelList dataKey="week" position="top" className="fill-neutral-500 text-[10px]" /></Bar>}
          {showDP && seriesB && <Bar dataKey="dpB" name="ДП B" fill="url(#dp-b-pattern)" stroke={COLORS.dp} radius={[2, 2, 0, 0]} />}
          {showBudget && <Bar dataKey="budgetA" name="Сметы A" fill={COLORS.budget} radius={[2, 2, 0, 0]} />}
          {showBudget && seriesB && <Bar dataKey="budgetB" name="Сметы B" fill="url(#budget-b-pattern)" stroke={COLORS.budget} radius={[2, 2, 0, 0]} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
