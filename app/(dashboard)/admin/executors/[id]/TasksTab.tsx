"use client";

import React, { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { TASK_STATUSES, BADGE_TONE_CLASS } from "@/lib/statuses";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner } from "@/lib/table-styles";
import { WorksReviewTable } from "@/components/ui-custom/WorksReviewTable";
import { usePersistedInterfaceState } from "@/components/PersistedInterfaceState";

type TaskRow = {
  id: string;
  title: string;
  status: string;
  plannedDoneAt: string | null;
  result: string | null;
  comment: string | null;
  isOnboarding: boolean;
  createdAt: string;
};

type Props = {
  executorId: string;
  isAdmin: boolean;
  isOwner: boolean;
  isPermanent?: boolean;
  onTaskCountChange?: (count: number) => void;
};

const STATUS_LABELS: Record<string, string> = {
  in_progress: "В работе",
  done: "Выполнено",
  review: "На проверке",
  paused: "На паузе",
  pending: "Поставлена",
};

function TaskStatusBadge({ status }: { status: string }) {
  const entry = TASK_STATUSES[status as keyof typeof TASK_STATUSES];
  if (!entry) return null;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE_TONE_CLASS[entry.tone]}`}>
      {entry.label}
    </span>
  );
}

export function TasksTab({ executorId, isAdmin, isOwner, isPermanent = true, onTaskCountChange }: Props) {
  const [subView, setSubView] = useState<"tasks" | "review">("tasks");
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TaskRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskRow | null>(null);

  usePersistedInterfaceState(
    `executor:${executorId}:tasks`,
    { subView },
    (stored) => {
      if (stored.subView === "tasks") {
        setSubView("tasks");
      } else if (stored.subView === "review" && (isAdmin || isPermanent)) {
        setSubView("review");
      }
    }
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/executors/${executorId}/tasks`);
      if (!r.ok) throw new Error();
      const data: TaskRow[] = await r.json();
      setTasks(data);
      onTaskCountChange?.(data.filter((t) => t.status !== "done").length);
    } catch {
      toast.error("Не удалось загрузить задачи");
    } finally {
      setLoading(false);
    }
  }, [executorId, onTaskCountChange]);

  const STATUS_ORDER: Record<string, number> = {
    pending: 0, in_progress: 1, review: 2, paused: 3, done: 99,
  };

  const sortedTasks = React.useMemo(
    () => [...tasks].sort((a, b) => (STATUS_ORDER[a.status] ?? 50) - (STATUS_ORDER[b.status] ?? 50)),
    [tasks]
  );

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string) {
    try {
      const r = await fetch(`/api/executors/${executorId}/tasks/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      toast.success("Задача удалена");
      setDeleteTarget(null);
      load();
    } catch {
      toast.error("Не удалось удалить задачу");
    }
  }

  async function handleStatusChange(task: TaskRow, status: string) {
    try {
      const r = await fetch(`/api/executors/${executorId}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error();
      load();
    } catch {
      toast.error("Не удалось обновить задачу");
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <div className="shrink-0 flex items-center gap-2">
        <div className="inline-flex rounded-md border border-neutral-200 bg-neutral-50 p-0.5">
          <button
            className={cn(
              "px-3 py-1 text-xs font-medium rounded transition-colors",
              subView === "tasks" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
            )}
            onClick={() => setSubView("tasks")}
          >
            Задачи
          </button>
          {(isAdmin || isPermanent) && (
            <button
              className={cn(
                "px-3 py-1 text-xs font-medium rounded transition-colors",
                subView === "review" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
              )}
              onClick={() => setSubView("review")}
            >
              Работы на проверку
            </button>
          )}
        </div>
        {subView === "tasks" && isAdmin && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Задача
          </Button>
        )}
      </div>

      {subView === "review" ? (
        <div className="flex-1 min-h-0 min-w-0 overflow-auto">
          <WorksReviewTable
            fetchUrl={`/api/executors/${executorId}/review-works`}
            stateKey={`executor:${executorId}:review-works`}
            emptyText="Нет работ, где вы назначены ответственным."
          />
        </div>
      ) : (
      <div className="flex-1 min-h-0 min-w-0 overflow-auto rounded-md border bg-white">
      {loading ? (
        <div className="text-sm text-neutral-400 text-center py-8">Загрузка...</div>
      ) : tasks.length === 0 ? (
        <div className="text-sm text-neutral-400 text-center py-8">
          Задач нет. {isAdmin ? "Создайте первую задачу." : ""}
        </div>
      ) : (
        <div className="min-w-0">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-neutral-100">
                <th className="border-b border-neutral-200 px-3 py-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide min-w-[300px]">Задача</th>
                <th className="border-b border-neutral-200 px-3 py-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide min-w-[110px]">Статус</th>
                <th className="border-b border-neutral-200 px-3 py-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide min-w-[90px]">Срок</th>
                <th className="border-b border-neutral-200 px-3 py-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide min-w-[140px]">Результат</th>
                <th className="border-b border-neutral-200 px-3 py-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide min-w-[140px]">Комментарий</th>
                <th className={cn("border-b border-neutral-200 px-3 py-2 w-10", stickyActionsHead)}></th>
              </tr>
            </thead>
            <tbody>
              {sortedTasks.map((task) => (
                <tr key={task.id} className={`hover:bg-neutral-50 border-b border-neutral-100 ${task.status === "done" ? "opacity-60" : ""}`}>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span>{task.title}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    {isAdmin || isOwner ? (
                      <Select
                        value={task.status}
                        onValueChange={(v) => v && handleStatusChange(task, v)}
                      >
                        <SelectTrigger className="h-6 text-xs border-0 px-0 shadow-none focus:ring-0">
                          <SelectValue>
                            <TaskStatusBadge status={task.status} />
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <TaskStatusBadge status={task.status} />
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-neutral-500">
                    {formatDate(task.plannedDoneAt)}
                  </td>
                  <td className="px-3 py-1.5">
                    {(isAdmin || isOwner) ? (
                      <InlineEdit
                        value={task.result ?? ""}
                        onSave={(v) => {
                          fetch(`/api/executors/${executorId}/tasks/${task.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ result: v || null }),
                          }).then(() => load());
                        }}
                      />
                    ) : (
                      <span className="text-neutral-600">{task.result || "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {(isAdmin || isOwner) ? (
                      <InlineEdit
                        value={task.comment ?? ""}
                        onSave={(v) => {
                          fetch(`/api/executors/${executorId}/tasks/${task.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ comment: v || null }),
                          }).then(() => load());
                        }}
                      />
                    ) : (
                      <span className="text-neutral-600">{task.comment || "—"}</span>
                    )}
                  </td>
                  <td className={cn("px-3 py-1.5", stickyActionsCell)}>
                    <div className={stickyActionsInner}>
                      {isAdmin && (
                        <button
                          title="Удалить"
                          className="p-0.5 text-red-400 hover:text-red-600"
                          onClick={() => setDeleteTarget(task)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
      )}

      {createOpen && (
        <CreateTaskDialog
          executorId={executorId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); load(); }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить задачу?</AlertDialogTitle>
            <AlertDialogDescription>
              «{deleteTarget?.title?.slice(0, 60)}» будет удалена.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Inline-редактирование текстового поля
function InlineEdit({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);

  if (editing) {
    return (
      <input
        autoFocus
        className="border border-blue-300 rounded px-1 py-0.5 text-xs w-full outline-none"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { setEditing(false); onSave(v); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { setEditing(false); onSave(v); }
          if (e.key === "Escape") { setEditing(false); setV(value); }
        }}
      />
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 cursor-pointer hover:bg-neutral-100 rounded px-1 py-0.5 text-neutral-600 group"
      onClick={() => setEditing(true)}
      title="Нажмите для редактирования"
    >
      <span className="min-w-[40px]">{v || <span className="text-neutral-300">—</span>}</span>
      <Pencil className="h-3 w-3 shrink-0 text-neutral-300 group-hover:text-neutral-500 transition-colors" />
    </span>
  );
}

function CreateTaskDialog({
  executorId,
  onClose,
  onCreated,
}: {
  executorId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [plannedDoneAt, setPlannedDoneAt] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim()) { toast.error("Введите название задачи"); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/executors/${executorId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), plannedDoneAt: plannedDoneAt || null }),
      });
      if (!r.ok) throw new Error();
      toast.success("Задача создана");
      onCreated();
    } catch {
      toast.error("Ошибка при создании");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Новая задача</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Задача *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Описание задачи" />
          </div>
          <div className="space-y-1.5">
            <Label>Срок выполнения</Label>
            <Input type="date" value={plannedDoneAt} onChange={(e) => setPlannedDoneAt(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Создание..." : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
