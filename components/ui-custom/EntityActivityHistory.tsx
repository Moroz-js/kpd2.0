"use client";

import * as React from "react";
import { History, LoaderCircle } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import type { DisplayChange } from "@/lib/audit/display-changes";

type ActivityItem = {
  id: string;
  action: string;
  createdAt: string;
  user: { fullName: string; role: string };
  displayChanges: DisplayChange[];
};

type ActivityHistory = {
  creation: ActivityItem | null;
  items: ActivityItem[];
};

const ACTION_LABELS: Record<string, string> = {
  create: "Создано",
  update: "Изменено",
  auto_update: "Изменено автоматически",
  delete: "Удалено",
  archive: "Архивировано",
  unarchive: "Разархивировано",
  status_change: "Статус изменён",
};

function ActivityEntry({ item }: { item: ActivityItem }) {
  return (
    <div className="space-y-1 border-t border-neutral-100 pt-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <span className="font-medium text-neutral-800">
          {ACTION_LABELS[item.action] ?? item.action}
        </span>
        <span className="text-neutral-500">{item.user.fullName}</span>
        <span className="text-neutral-400 tabular-nums">{formatDateTime(item.createdAt)}</span>
      </div>
      {item.displayChanges.length > 0 && (
        <div className="space-y-0.5 pl-2 text-xs">
          {item.displayChanges.map((change) => (
            <div key={change.field} className="flex flex-wrap items-center gap-x-1.5 text-neutral-600">
              <span>{change.fieldLabel}:</span>
              <span className="line-through text-neutral-400">{change.from}</span>
              <span className="text-neutral-400">→</span>
              <span className="font-medium text-neutral-700">{change.to}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EntityActivityHistory({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const historyKey = `${entityType}:${entityId}`;
  const [state, setState] = React.useState<{
    key: string;
    history: ActivityHistory | null;
    error: boolean;
  }>({ key: "", history: null, error: false });
  const isCurrent = state.key === historyKey;

  React.useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams({ entityType, entityId });
    fetch(`/api/activity/entity?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load activity");
        return response.json() as Promise<ActivityHistory>;
      })
      .then((history) => setState({ key: historyKey, history, error: false }))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setState({ key: historyKey, history: null, error: true });
      });

    return () => controller.abort();
  }, [entityType, entityId, historyKey]);

  return (
    <section className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-neutral-800">
        <History className="h-4 w-4 text-neutral-500" />
        История
      </div>
      {!isCurrent && (
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          Загрузка…
        </div>
      )}
      {isCurrent && state.error && (
        <p className="text-xs text-neutral-500">Не удалось загрузить историю</p>
      )}
      {isCurrent && state.history && (
        <div className="space-y-2">
          {state.history.creation && <ActivityEntry item={state.history.creation} />}
          {state.history.items.map((item) => <ActivityEntry key={item.id} item={item} />)}
          {!state.history.creation && state.history.items.length === 0 && (
            <p className="text-xs text-neutral-500">Записей пока нет</p>
          )}
        </div>
      )}
    </section>
  );
}
