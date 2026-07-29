"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Columns2, DatabaseBackup, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { WORK_STATUSES, PAYMENT_STATUSES, ENTITY_STATUSES, CHARGE_STATUSES, TASK_STATUSES } from "@/lib/statuses";
import {
  snapshotLabel,
  snapshotSourceLabel,
  type SnapshotOption,
} from "@/lib/snapshots/labels";
import {
  fieldLabel,
  modelLabel,
  PREFERRED_FIELD_ORDER,
  HIDDEN_FIELDS,
  DATE_FIELDS,
  MONEY_FIELDS,
  RELATION_FIELD_MAP,
} from "@/lib/snapshots/field-labels";

type ComparisonContextValue = {
  enabled: boolean;
  readOnly: boolean;
  sourceA: string;
  sourceB: string;
  activeSource: string;
  onlyChanges: boolean;
  panel: "A" | "B" | null;
};

const ComparisonContext = React.createContext<ComparisonContextValue>({
  enabled: false,
  readOnly: false,
  sourceA: "live",
  sourceB: "live",
  activeSource: "live",
  onlyChanges: false,
  panel: null,
});

export function useComparison() {
  return React.useContext(ComparisonContext);
}

type DiffRow = {
  key: string;
  status: "added" | "removed" | "modified" | "unchanged";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changes: Array<{ field: string; before: unknown; after: unknown }>;
};

type RefMaps = Partial<Record<"executor" | "project" | "workType" | "bankAccount" | "client" | "user", Map<string, string>>>;

const STATUS_DICTS_BY_MODEL: Record<string, Record<string, { label: string }>> = {
  Work: WORK_STATUSES,
  OtherExpense: WORK_STATUSES,
  Payment: PAYMENT_STATUSES,
  Task: TASK_STATUSES,
  Charge: CHARGE_STATUSES,
  Order: ENTITY_STATUSES,
  Project: ENTITY_STATUSES,
  Executor: ENTITY_STATUSES,
  Client: ENTITY_STATUSES,
  WorkType: ENTITY_STATUSES,
  BankAccount: ENTITY_STATUSES,
};

const COMPARE_ROW_LIMIT = 200;

function mergeRefMap(
  target: Map<string, string>,
  rows: Array<{ id?: unknown; name?: unknown; fullName?: unknown; firstName?: unknown; lastName?: unknown }>
) {
  for (const row of rows) {
    if (row?.id == null) continue;
    const id = String(row.id);
    if (target.has(id)) continue;
    const fullName = row.fullName != null ? String(row.fullName).trim() : "";
    const name = row.name != null ? String(row.name).trim() : "";
    const composed = [row.lastName, row.firstName].filter(Boolean).map(String).join(" ").trim();
    const label = fullName || name || composed;
    if (label) target.set(id, label);
  }
}

function mapsFromDiff(diff: Record<string, DiffRow[]>): RefMaps {
  const pick = (model: string) =>
    (diff[model] ?? []).flatMap((row) => [row.before, row.after]).filter(Boolean) as Array<
      Record<string, unknown>
    >;
  const executor = new Map<string, string>();
  const project = new Map<string, string>();
  const workType = new Map<string, string>();
  const bankAccount = new Map<string, string>();
  const client = new Map<string, string>();
  const user = new Map<string, string>();
  mergeRefMap(executor, pick("Executor") as never);
  mergeRefMap(project, pick("Project") as never);
  mergeRefMap(workType, pick("WorkType") as never);
  mergeRefMap(bankAccount, pick("BankAccount") as never);
  mergeRefMap(client, pick("Client") as never);
  mergeRefMap(user, pick("User") as never);
  return { executor, project, workType, bankAccount, client, user };
}

