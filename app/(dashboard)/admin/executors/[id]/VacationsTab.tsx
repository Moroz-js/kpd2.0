"use client";

import React, { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, CheckCircle } from "lucide-react";
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
import { DateInput } from "@/components/ui-custom/DateInput";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import {
  getISOWeek,
  getISOWeekYear,
  getISOWeeksInYear,
  isoWeekMonthGroups,
  isoWeeksOfYear,
  weekLabel,
  toLocalDateString,
} from "@/lib/iso-weeks";
import { VACATION_STATUSES, BADGE_TONE_CLASS } from "@/lib/statuses";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner } from "@/lib/table-styles";
import { usePersistedInterfaceState } from "@/components/PersistedInterfaceState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type VacationRow = {
  id: string;
  startAt: string;
  endAt: string;
  daysCount: number;
  secondStartAt: string | null;
  secondEndAt: string | null;
  secondDaysCount: number | null;
  substituteContacts: string | null;
  status: string;
  approvedBy: { id: string; fullName: string } | null;
  approvedAt: string | null;
};

type CalendarRow = {
  executorId: string;
  executorName: string;
  weeks: number[];
};

type Props = {
  executorId: string;
  isAdmin: boolean;
  isOwner: boolean;
};

function VacationStatusBadge({ status }: { status: string }) {
  const entry = VACATION_STATUSES[status as keyof typeof VACATION_STATUSES];
  if (!entry) return null;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE_TONE_CLASS[entry.tone]}`}>
      {entry.label}
    </span>
  );
}

function SharedVacationCalendar({ executorId }: { executorId: string }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [rows, setRows] = useState<CalendarRow[]>([]);
  const [loading, setLoading] = useState(true);

  usePersistedInterfaceState(
    `executor:${executorId}:vacations-calendar`,
    { year },
    (stored) => {
      if (
        typeof stored.year === "number" &&
        Number.isInteger(stored.year) &&
        stored.year >= currentYear - 1 &&
        stored.year <= currentYear + 1
      ) {
        setYear(stored.year);
      }
    }
  );

  const allWeeks = React.useMemo(() => isoWeeksOfYear(year), [year]);
  const monthGroups = React.useMemo(() => isoWeekMonthGroups(year), [year]);
  const currentWeek =
    getISOWeekYear(new Date()) === year ? getISOWeek(new Date()) : null;

  const yearOptions = React.useMemo(
    () => [currentYear - 1, currentYear, currentYear + 1],
    [currentYear]
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/vacations?year=${year}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: CalendarRow[]) => {
        if (!controller.signal.aborted) setRows(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setRows([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [year]);

  const thWeek =
    "border-b border-neutral-200 px-0.5 py-1 text-center font-medium text-neutral-600 min-w-[22px] tabular-nums";
  const tdWeek = "border-b border-neutral-100 px-0 py-0 min-w-[22px] h-6";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-500">Год</span>
        <Select value={String(year)} onValueChange={(v) => v && setYear(Number(v))}>
          <SelectTrigger className="h-7 w-[88px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-neutral-400">
          {getISOWeeksInYear(year)} ISO-недель
        </span>
      </div>

      {loading ? (
        <div className="text-xs text-neutral-400 py-4 text-center">Загрузка...</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-neutral-400 py-2">
          Нет согласованных отпусков на {year} год.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-white">
          <table className="border-collapse text-xs" style={{ minWidth: "max-content" }}>
            <thead className="sticky top-0 z-20">
              <tr className="bg-neutral-50 border-b border-neutral-100">
                <th
                  className="sticky left-0 z-30 bg-neutral-50 border-b border-r border-neutral-200 px-3 py-1 text-left font-medium text-neutral-600 min-w-[140px]"
                  rowSpan={2}
                >
                  Исполнитель
                </th>
                {monthGroups.map((mg) => (
                  <th
                    key={mg.label + mg.weeks[0]}
                    colSpan={mg.weeks.length}
                    className="border-b border-r border-neutral-100 px-1 py-1 text-center text-[10px] font-medium text-neutral-500"
                  >
                    {mg.label}
                  </th>
                ))}
              </tr>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                {allWeeks.map((w) => (
                  <th
                    key={w}
                    className={cn(
                      thWeek,
                      w === currentWeek && "bg-blue-50 text-blue-800"
                    )}
                    title={weekLabel(w)}
                  >
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const weekSet = new Set(row.weeks);
                return (
                  <tr
                    key={row.executorId}
                    className="hover:bg-neutral-50 border-b border-neutral-100 last:border-0"
                  >
                    <td className="sticky left-0 z-10 bg-white hover:bg-neutral-50 border-r border-neutral-200 px-3 py-1.5 font-medium whitespace-nowrap">
                      {row.executorName}
                    </td>
                    {allWeeks.map((w) => (
                      <td
                        key={w}
                        className={cn(
                          tdWeek,
                          w === currentWeek && !weekSet.has(w) && "bg-blue-50",
                          weekSet.has(w) && "bg-orange-200"
                        )}
                        title={
                          weekSet.has(w)
                            ? `${row.executorName}, ${weekLabel(w)}`
                            : weekLabel(w)
                        }
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function VacationsTab({ executorId, isAdmin, isOwner }: Props) {
  const [entries, setEntries] = useState<VacationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VacationRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VacationRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/executors/${executorId}/vacations`);
      if (!r.ok) throw new Error();
      setEntries(await r.json());
    } catch {
      toast.error("Не удалось загрузить отпуска");
    } finally {
      setLoading(false);
    }
  }, [executorId]);

  useEffect(() => { load(); }, [load]);

  async function handleApprove(id: string) {
    try {
      const r = await fetch(`/api/executors/${executorId}/vacations/${id}/approve`, { method: "POST" });
      if (!r.ok) throw new Error();
      toast.success("Отпуск согласован");
      load();
    } catch {
      toast.error("Не удалось согласовать");
    }
  }

  async function handleDelete(id: string) {
    try {
      const r = await fetch(`/api/executors/${executorId}/vacations/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error ?? "Ошибка");
      }
      toast.success("Отпуск удалён");
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  }

  const canCreate = isAdmin || isOwner;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      <div className="space-y-6 min-h-0">
      {/* Мои отпуска */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-800">
            {isOwner && !isAdmin ? "Мои отпуска" : "Отпуска исполнителя"}
          </h3>
          {canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Отпуск
            </Button>
          )}
        </div>

        {loading ? (
          <div className="text-sm text-neutral-400 text-center py-8">Загрузка...</div>
        ) : entries.length === 0 ? (
          <div className="text-sm text-neutral-400 text-center py-8">
            График отпусков пуст.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead>
                <tr className="bg-neutral-100">
                  <th className="border-b border-neutral-200 px-3 py-2 text-left font-medium text-neutral-600 uppercase tracking-wide min-w-[100px]">Нач. 1</th>
                  <th className="border-b border-neutral-200 px-3 py-2 text-left font-medium text-neutral-600 uppercase tracking-wide min-w-[100px]">Кон. 1</th>
                  <th className="border-b border-neutral-200 px-3 py-2 text-right font-medium text-neutral-600 uppercase tracking-wide">Дней</th>
                  <th className="border-b border-neutral-200 px-3 py-2 text-left font-medium text-neutral-600 uppercase tracking-wide min-w-[100px]">Нач. 2</th>
                  <th className="border-b border-neutral-200 px-3 py-2 text-left font-medium text-neutral-600 uppercase tracking-wide min-w-[100px]">Кон. 2</th>
                  <th className="border-b border-neutral-200 px-3 py-2 text-right font-medium text-neutral-600 uppercase tracking-wide">Дней</th>
                  <th className="border-b border-neutral-200 px-3 py-2 text-right font-medium text-neutral-600 uppercase tracking-wide">Всего</th>
                  <th className="border-b border-neutral-200 px-3 py-2 text-left font-medium text-neutral-600 uppercase tracking-wide">Подмена</th>
                  <th className="border-b border-neutral-200 px-3 py-2 text-left font-medium text-neutral-600 uppercase tracking-wide">Статус</th>
                  <th className={cn("border-b border-neutral-200 px-3 py-2 w-20", stickyActionsHead)}></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-neutral-50 border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-2">{formatDate(e.startAt)}</td>
                    <td className="px-3 py-2">{formatDate(e.endAt)}</td>
                    <td className="px-3 py-2 text-right">{e.daysCount}</td>
                    <td className="px-3 py-2">{formatDate(e.secondStartAt)}</td>
                    <td className="px-3 py-2">{formatDate(e.secondEndAt)}</td>
                    <td className="px-3 py-2 text-right">{e.secondDaysCount ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {e.daysCount + (e.secondDaysCount ?? 0)}
                    </td>
                    <td className="px-3 py-2 max-w-[160px] truncate" title={e.substituteContacts ?? ""}>
                      {e.substituteContacts || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <VacationStatusBadge status={e.status} />
                    </td>
                    <td className={cn("px-3 py-2", stickyActionsCell)}>
                      <div className={stickyActionsInner}>
                        {isAdmin && e.status === "need_approval" && (
                          <button
                            title="Согласовать"
                            className="p-0.5 text-green-600 hover:text-green-800"
                            onClick={() => handleApprove(e.id)}
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {(isAdmin || (isOwner && e.status !== "approved")) && (
                          <button
                            title="Редактировать"
                            className="p-0.5 text-neutral-500 hover:text-neutral-800"
                            onClick={() => setEditTarget(e)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {(isAdmin || (isOwner && e.status !== "approved")) && (
                          <button
                            title="Удалить"
                            className="p-0.5 text-red-400 hover:text-red-600"
                            onClick={() => setDeleteTarget(e)}
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

      {/* Общий календарь */}
      <div>
        <h3 className="text-sm font-semibold text-neutral-800 mb-2">Общий график отпусков</h3>
        <SharedVacationCalendar executorId={executorId} />
      </div>
      </div>

      {createOpen && (
        <VacationFormDialog
          executorId={executorId}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); load(); }}
        />
      )}

      {editTarget && (
        <VacationFormDialog
          executorId={executorId}
          entry={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load(); }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить отпуск?</AlertDialogTitle>
            <AlertDialogDescription>
              Запись об отпуске будет удалена.
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

function VacationFormDialog({
  executorId,
  entry,
  onClose,
  onSaved,
}: {
  executorId: string;
  entry?: VacationRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [startAt, setStartAt] = useState(
    entry?.startAt ? toLocalDateString(new Date(entry.startAt)) : ""
  );
  const [endAt, setEndAt] = useState(
    entry?.endAt ? toLocalDateString(new Date(entry.endAt)) : ""
  );
  const [secondStartAt, setSecondStartAt] = useState(
    entry?.secondStartAt ? toLocalDateString(new Date(entry.secondStartAt)) : ""
  );
  const [secondEndAt, setSecondEndAt] = useState(
    entry?.secondEndAt ? new Date(entry.secondEndAt).toISOString().slice(0, 10) : ""
  );
  const [substituteContacts, setSubstituteContacts] = useState(entry?.substituteContacts ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!startAt || !endAt) {
      toast.error("Укажите даты первого периода");
      return;
    }
    setSaving(true);
    try {
      const url = entry
        ? `/api/executors/${executorId}/vacations/${entry.id}`
        : `/api/executors/${executorId}/vacations`;
      const r = await fetch(url, {
        method: entry ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startAt,
          endAt,
          secondStartAt: secondStartAt || null,
          secondEndAt: secondEndAt || null,
          substituteContacts: substituteContacts || null,
        }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error ?? "Ошибка");
      }
      toast.success(entry ? "Отпуск обновлён" : "Отпуск добавлен");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{entry ? "Редактировать отпуск" : "Добавить отпуск"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-neutral-700">Первый период</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Начало *</Label>
                <Input type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Конец *</Label>
                <Input type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-neutral-700">Второй период (если есть)</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Начало</Label>
                <Input type="date" value={secondStartAt} onChange={(e) => setSecondStartAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Конец</Label>
                <Input type="date" value={secondEndAt} onChange={(e) => setSecondEndAt(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Подмена, контакты</Label>
            <Input
              value={substituteContacts}
              onChange={(e) => setSubstituteContacts(e.target.value)}
              placeholder="Кто подменяет, контакт"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Сохранение..." : entry ? "Сохранить" : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
