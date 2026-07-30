"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui-custom/DateInput";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MONTHS, formatDate } from "@/lib/format";
import { sortByNameRu } from "@/lib/sort";
import { WORK_STATUSES, WORK_STATUSES_SETTABLE, EXECUTOR_TYPES, PROJECT_TYPES } from "@/lib/statuses";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import type { IssuedWorkRowDTO } from "./IssuedWorksClient";

export type SmetaType = "personal" | "other-expense";

type ProjectOption = { id: string; name: string; status: string };
type ExecutorOption = { id: string; name: string; status: string };
type WorkTypeOption = { id: string; name: string; status: string };

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function IssuedWorkEditDialog({
  row,
  projects,
  executors,
  workTypes,
  onClose,
  onSaved,
}: {
  row: IssuedWorkRowDTO;
  projects: ProjectOption[];
  executors: ExecutorOption[];
  workTypes: WorkTypeOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isPersonal = row.sourceType === "personal";

  const [projectId, setProjectId] = React.useState(row.projectId);
  const [workTypeId, setWorkTypeId] = React.useState(row.workTypeId);
  const [plannedPayAt, setPlannedPayAt] = React.useState(toDateInputValue(row.plannedPayAt));
  const [executionMonth, setExecutionMonth] = React.useState(String(row.executionMonth));
  const [executionYear, setExecutionYear] = React.useState(String(row.executionYear));
  const [executorId, setExecutorId] = React.useState(row.executorId);
  const [workStatus, setWorkStatus] = React.useState(row.workStatus);
  const [submitting, setSubmitting] = React.useState(false);

  const activeProjects = sortByNameRu(
    projects.filter((p) => p.status === "active" || p.id === row.projectId)
  );
  const activeExecutors = sortByNameRu(
    executors.filter((e) => e.status === "active" || e.id === row.executorId)
  );
  const activeWorkTypes = sortByNameRu(
    workTypes.filter((w) => w.status === "active" || w.id === row.workTypeId)
  );
  const statusLocked = row.workStatus === "paid";

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    const payload: Record<string, unknown> = {
      projectId,
      workTypeId,
    };
    if (!statusLocked) payload.workStatus = workStatus;
    if (isPersonal) {
      payload.plannedPayAt = plannedPayAt || null;
    } else {
      payload.executionMonth = Number(executionMonth);
      payload.executionYear = Number(executionYear);
      payload.executorId = executorId;
      payload.plannedPayAt = plannedPayAt || null;
    }

    setSubmitting(true);
    const res = await fetch(`/api/issued-works/${row.sourceType}:${row.sourceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Не удалось сохранить");
      return;
    }
    toast.success("Изменения сохранены");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Работа: {row.executorName} · {row.projectName}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-md bg-neutral-50 border border-neutral-200 px-3 py-2 text-sm space-y-0.5">
            <div>
              <span className="text-neutral-500">Тип сметы: </span>
              <span className="font-medium">
                {isPersonal ? "Личная смета" : "Прочие траты"}
              </span>
            </div>
            <div>
              <span className="text-neutral-500">Сумма: </span>
              <span className="font-medium">{row.amount.toLocaleString("ru-RU")} ₽</span>
            </div>
            <div>
              <span className="text-neutral-500">Год оплаты (план-факт): </span>
              <span className="font-medium tabular-nums">{row.yearPlanFact ?? "—"}</span>
            </div>
            <div>
              <span className="text-neutral-500">Тип проекта: </span>
              <span className="font-medium">
                {PROJECT_TYPES[row.projectType as keyof typeof PROJECT_TYPES] ?? row.projectType ?? "—"}
              </span>
            </div>
            <div>
              <span className="text-neutral-500">Сегмент работ: </span>
              <span className="font-medium">{row.workTypeSegment || "—"}</span>
            </div>
            <div>
              <span className="text-neutral-500">Тип исполнителя: </span>
              <span className="font-medium">
                {EXECUTOR_TYPES[row.executorType as keyof typeof EXECUTOR_TYPES] ?? row.executorType ?? "—"}
              </span>
            </div>
            <div>
              <span className="text-neutral-500">Дата оплаты факт: </span>
              <span className="font-medium">{formatDate(row.paidAt)}</span>
            </div>
            <div>
              <span className="text-neutral-500">Дата оплаты план: </span>
              <span className="font-medium">{formatDate(row.plannedPayAt)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="projectId">Проект</Label>
            <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
              <SelectTrigger id="projectId">
                <SelectValue>
                  {projectId ? (activeProjects.find((p) => p.id === projectId)?.name ?? projectId) : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {activeProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.status === "archived" && " (архив)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="workTypeId">Вид работ</Label>
            <Select value={workTypeId} onValueChange={(v) => setWorkTypeId(v ?? "")}>
              <SelectTrigger id="workTypeId">
                <SelectValue>
                  {workTypeId ? (activeWorkTypes.find((w) => w.id === workTypeId)?.name ?? workTypeId) : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {activeWorkTypes.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                    {w.status === "archived" && " (архив)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isPersonal ? (
            <div className="space-y-2">
              <Label htmlFor="plannedPayAt">Дата оплаты — план</Label>
              <DateInput
                id="plannedPayAt"
                value={plannedPayAt}
                onChange={(e) => setPlannedPayAt(e.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2 min-w-0">
                  <Label htmlFor="executionMonth">Месяц выполнения</Label>
                  <Select
                    value={executionMonth}
                    onValueChange={(v) => setExecutionMonth(v ?? "")}
                  >
                    <SelectTrigger id="executionMonth">
                      <SelectValue>
                        {MONTHS.find((m) => m.value === executionMonth)?.label ?? executionMonth}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 min-w-0">
                  <Label htmlFor="executionYear">Год выполнения</Label>
                  <Input
                    id="executionYear"
                    type="number"
                    value={executionYear}
                    onChange={(e) => setExecutionYear(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="executorId">Исполнитель</Label>
                <Select value={executorId} onValueChange={(v) => setExecutorId(v ?? "")}>
                  <SelectTrigger id="executorId">
                    <SelectValue>
                      {executorId ? (activeExecutors.find((e) => e.id === executorId)?.name ?? executorId) : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {activeExecutors.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                        {e.status === "archived" && " (архив)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="plannedPayAt">Дата оплаты — план</Label>
                <DateInput
                  id="plannedPayAt"
                  value={plannedPayAt}
                  onChange={(e) => setPlannedPayAt(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="workStatus">Статус работы</Label>
            {statusLocked ? (
              <div className="flex items-center gap-2">
                <StatusBadge dict={WORK_STATUSES} value={row.workStatus} />
                <span className="text-xs text-neutral-500">Меняется только при выплате</span>
              </div>
            ) : (
              <>
                <Select value={workStatus} onValueChange={(v) => setWorkStatus(v ?? "")}>
                  <SelectTrigger id="workStatus">
                    <SelectValue>
                      {WORK_STATUSES[workStatus as keyof typeof WORK_STATUSES]?.label ?? workStatus}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {WORK_STATUSES_SETTABLE.map((value) => (
                      <SelectItem key={value} value={value}>
                        {WORK_STATUSES[value].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-neutral-500">
                  Смена на «Проверено» автоматически проставит дату проверки. «Оплачено» — только из выплаты.
                </p>
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Отмена
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
