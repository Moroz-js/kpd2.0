"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DisplayChange } from "@/lib/audit/display-changes";
import { formatDateTime } from "@/lib/format";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";

const fetcher = (url: string) => fetch(url).then(r => r.json());

const ACTION_LABELS: Record<string, string> = {
  create: "Создание",
  update: "Обновление",
  delete: "Удаление",
  archive: "Архивация",
  unarchive: "Возврат из архива",
  status_change: "Смена статуса",
  check: "Проверка",
  mark_paid: "Оплата",
  password_reset: "Сброс пароля",
  access_grant: "Выдача доступа",
  access_revoke: "Отзыв доступа",
};

// Порядок = алфавит русских label (используется в выпадашке фильтра).
const ENTITY_LABELS: Record<string, string> = {
  BankAccount: "Банковский счёт",
  WorkType: "Вид работ",
  Payment: "Выплата",
  Order: "Заказ",
  Task: "Задача",
  Executor: "Исполнитель",
  Client: "Клиент",
  Charge: "Начисление",
  VacationEntry: "Отпуск",
  SpendingPlanLine: "План расходов",
  Project: "Проект",
  OtherExpense: "Прочие траты",
  User: "Пользователь",
  Work: "Работа",
};

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-100 text-green-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
  archive: "bg-yellow-100 text-yellow-700",
  unarchive: "bg-amber-100 text-amber-800",
  status_change: "bg-purple-100 text-purple-700",
  check: "bg-teal-100 text-teal-700",
  mark_paid: "bg-green-100 text-green-700",
  password_reset: "bg-orange-100 text-orange-700",
  access_grant: "bg-emerald-100 text-emerald-700",
  access_revoke: "bg-rose-100 text-rose-700",
};

type UserOption = { id: string; fullName: string };

type LogItem = {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  changes: string | null;
  displayChanges: DisplayChange[];
  createdAt: string;
  user: { fullName: string; role: string };
};

function entityTypeFilterLabel(value: string): string {
  if (value === "_all") return "Все объекты";
  return ENTITY_LABELS[value] ?? value;
}

export function ActivityClient() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState("_all");
  const [userFilter, setUserFilter] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  usePersistedInterfaceState(
    "activity",
    { page, entityType, userFilter },
    (stored) => {
      if (stored.page !== undefined) setPage(stored.page);
      if (stored.entityType !== undefined) setEntityType(stored.entityType);
      if (stored.userFilter) setUserFilter(stored.userFilter);
    }
  );
  usePersistedScroll(scrollRef, "activity-list");

  const { data: users } = useSWR<UserOption[]>("/api/users", fetcher);

  const params = new URLSearchParams({ page: String(page) });
  if (entityType !== "_all") params.set("entityType", entityType);
  userFilter.forEach((id) => params.append("userId", id));

  const { data } = useSWR<{ items: LogItem[]; total: number; pageSize: number }>(
    `/api/activity?${params}`,
    fetcher
  );

  const userOptions = Array.from(
    new Map((users ?? []).map((u) => [u.fullName, { value: u.id, label: u.fullName }])).values()
  ).sort((a, b) => a.label.localeCompare(b.label, "ru"));

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1;

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-3rem)] min-h-0">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">История действий</h1>
        <div className="flex flex-wrap items-center gap-2">
          <MultiSelectFilter
            label="Пользователь"
            options={userOptions}
            value={userFilter}
            onChange={(v) => {
              setUserFilter(v);
              setPage(1);
            }}
          />
          <Select
            value={entityType}
            onValueChange={v => { if (v) { setEntityType(v); setPage(1); } }}
          >
            <SelectTrigger className="w-44 h-8 text-sm">
              <SelectValue placeholder="Все объекты">
                {entityTypeFilterLabel(entityType)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Все объекты</SelectItem>
              {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div ref={scrollRef} className="rounded-lg border border-neutral-200 bg-white overflow-auto flex-1 min-h-0">
        {!data && <div className="p-6 text-sm text-neutral-500">Загрузка…</div>}
        {data && data.items.length === 0 && <div className="p-6 text-sm text-neutral-400 text-center">Нет записей</div>}
        {data && data.items.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 w-36">Время</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 w-36">Пользователь</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 w-40 min-w-[10rem]">Действие</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 w-32">Объект</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500">Запись</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(item => {
                const changes = item.displayChanges ?? [];
                const isOpen = expanded.has(item.id);
                return (
                  <>
                    <tr
                      key={item.id}
                      className={cn("border-b border-neutral-100 hover:bg-neutral-50", changes.length > 0 ? "cursor-pointer" : "")}
                      onClick={() => changes.length > 0 && toggleExpand(item.id)}
                    >
                      <td className="px-4 py-2 text-xs text-neutral-500 tabular-nums">{formatDateTime(item.createdAt)}</td>
                      <td className="px-4 py-2 text-xs">
                        <span className="font-medium">{item.user.fullName}</span>
                      </td>
                      <td className="px-4 py-2 w-40 min-w-[10rem] whitespace-nowrap">
                        <span className={cn("inline-flex px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap", ACTION_COLORS[item.action] ?? "bg-neutral-100 text-neutral-600")}>
                          {ACTION_LABELS[item.action] ?? item.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-neutral-600">
                        {ENTITY_LABELS[item.entityType] ?? item.entityType}
                      </td>
                      <td className="px-4 py-2 text-xs text-neutral-700">
                        {item.entityLabel ?? item.entityId.slice(0, 8) + "…"}
                      </td>
                      <td className="px-4 py-2 text-xs text-neutral-400">
                        {changes.length > 0 && (
                          <span className="text-neutral-400">{isOpen ? "▲" : "▼"}</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && changes.length > 0 && (
                      <tr key={`${item.id}-detail`} className="bg-neutral-50 border-b border-neutral-100">
                        <td colSpan={6} className="px-8 py-3">
                          <div className="text-xs space-y-1">
                            {changes.map(ch => (
                              <div key={ch.field} className="flex items-center gap-2 flex-wrap">
                                <span className="text-neutral-500 w-40 shrink-0">{ch.fieldLabel}:</span>
                                <span className="line-through text-neutral-400">{ch.from}</span>
                                <span className="text-neutral-400">→</span>
                                <span className="text-neutral-700 font-medium">{ch.to}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-neutral-600">
          <span>{data.total} записей, стр. {page} из {totalPages}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
