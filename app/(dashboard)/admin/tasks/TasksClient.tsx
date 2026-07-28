"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Trash2, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { ConfirmDialog } from "@/components/ui-custom/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { TASK_STATUSES } from "@/lib/statuses";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner } from "@/lib/table-styles";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";

type Row = {
  id: string;
  executorId: string;
  executor: { id: string; name: string };
  title: string;
  status: string;
  plannedDoneAt: string | null;
  result: string | null;
  comment: string | null;
  isOnboarding: boolean;
  createdAt: string;
};

type SortField = "executorName" | "status" | "plannedDoneAt" | "createdAt";
type SortDir = "asc" | "desc";

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<Row[]>);

export function TasksClient() {
  const { data, isLoading, mutate } = useSWR<Row[]>("/api/tasks", fetcher);

  const [fExecutor, setFExecutor] = React.useState<string[]>([]);
  const [fStatus, setFStatus] = React.useState<string[]>([]);
  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }>({
    field: "createdAt",
    dir: "desc",
  });
  const [deleteTarget, setDeleteTarget] = React.useState<Row | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  usePersistedInterfaceState(
    "tasks",
    { fExecutor, fStatus, sort },
    (stored) => {
      if (stored.fExecutor) setFExecutor(stored.fExecutor);
      if (stored.fStatus) setFStatus(stored.fStatus);
      if (stored.sort) setSort(stored.sort);
    }
  );
  usePersistedScroll(scrollRef, "tasks-table");

  const allRows = data ?? [];

  const executorOptions = React.useMemo(() =>
    Array.from(new Map(allRows.map((r) => [r.executor.id, r.executor.name])).entries())
      .sort((a, b) => a[1].localeCompare(b[1], "ru"))
      .map(([value, label]) => ({ value, label })),
    [allRows]
  );

  const rows = React.useMemo(() => {
    let list = allRows;
    if (fExecutor.length) list = list.filter((r) => fExecutor.includes(r.executor.id));
    if (fStatus.length) list = list.filter((r) => fStatus.includes(r.status));
    return [...list].sort((a, b) => {
      let av: string, bv: string;
      if (sort.field === "executorName") { av = a.executor.name; bv = b.executor.name; }
      else if (sort.field === "plannedDoneAt") { av = a.plannedDoneAt ?? ""; bv = b.plannedDoneAt ?? ""; }
      else { av = a[sort.field] as string; bv = b[sort.field] as string; }
      const cmp = av.localeCompare(bv, "ru");
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [allRows, fExecutor, fStatus, sort]);

  function handleSort(field: string, dir: SortDir) {
    setSort({ field: field as SortField, dir });
  }

  async function handleDelete(row: Row) {
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/executors/${row.executorId}/tasks/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Задача удалена");
      mutate();
    } catch {
      toast.error("Не удалось удалить задачу");
    }
  }

  const statusOptions = Object.entries(TASK_STATUSES).map(([value, { label }]) => ({ value, label }));

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] min-h-0">
      <PageHeader title="Задачи" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <MultiSelectFilter
          label="Исполнитель"
          options={executorOptions}
          value={fExecutor}
          onChange={setFExecutor}
        />
        <MultiSelectFilter
          label="Статус"
          options={statusOptions}
          value={fStatus}
          onChange={setFStatus}
        />
      </div>

      <div className="text-xs text-neutral-500 mb-2">{rows.length} задач</div>

      <Table
        className="min-w-[900px]"
        containerRef={scrollRef}
        containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto"
      >
          <TableHeader>
            <TableRow>
              <SortableHead field="executorName" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort}>
                Исполнитель
              </SortableHead>
              <TableHead>Задача</TableHead>
              <SortableHead field="status" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort}>
                Статус
              </SortableHead>
              <SortableHead field="plannedDoneAt" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort}>
                Дата план
              </SortableHead>
              <TableHead>Результат</TableHead>
              <TableHead>Комментарий</TableHead>
              <SortableHead field="createdAt" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort}>
                Создана
              </SortableHead>
              <TableHead className={stickyActionsHead} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-neutral-500 py-8">Загрузка...</TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-neutral-500 py-12">Нет задач</TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <a
                      href={`/admin/executors/${r.executor.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-blue-600 hover:underline whitespace-nowrap"
                    >
                      {r.executor.name}
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </a>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <span className="line-clamp-2 text-sm">{r.title}</span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge dict={TASK_STATUSES} value={r.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {r.plannedDoneAt ? formatDate(r.plannedDoneAt) : <span className="text-neutral-400">—</span>}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    {r.result ? (
                      <span className="line-clamp-2 text-sm">{r.result}</span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    {r.comment ? (
                      <span className="line-clamp-2 text-sm">{r.comment}</span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-neutral-500">
                    {formatDate(r.createdAt)}
                  </TableCell>
                  <TableCell className={stickyActionsCell}>
                    <div className={stickyActionsInner}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setDeleteTarget(r)}
                        title="Удалить"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Удалить задачу?"
        description={`«${deleteTarget?.title.slice(0, 80)}» будет удалена без возможности восстановления.`}
        confirmLabel="Удалить"
        destructive
        onConfirm={() => { if (deleteTarget) handleDelete(deleteTarget); }}
      />
    </div>
  );
}
