"use client";

import { useId, useState, type FormEvent } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EntityActivityHistory } from "@/components/ui-custom/EntityActivityHistory";
import { WorkFieldLinks } from "@/components/ui-custom/WorkFieldLinks";
import { MONTHS } from "@/lib/format";
import { nearestPaymentDate, toLocalDateString } from "@/lib/iso-weeks";
import {
  canEditPersonalWork, DateInput, editPersonalWorkField, MoneyInput, personalWorkFields,
  personalWorkReviewPatch, personalWorkSourcePatch, WORK_STATUS_LABELS, WORK_STATUS_SETTABLE,
  type NamedWorkOption, type PersonalWorkDraft, type PersonalWorkEditValues, type PersonalWorkReviewPatch,
} from "./PersonalWorkFields";

export type { PersonalWorkEditValues, PersonalWorkReviewPatch } from "./PersonalWorkFields";

type Mode = "source" | "review" | "view";
type Props = {
  executorId: string;
  work: PersonalWorkEditValues;
  isAdmin: boolean;
  permanentExecutors: NamedWorkOption[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  executorName?: string;
  mode?: Mode;
  onReviewSave?: (patch: PersonalWorkReviewPatch) => Promise<void>;
};

async function fetchOptions(url: string): Promise<NamedWorkOption[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Не удалось загрузить варианты");
  return response.json();
}

function optionsWithStored(rows: NamedWorkOption[], stored: NamedWorkOption | null) {
  const options = rows.map(({ id, name }) => ({ value: id, label: name }));
  return stored && !rows.some(({ id }) => id === stored.id)
    ? [{ value: stored.id, label: stored.name, disabled: true }, ...options]
    : options;
}

/** Source is for an admin or the owner of this estimate; callers grant reviewers access per row. */
export function PersonalWorkEditDialog(props: Props) {
  let mode = props.mode ?? "source";
  if (mode === "source" && !canEditPersonalWork(props.work.workStatus, props.isAdmin, true)) mode = "view";
  if (mode === "review" && !props.onReviewSave) mode = "view";
  return <PersonalWorkForm key={`${props.executorId}:${props.work.id}:${mode}`} {...props} mode={mode} />;
}

function PersonalWorkForm({
  executorId, work, executorName, isAdmin, permanentExecutors, onClose, onSaved, mode, onReviewSave,
}: Props & { mode: Mode }) {
  const id = useId();
  const [edits, setEdits] = useState<PersonalWorkDraft>({});
  const [saving, setSaving] = useState(false);
  const original = personalWorkFields(work);
  const values = { ...original, ...edits };
  const isLinked = !!work.paymentId;
  const isSource = mode === "source";
  const sourceDisabled = !isSource || saving;
  const reviewDisabled = mode === "view" || saving;
  const amountEditable = work.workStatus !== "paid";
  const baseUrl = `/api/executors/${encodeURIComponent(executorId)}`;
  const { data: projects = [] } = useSWR(isSource ? `${baseUrl}/plan-projects` : null, fetchOptions);
  const { data: workTypes = [] } = useSWR(isSource && values.projectId
    ? `${baseUrl}/plan-work-types?projectId=${encodeURIComponent(values.projectId)}` : null, fetchOptions);
  const currentYear = new Date().getFullYear();
  const years = [...new Set([currentYear - 2, currentYear - 1, currentYear, currentYear + 1, work.executionYear])].sort();

  function edit<K extends keyof typeof original>(field: K, value: (typeof original)[K]) {
    setEdits((previous) => editPersonalWorkField(original, previous, field, value, amountEditable));
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (reviewDisabled) return;
    setSaving(true);
    try {
      if (mode === "review") {
        if (!onReviewSave) return;
        const patch = personalWorkReviewPatch(edits, !isLinked);
        if (Object.keys(patch).length) await onReviewSave(patch);
      } else {
        const patch = personalWorkSourcePatch(work, edits, isAdmin);
        if (Object.keys(patch).length) {
          const response = await fetch(`${baseUrl}/works/${encodeURIComponent(work.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.error ?? "Не удалось сохранить работу");
          }
        }
      }
      await onSaved();
      toast.success("Работа обновлена");
    } catch (error) {
      toast.error((error instanceof Error && error.message) || "Не удалось сохранить работу");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] grid-cols-1 overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "view" ? "Просмотр работы" : "Редактировать работу"}</DialogTitle>
          {executorName && <DialogDescription>Личная смета · Исполнитель: {executorName}</DialogDescription>}
        </DialogHeader>
        {isLinked && (
          <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
            Работа привязана к выплате: статус и даты управляются выплатой.
          </p>
        )}
        <form onSubmit={handleSave} className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-year`}>Год</Label>
              <Select disabled={sourceDisabled} value={String(values.executionYear)} onValueChange={(v) => v && edit("executionYear", Number(v))}>
                <SelectTrigger id={`${id}-year`}><SelectValue>{values.executionYear} год</SelectValue></SelectTrigger>
                <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y} год</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-month`}>Месяц</Label>
              <Select disabled={sourceDisabled} value={String(values.executionMonth)} onValueChange={(v) => v && edit("executionMonth", Number(v))}>
                <SelectTrigger id={`${id}-month`}><SelectValue>{MONTHS[values.executionMonth - 1]?.label}</SelectValue></SelectTrigger>
                <SelectContent>{MONTHS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-project`}>Проект</Label>
            <SearchableSelect id={`${id}-project`} disabled={sourceDisabled} value={values.projectId}
              options={optionsWithStored(projects, work.project)} onValueChange={(v) => v && edit("projectId", v)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-work-type`}>Вид работ</Label>
            <SearchableSelect id={`${id}-work-type`} disabled={sourceDisabled} value={values.workTypeId}
              options={optionsWithStored(workTypes, work.workType)} onValueChange={(v) => v && edit("workTypeId", v)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-responsible`}>Ответственный</Label>
            <SearchableSelect id={`${id}-responsible`} disabled={reviewDisabled} value={values.responsibleExecutorId ?? ""}
              options={[{ value: "", label: "Не указан" }, ...optionsWithStored(permanentExecutors, work.responsibleExecutor)]}
              onValueChange={(v) => edit("responsibleExecutorId", v || null)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-task`}>Техническое задание</Label>
            <Textarea id={`${id}-task`} disabled={sourceDisabled} value={values.techTask} onChange={(e) => edit("techTask", e.target.value)}
              rows={4} className="field-sizing-fixed min-w-0 resize-y break-all text-xs" />
            <WorkFieldLinks text={values.techTask} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label htmlFor={`${id}-volume`}>Объём</Label><MoneyInput id={`${id}-volume`} disabled={sourceDisabled} value={values.volume} onChange={(v) => edit("volume", v)} /></div>
            <div className="space-y-1.5"><Label htmlFor={`${id}-rate`}>Ставка</Label><MoneyInput id={`${id}-rate`} disabled={sourceDisabled} value={values.rate} onChange={(v) => edit("rate", v)} /></div>
            <div className="space-y-1.5"><Label htmlFor={`${id}-amount`}>Сумма</Label><MoneyInput id={`${id}-amount`} disabled={sourceDisabled || !amountEditable} value={values.amount} onChange={(v) => edit("amount", v)} /></div>
          </div>
          {!isLinked && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-date`}>Дата оплаты план</Label>
              <DateInput id={`${id}-date`} disabled={sourceDisabled} value={values.plannedPayAt ?? ""} onChange={(v) => edit("plannedPayAt", v || null)}
                onEmptyFocus={() => toLocalDateString(nearestPaymentDate())} />
            </div>
          )}
          {!isLinked && (!isSource || isAdmin) && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-status`}>Статус</Label>
              <Select disabled={reviewDisabled} value={values.workStatus} onValueChange={(v) => v && edit("workStatus", v)}>
                <SelectTrigger id={`${id}-status`}><SelectValue>{WORK_STATUS_LABELS[values.workStatus] ?? values.workStatus}</SelectValue></SelectTrigger>
                <SelectContent>{WORK_STATUS_SETTABLE.map((s) => <SelectItem key={s} value={s}>{WORK_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-link`}>Ссылка</Label>
            <Textarea id={`${id}-link`} disabled={sourceDisabled} value={values.link ?? ""} onChange={(e) => edit("link", e.target.value || null)}
              placeholder="https://..." rows={1} className="field-sizing-fixed min-h-8 resize-y break-all" />
            <WorkFieldLinks text={values.link} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-report`}>Отчёт</Label>
            <Textarea id={`${id}-report`} disabled={sourceDisabled} value={values.report ?? ""} onChange={(e) => edit("report", e.target.value || null)}
              placeholder="Текст отчёта" rows={3} className="field-sizing-fixed min-w-0 resize-y break-words text-xs" />
            <WorkFieldLinks text={values.report} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-comment`}>Комментарий</Label>
            <Input id={`${id}-comment`} disabled={reviewDisabled} value={values.comment ?? ""} onChange={(e) => edit("comment", e.target.value || null)} />
          </div>
          {isAdmin && mode !== "view" && <EntityActivityHistory entityType="Work" entityId={work.id} />}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{mode === "view" ? "Закрыть" : "Отмена"}</Button>
            {mode !== "view" && (
              <Button type="submit" disabled={saving || !Object.keys(edits).length}>{saving ? "Сохранение..." : "Сохранить"}</Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
