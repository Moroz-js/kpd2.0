"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Columns2, DatabaseBackup, Link2, Link2Off, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  snapshotLabel,
  snapshotSourceLabel,
  type SnapshotOption,
} from "@/lib/snapshots/labels";
import { SectionSnapshotComparison } from "@/components/SectionSnapshotComparison";

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

function ComparisonInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const enabled = params.get("compare") === "1";
  const panelParam = params.get("comparePanel");
  const panel: "A" | "B" | null =
    panelParam === "A" || panelParam === "B" ? panelParam : null;
  const sourceA = params.get("snapshotA") ?? "live";
  const sourceB = params.get("snapshotB") ?? "live";
  const onlyChanges = params.get("onlyChanges") === "1";
  const syncScroll = params.get("syncScroll") !== "0";
  const activeSource = panel === "B" ? sourceB : panel === "A" ? sourceA : "live";
  const isAdminInterface = pathname === "/admin" || pathname.startsWith("/admin/");
  const [snapshots, setSnapshots] = React.useState<SnapshotOption[]>([]);
  const [creatingSnapshot, setCreatingSnapshot] = React.useState(false);
  const frameA = React.useRef<HTMLIFrameElement>(null);
  const frameB = React.useRef<HTMLIFrameElement>(null);
  const [framesLoaded, setFramesLoaded] = React.useState(0);

  const pathParts = pathname.split("/").filter(Boolean);
  const section = pathParts[1] ?? "";
  const entityId = pathParts[2] ?? null;
  const isExecutorDetail = section === "executors" && !!entityId;
  const isProjectDetail = section === "projects" && !!entityId;
  const isDetailUiCompare = isExecutorDetail || isProjectDetail;
  const canCompareTable =
    pathname.startsWith("/admin/") &&
    section !== "export" &&
    section !== "cashflow" &&
    !isDetailUiCompare;

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
      next.delete("snapshot");
      next.delete("source");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  React.useEffect(() => {
    if (!enabled || panel) return;
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.target === "_top" || anchor.origin !== window.location.origin) return;
      const url = new URL(anchor.href);
      const parts = url.pathname.split("/").filter(Boolean);
      const drillToEstimateOrDashboard =
        parts[0] === "admin" &&
        (parts[1] === "executors" || parts[1] === "projects") &&
        parts.length >= 3;
      if (drillToEstimateOrDashboard) {
        event.preventDefault();
        event.stopPropagation();
        url.searchParams.set("compare", "1");
        url.searchParams.set("snapshotA", sourceA);
        url.searchParams.set("snapshotB", sourceB);
        if (onlyChanges) url.searchParams.set("onlyChanges", "1");
        url.searchParams.delete("comparePanel");
        url.searchParams.delete("snapshot");
        router.push(`${url.pathname}?${url.searchParams.toString()}`);
        return;
      }
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
      url.searchParams.delete("snapshot");
      event.preventDefault();
      event.stopPropagation();
      router.push(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled, panel, sourceA, sourceB, onlyChanges, router]);

  React.useEffect(() => {
    if (!enabled && !panel) return;
    const originalFetch = window.fetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
        headers.set("x-kpd-read-only", "1");
        return originalFetch(input, { ...init, headers });
      }
      if (panel && activeSource && activeSource !== "live") {
        try {
          const url =
            typeof input === "string"
              ? new URL(input, window.location.origin)
              : input instanceof URL
                ? input
                : new URL(input.url, window.location.origin);
          if (url.pathname.startsWith("/api/") && !url.searchParams.has("source") && !url.searchParams.has("snapshot")) {
            url.searchParams.set("source", activeSource);
            if (input instanceof Request) {
              return originalFetch(new Request(url.toString(), input), init);
            }
            return originalFetch(url.toString(), init);
          }
        } catch {
          // ignore
        }
      }
      return originalFetch(input, init);
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [enabled, panel, activeSource]);

  React.useEffect(() => {
    if (!enabled || panel || !isDetailUiCompare || !syncScroll) return;
    const a = frameA.current?.contentDocument;
    const b = frameB.current?.contentDocument;
    if (!a || !b) return;
    let syncing = false;
    const scrollables = (document: Document) =>
      [...document.querySelectorAll<HTMLElement>("*")].filter(
        (element) => element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth
      );
    const wire = (from: Document, to: Document) => {
      const handler = (event: Event) => {
        if (syncing || !(event.target instanceof from.defaultView!.HTMLElement)) return;
        const fromItems = scrollables(from);
        const index = fromItems.indexOf(event.target);
        const target = scrollables(to)[index];
        if (!target) return;
        syncing = true;
        target.scrollTop = event.target.scrollTop;
        requestAnimationFrame(() => {
          syncing = false;
        });
      };
      from.addEventListener("scroll", handler, true);
      return () => from.removeEventListener("scroll", handler, true);
    };
    const unwireA = wire(a, b);
    const unwireB = wire(b, a);
    return () => {
      unwireA();
      unwireB();
    };
  }, [enabled, panel, isDetailUiCompare, syncScroll, framesLoaded]);

  const context = React.useMemo(
    () => ({
      enabled,
      readOnly: enabled || (panel != null && activeSource !== "live"),
      sourceA,
      sourceB,
      activeSource,
      onlyChanges,
      panel,
    }),
    [enabled, activeSource, sourceA, sourceB, onlyChanges, panel]
  );

  if (panel) {
    return (
      <ComparisonContext.Provider value={context}>
        <div className="flex h-screen min-h-0 min-w-0 flex-1 flex-col bg-neutral-50">
          <div className="shrink-0 border-b bg-white px-4 py-2 text-xs font-medium text-neutral-600">
            {panel}: {snapshotSourceLabel(activeSource, snapshots)} · только чтение
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
        </div>
      </ComparisonContext.Provider>
    );
  }

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

  const panelUrl = (side: "A" | "B") => {
    const next = new URLSearchParams(params.toString());
    next.set("comparePanel", side);
    next.set("snapshot", side === "A" ? sourceA : sourceB);
    next.set("source", side === "A" ? sourceA : sourceB);
    return `${pathname}?${next.toString()}`;
  };

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
                  <SelectItem key={snapshot.id} value={snapshot.id}>
                    {snapshotLabel(snapshot)}
                  </SelectItem>
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
                <SelectItem value="live" disabled={sourceA === "live"}>
                  Актуальные данные
                </SelectItem>
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
          {isDetailUiCompare && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => replaceParams({ syncScroll: syncScroll ? "0" : null })}
            >
              {syncScroll ? <Link2 className="mr-1.5 h-4 w-4" /> : <Link2Off className="mr-1.5 h-4 w-4" />}
              Скролл
            </Button>
          )}
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
                syncScroll: null,
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
        ) : isDetailUiCompare ? (
          <div className={cn("grid min-h-0 flex-1 grid-cols-1 gap-px bg-neutral-300 lg:grid-cols-2")}>
            <iframe
              ref={frameA}
              onLoad={() => setFramesLoaded((value) => value + 1)}
              title="Состояние A"
              src={panelUrl("A")}
              className="h-full min-h-[45vh] min-w-0 w-full bg-white"
            />
            <iframe
              ref={frameB}
              onLoad={() => setFramesLoaded((value) => value + 1)}
              title="Состояние B"
              src={panelUrl("B")}
              className="h-full min-h-[45vh] min-w-0 w-full bg-white"
            />
          </div>
        ) : !canCompareTable ? (
          <div className="m-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
            Сравнение в этом разделе недоступно. Откройте список или карточку сметы / проекта.
          </div>
        ) : (
          <div className="min-h-0 min-w-0 flex-1">
            <SectionSnapshotComparison
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