function useReferenceMaps(diff: Record<string, DiffRow[]> | null) {
  const [liveMaps, setLiveMaps] = React.useState<RefMaps>({});
  React.useEffect(() => {
    let cancelled = false;
    const build = (rows: Array<{ id: string; name?: string; fullName?: string }>) =>
      new Map(rows.map((row) => [row.id, row.name ?? row.fullName ?? row.id]));
    Promise.all([
      fetch("/api/executors").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/projects/options").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/work-types").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/bank-accounts").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/clients").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/responsibles").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([executors, projects, workTypes, bankAccounts, clients, users]) => {
        if (cancelled) return;
        setLiveMaps({
          executor: build(Array.isArray(executors) ? executors : []),
          project: build(Array.isArray(projects) ? projects : []),
          workType: build(Array.isArray(workTypes) ? workTypes : []),
          bankAccount: build(Array.isArray(bankAccounts) ? bankAccounts : []),
          client: build(Array.isArray(clients) ? clients : []),
          user: build(Array.isArray(users) ? users : []),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return React.useMemo(() => {
    const fromDiff = diff ? mapsFromDiff(diff) : {};
    const merge = (key: keyof RefMaps) => {
      const map = new Map<string, string>();
      fromDiff[key]?.forEach((value, id) => map.set(id, value));
      liveMaps[key]?.forEach((value, id) => map.set(id, value));
      return map;
    };
    return {
      executor: merge("executor"),
      project: merge("project"),
      workType: merge("workType"),
      bankAccount: merge("bankAccount"),
      client: merge("client"),
      user: merge("user"),
    } satisfies RefMaps;
  }, [diff, liveMaps]);
}

function displayFieldValue(model: string, field: string, value: unknown, refMaps: RefMaps): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "object") return Array.isArray(value) ? `${value.length} эл.` : "…";

  if (field === "status") {
    const dict = STATUS_DICTS_BY_MODEL[model];
    const found = dict?.[String(value)]?.label;
    if (found) return found;
  }
  if (field === "workStatus") {
    const found = WORK_STATUSES[value as keyof typeof WORK_STATUSES]?.label;
    if (found) return found;
  }
  if (field === "paymentStatus") {
    const found = PAYMENT_STATUSES[value as keyof typeof PAYMENT_STATUSES]?.label;
    if (found) return found;
  }
  if (DATE_FIELDS.has(field)) return formatDate(String(value));
  if (MONEY_FIELDS.has(field)) return formatMoney(Number(value));

  const relation = RELATION_FIELD_MAP[field];
  if (relation) {
    const name = refMaps[relation]?.get(String(value));
    if (name) return name;
  }

  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

function relationHref(field: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  const id = String(value);
  if (field === "executorId" || field === "responsibleExecutorId") return `/admin/executors/${id}`;
  if (field === "projectId") return `/admin/projects/${id}`;
  return null;
}

function rowSortKey(row: DiffRow): string {
  const record = row.after ?? row.before;
  if (!record) return row.key;
  const number =
    record.issuedWorkNumber ??
    record.payoutNumber ??
    record.otherExpenseNumber ??
    record.name ??
    record.fullName ??
    record.title;
  return `${String(number ?? "")}\0${row.key}`;
}

function collectFields(rows: DiffRow[]): string[] {
  const fieldSet = new Set<string>();
  for (const row of rows) {
    for (const value of [row.before, row.after]) {
      Object.keys(value ?? {}).forEach((field) => {
        if (!HIDDEN_FIELDS.has(field)) fieldSet.add(field);
      });
    }
  }
  return [...fieldSet]
    .sort((a, b) => {
      const ai = PREFERRED_FIELD_ORDER.indexOf(a);
      const bi = PREFERRED_FIELD_ORDER.indexOf(b);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.localeCompare(b);
    })
    .slice(0, 10);
}

function ComparisonSideCells({
  model,
  row,
  side,
  fields,
  refMaps,
}: {
  model: string;
  row: DiffRow;
  side: "A" | "B";
  fields: string[];
  refMaps: RefMaps;
}) {
  const value = side === "A" ? row.before : row.after;
  const changed = new Set(row.changes.map((change) => change.field));
  const marker =
    row.status === "added" ? "+" : row.status === "removed" ? "−" : row.status === "modified" ? "●" : "";
  const paneEdge = side === "A" ? "border-r border-neutral-200" : "";

  return (
    <>
      <td
        className={cn(
          "px-2 py-1.5 text-center font-bold",
          row.status === "added" ? "text-green-600" : row.status === "removed" ? "text-red-600" : "text-amber-600",
          !value && "text-neutral-300",
          side === "A" && fields.length === 0 && "border-r-2 border-neutral-300"
        )}
      >
        {value ? marker : "·"}
      </td>
      {fields.map((field, index) => {
        const raw = value?.[field];
        const label = value ? displayFieldValue(model, field, raw, refMaps) : "—";
        const href = value ? relationHref(field, raw) : null;
        const isLast = index === fields.length - 1;
        return (
          <td
            key={`${side}-${field}`}
            className={cn(
              "max-w-56 truncate px-2.5 py-1.5",
              changed.has(field) && value && "font-medium text-amber-900 ring-1 ring-inset ring-amber-200",
              side === "A" && isLast && "border-r-2 border-neutral-300",
              side === "A" && !isLast && paneEdge
            )}
            title={
              changed.has(field)
                ? `A: ${displayFieldValue(model, field, row.before?.[field], refMaps)}\nB: ${displayFieldValue(model, field, row.after?.[field], refMaps)}`
                : label
            }
          >
            {href && label !== "—" ? (
              <a href={href} className="text-blue-600 hover:underline" title="Открыть">
                {label}
              </a>
            ) : (
              label
            )}
          </td>
        );
      })}
    </>
  );
}

/** Одна строка = одна сущность: A и B всегда на одном уровне. */
function UnifiedSnapshotComparison({
  section,
  sourceA,
  sourceB,
  onlyChanges,
  labelA,
  labelB,
}: {
  section: string;
  sourceA: string;
  sourceB: string;
  onlyChanges: boolean;
  labelA: string;
  labelB: string;
}) {
  const [diff, setDiff] = React.useState<Record<string, DiffRow[]> | null>(null);
  const [model, setModel] = React.useState("");
  const [error, setError] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);
  const refMaps = useReferenceMaps(diff);

  React.useEffect(() => {
    setShowAll(false);
    setDiff(null);
    setError("");
    const controller = new AbortController();
    const query = new URLSearchParams({ sourceA, sourceB, section });
    fetch(`/api/snapshots/compare?${query}`, { signal: controller.signal })
      .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
      .then(({ ok, payload }) => {
        if (!ok) throw new Error((payload as { error?: string }).error ?? "Не удалось загрузить сравнение");
        const next = (payload as { diff: Record<string, DiffRow[]> }).diff;
        setDiff(next);
        setModel(Object.keys(next)[0] ?? "");
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить сравнение");
      });
    return () => controller.abort();
  }, [sourceA, sourceB, section]);

  if (error) {
    return <div className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>;
  }
  if (!diff) {
    return <div className="p-6 text-sm text-neutral-500">Загрузка сравнения…</div>;
  }

  const allRows = (diff[model] ?? [])
    .filter((row) => !onlyChanges || row.status !== "unchanged")
    .slice()
    .sort((a, b) => rowSortKey(a).localeCompare(rowSortKey(b), "ru"));
  const rows = showAll ? allRows : allRows.slice(0, COMPARE_ROW_LIMIT);
  const truncated = allRows.length > rows.length;
  const fields = collectFields(rows);
  const sideColSpan = fields.length + 1;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-white">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="text-xs font-medium text-neutral-700">{modelLabel(model)}</span>
        <span className="text-xs text-neutral-400">
          {truncated ? `${rows.length} из ${allRows.length}` : allRows.length} строк · одна работа = один уровень
        </span>
        {truncated && (
          <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setShowAll(true)}>
            Показать все
          </button>
        )}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <table className="min-w-max border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-neutral-100">
              <th
                colSpan={sideColSpan}
                className="border-b border-r border-neutral-200 px-3 py-1.5 text-left text-[11px] font-semibold text-neutral-700"
              >
                A · {labelA}
              </th>
              <th
                colSpan={sideColSpan}
                className="border-b border-neutral-200 px-3 py-1.5 text-left text-[11px] font-semibold text-neutral-700"
              >
                B · {labelB}
              </th>
            </tr>
            <tr className="bg-neutral-50">
              <th className="border-b px-2 py-2 text-left font-medium text-neutral-500">Δ</th>
              {fields.map((field, index) => (
                <th
                  key={`a-${field}`}
                  className={cn(
                    "border-b px-2.5 py-2 text-left font-medium whitespace-nowrap text-neutral-500",
                    index === fields.length - 1 && "border-r-2 border-neutral-300"
                  )}
                >
                  {fieldLabel(field, model)}
                </th>
              ))}
              <th className="border-b px-2 py-2 text-left font-medium text-neutral-500">Δ</th>
              {fields.map((field) => (
                <th
                  key={`b-${field}`}
                  className="border-b px-2.5 py-2 text-left font-medium whitespace-nowrap text-neutral-500"
                >
                  {fieldLabel(field, model)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={cn(
                  "border-b border-neutral-100",
                  row.status === "added" && "bg-green-50/70",
                  row.status === "removed" && "bg-red-50/70",
                  row.status === "modified" && "bg-amber-50/50",
                  row.status === "unchanged" && "bg-white"
                )}
              >
                <ComparisonSideCells model={model} row={row} side="A" fields={fields} refMaps={refMaps} />
                <ComparisonSideCells model={model} row={row} side="B" fields={fields} refMaps={refMaps} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComparisonInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const enabled = params.get("compare") === "1";
  const sourceA = params.get("snapshotA") ?? "live";
  const sourceB = params.get("snapshotB") ?? "live";
  const onlyChanges = params.get("onlyChanges") === "1";
  const isAdminInterface = pathname === "/admin" || pathname.startsWith("/admin/");
  const [snapshots, setSnapshots] = React.useState<SnapshotOption[]>([]);
  const [creatingSnapshot, setCreatingSnapshot] = React.useState(false);

  const pathParts = pathname.split("/").filter(Boolean);
  const section = pathParts[1] ?? "";
  const isDetailRoute = pathParts.length >= 3;
  const canCompareSection =
    pathname.startsWith("/admin/") &&
    section !== "export" &&
    !isDetailRoute;

  const loadSnapshots = React.useCallback(async () => {
    if (!isAdminInterface) return [];
    const response = await fetch("/api/snapshots");
    if (!response.ok) throw new Error("Не удалось загрузить снимки");
    const payload = (await response.json()) as { snapshots?: SnapshotOption[] };
    return payload.snapshots ?? [];
  }, [isAdminInterface]);

  React.useEffect(() => {
    loadSnapshots().then(setSnapshots, () => setSnapshots([]));
  }, [loadSnapshots]);

  const createManualSnapshot = React.useCallback(async () => {
    setCreatingSnapshot(true);
    try {
      const response = await fetch("/api/snapshots", { method: "POST" });
      const payload = (await response.json()) as {
        snapshot?: SnapshotOption;
        error?: string;
      };
      if (!response.ok || !payload.snapshot) {
        throw new Error(payload.error ?? "Не удалось создать снимок");
      }
      const options = await loadSnapshots();
      setSnapshots(options);
      toast.success(`Снимок создан: ${snapshotLabel(payload.snapshot)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать снимок");
    } finally {
      setCreatingSnapshot(false);
    }
  }, [loadSnapshots]);

  const replaceParams = React.useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value == null) next.delete(key);
        else next.set(key, value);
      }
      next.delete("comparePanel");
      next.delete("syncScroll");
      next.delete("snapshot");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  React.useEffect(() => {
    if (!enabled) return;
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.target === "_top" || anchor.origin !== window.location.origin) return;
      const url = new URL(anchor.href);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 3) {
        event.preventDefault();
        event.stopPropagation();
        router.push(url.pathname);
        return;
      }
      url.searchParams.set("compare", "1");
      url.searchParams.set("snapshotA", sourceA);
      url.searchParams.set("snapshotB", sourceB);
      if (onlyChanges) url.searchParams.set("onlyChanges", "1");
      url.searchParams.delete("comparePanel");
      url.searchParams.delete("syncScroll");
      url.searchParams.delete("snapshot");
      event.preventDefault();
      event.stopPropagation();
      router.push(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled, sourceA, sourceB, onlyChanges, router]);

  React.useEffect(() => {
    if (!enabled) return;
    const originalFetch = window.fetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
        headers.set("x-kpd-read-only", "1");
        return originalFetch(input, { ...init, headers });
      }
      return originalFetch(input, init);
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [enabled]);

  const context = React.useMemo(
    () => ({
      enabled,
      readOnly: enabled,
      sourceA,
      sourceB,
      activeSource: "live" as const,
      onlyChanges,
      panel: null as "A" | "B" | null,
    }),
    [enabled, sourceA, sourceB, onlyChanges]
  );

  if (!enabled) {
    return (
      <ComparisonContext.Provider value={context}>
        <div className="flex h-full min-w-0 flex-1 flex-col">
          {isAdminInterface && (
            <div className="z-30 flex min-h-11 shrink-0 flex-wrap items-center justify-end gap-2 border-b bg-white px-4 py-1.5 sm:px-6">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 bg-white"
                onClick={createManualSnapshot}
                disabled={creatingSnapshot}
              >
                {creatingSnapshot ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <DatabaseBackup className="mr-2 h-4 w-4" />
                )}
                Создать снимок
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 bg-white"
                onClick={() => {
                  const fallbackB = snapshots[0]?.id;
                  if (!fallbackB) return;
                  replaceParams({
                    compare: "1",
                    snapshotA: "live",
                    snapshotB: fallbackB,
                    onlyChanges: "1",
                  });
                }}
                disabled={!snapshots.length || creatingSnapshot}
              >
                <Columns2 className="mr-2 h-4 w-4" />
                Сравнить даты
              </Button>
            </div>
          )}
          {children}
        </div>
      </ComparisonContext.Provider>
    );
  }

  return (
    <ComparisonContext.Provider value={context}>
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="z-30 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-white px-4 py-2 shadow-sm">
          <span className="text-sm font-semibold text-neutral-800">Сравнение</span>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-xs font-medium text-neutral-600">Дата A</span>
            <Select value={sourceA} onValueChange={(value) => value && replaceParams({ snapshotA: value })}>
              <SelectTrigger className="h-8 w-52 text-xs">
                <SelectValue>{snapshotSourceLabel(sourceA, snapshots)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live">Актуальные данные</SelectItem>
                {sourceA !== "live" && !snapshots.some((snapshot) => snapshot.id === sourceA) && (
                  <SelectItem value={sourceA} disabled>
                    {snapshotSourceLabel(sourceA, snapshots)}
                  </SelectItem>
                )}
                {snapshots.map((snapshot) => (
                  <SelectItem key={snapshot.id} value={snapshot.id}>{snapshotLabel(snapshot)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-xs font-medium text-neutral-600">Дата B</span>
            <Select value={sourceB} onValueChange={(value) => value && replaceParams({ snapshotB: value })}>
              <SelectTrigger className="h-8 w-52 text-xs">
                <SelectValue>{snapshotSourceLabel(sourceB, snapshots)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live" disabled={sourceA === "live"}>Актуальные данные</SelectItem>
                {sourceB !== "live" && !snapshots.some((snapshot) => snapshot.id === sourceB) && (
                  <SelectItem value={sourceB} disabled>
                    {snapshotSourceLabel(sourceB, snapshots)}
                  </SelectItem>
                )}
                {snapshots.map((snapshot) => (
                  <SelectItem key={snapshot.id} value={snapshot.id} disabled={snapshot.id === sourceA}>
                    {snapshotLabel(snapshot)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="ml-1 flex items-center gap-1.5 text-xs text-neutral-700">
            <Checkbox
              checked={onlyChanges}
              onCheckedChange={(checked) => replaceParams({ onlyChanges: checked === true ? "1" : null })}
            />
            Только изменения
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8"
            aria-label="Выйти из сравнения"
            onClick={() =>
              replaceParams({
                compare: null,
                snapshotA: null,
                snapshotB: null,
                onlyChanges: null,
              })
            }
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {sourceA === sourceB ? (
          <div className="m-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Выберите разные источники A и B.
          </div>
        ) : !canCompareSection ? (
          <div className="m-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
            Сравнение в этом разделе недоступно. Откройте список (проекты, работы, выплаты и т.д.).
          </div>
        ) : (
          <div className="min-h-0 min-w-0 flex-1">
            <UnifiedSnapshotComparison
              section={section}
              sourceA={sourceA}
              sourceB={sourceB}
              onlyChanges={onlyChanges}
              labelA={snapshotSourceLabel(sourceA, snapshots)}
              labelB={snapshotSourceLabel(sourceB, snapshots)}
            />
          </div>
        )}
      </div>
    </ComparisonContext.Provider>
  );
}

export function ComparisonProvider({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={<>{children}</>}>
      <ComparisonInner>{children}</ComparisonInner>
    </React.Suspense>
  );
}
