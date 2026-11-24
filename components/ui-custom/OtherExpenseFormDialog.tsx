"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateInput } from "@/components/ui-custom/DateInput";
import { EntityActivityHistory } from "@/components/ui-custom/EntityActivityHistory";
import { WorkFieldLinks } from "@/components/ui-custom/WorkFieldLinks";
import { MONTHS } from "@/lib/format";
import { hasOtherExpensePayment } from "@/lib/other-expense-payment";
import { sortByNameRu } from "@/lib/sort";
import { PAYMENT_STATUSES, WORK_STATUSES } from "@/lib/statuses";
import {
  AMOUNTS_UNEQUAL, amountError, expenseDraft, fetchWorkTypeIds, plannedDateEditable, readApiJson, referenceOptions,
  responsibleLocked, reviewPatch, sourceBody, statusOptions,
  type ExpenseDraft, type ExpenseMode, type ExpenseRef, type OtherExpenseEditValues, type ReviewPatch,
} from "./other-expense-editor";

export type { OtherExpenseEditValues } from "./other-expense-editor";

type Props = {
  isAdmin: boolean;
  canRework?: boolean;
  projects: (ExpenseRef & { responsibleExecutorId?: string | null })[];
  executors: ExpenseRef[];
  workTypes: ExpenseRef[];
  permanentExecutors: ExpenseRef[];
  bankAccounts: ExpenseRef[];
  initial?: OtherExpenseEditValues;
  onClose: () => void;
  onSaved: () => void;
  mode?: ExpenseMode;
  onReviewSave?: (patch: ReviewPatch) => Promise<void>;
};

const PREFERRED_PAY_METHODS = [
  "4DEV", "Бизнес-картой КЗ", "Бизнес-картой РФ", "Бизнес-картой СЛ",
  "Бизнес-картой ЧГ", "ГПХ", "З/П", "ИП",
  "Карта физлица другой страны", "Карта физлица РФ", "Крипта",
  "Р/С контрагента ЕС", "Р/С контрагента КЗ", "Р/С контрагента РФ",
  "Р/С контрагента ЧГ", "Самозанятый",
];

function useExecutorWorkTypes(executorId: string | null) {
  const [lookup, setLookup] = useState<{ executorId: string; ids: Set<string> | null } | null>(null);
  useEffect(() => {
    if (!executorId) return;
    const controller = new AbortController();
    const { signal } = controller;
    fetchWorkTypeIds(executorId, signal).then(
      (ids) => { if (!signal.aborted) setLookup({ executorId, ids }); },
      () => { if (!signal.aborted) setLookup({ executorId, ids: null }); },
    );
    return () => controller.abort();
  }, [executorId]);
  return lookup?.executorId === executorId ? lookup : null;
}

export function OtherExpenseFormDialog(props: Props) {
  return <OtherExpenseEditor key={`${props.mode ?? "source"}:${props.initial?.id ?? "new"}`} {...props} />;
}

function OtherExpenseEditor({
  isAdmin, canRework = false, projects, executors, workTypes, permanentExecutors, bankAccounts,
  initial, onClose, onSaved, mode = "source", onReviewSave,
}: Props) {
  const id = useId();
  const source = mode === "source";
  const view = mode === "view";
  const defaults = useMemo(() => expenseDraft(initial), [initial]);
  const [changes, setChanges] = useState<Partial<ExpenseDraft>>({});
  const draft = { ...defaults, ...changes };
  const change = (fields: Partial<ExpenseDraft>) => setChanges((prev) => ({ ...prev, ...fields }));
  const [paymentAmountTouched, setPaymentAmountTouched] = useState(
    initial?.paymentAmount != null && initial.paymentAmount !== initial.amount,
  );
  const [saving, setSaving] = useState(false);

  const lookup = useExecutorWorkTypes(source ? draft.executorId : null);
  const scopedIds = lookup?.ids;
  const linkedWorkTypes = useMemo(() => scopedIds ? workTypes.filter((w) => scopedIds.has(w.id)) : [], [scopedIds, workTypes]);
  const responsibleEditable = !view && !responsibleLocked(initial);
  const responsibleCatalog = useMemo(() => responsibleEditable ? sortByNameRu(permanentExecutors) : [], [permanentExecutors, responsibleEditable]);
  const workStatuses = statusOptions(mode, initial, canRework);
  const paymentCreated = hasOtherExpensePayment(initial?.paymentStatus);
  const workLabel = WORK_STATUSES[draft.workStatus as keyof typeof WORK_STATUSES]?.label ?? draft.workStatus;
  const paymentLabel = PAYMENT_STATUSES[draft.paymentStatus as keyof typeof PAYMENT_STATUSES]?.label ?? (draft.paymentStatus || "—");
  const review = mode === "review" && initial ? reviewPatch(initial, changes) : {};
  const reviewCanSave = !!onReviewSave && Object.keys(review).length > 0;
  const financialError = source ? amountError(draft, initial) : null;
  const thisYear = new Date().getFullYear();
  const years = [...new Set([thisYear - 1, thisYear, thisYear + 1, ...(initial ? [initial.executionYear] : [])])].sort((a, b) => a - b);

  async function handleSave() {
    if (view || saving) return;
    setSaving(true);
    try {
      if (mode === "review") {
        if (!onReviewSave || !reviewCanSave) return;
        await onReviewSave(review);
      } else {
        const body = sourceBody(draft, initial, isAdmin, canRework);
        const response = await fetch(initial ? `/api/other-expenses/${encodeURIComponent(initial.id)}` : "/api/other-expenses", {
          method: initial ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await readApiJson<{ error?: string } | null>(response);
        if (!response.ok) throw new Error(data?.error ?? `Ошибка сервера (${response.status})`);
      }
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{view ? "Просмотр траты" : initial ? "Редактировать" : "Новая трата"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`${id}-year`}>Год *</Label>
            <Select value={draft.executionYear} disabled={!source} onValueChange={(v) => v && change({ executionYear: v })}>
              <SelectTrigger id={`${id}-year`}><SelectValue>{draft.executionYear} год</SelectValue></SelectTrigger>
              <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y} год</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`${id}-month`}>Месяц *</Label>
            <Select value={draft.executionMonth} disabled={!source} onValueChange={(v) => v && change({ executionMonth: v })}>
              <SelectTrigger id={`${id}-month`}><SelectValue>{MONTHS.find((m) => m.value === draft.executionMonth)?.label}</SelectValue></SelectTrigger>
              <SelectContent>{MONTHS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2 min-w-0">
            <Label htmlFor={`${id}-project`}>Проект *</Label>
            <SearchableSelect
              id={`${id}-project`} value={draft.projectId} disabled={!source}
              onValueChange={(projectId) => {
                const pmId = !initial && projects.find((p) => p.id === projectId)?.responsibleExecutorId;
                change({ projectId, ...(pmId ? { responsibleExecutorId: pmId } : {}) });
              }}
              options={referenceOptions(source ? projects : [], draft.projectId, initial?.project)}
              placeholder={source ? "Выберите проект" : "—"} contentClassName="max-w-lg" optionClassName="whitespace-normal"
            />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`${id}-executor`}>Исполнитель *</Label>
            <SearchableSelect
              id={`${id}-executor`} value={draft.executorId} disabled={!source}
              onValueChange={(executorId) => { if (executorId !== draft.executorId) change({ executorId, workTypeId: "" }); }}
              options={referenceOptions(source ? executors : [], draft.executorId, initial?.executor)}
              placeholder={source ? "Выберите" : "—"}
            />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`${id}-work-type`}>Вид работ *</Label>
            <SearchableSelect
              id={`${id}-work-type`} value={draft.workTypeId} onValueChange={(workTypeId) => change({ workTypeId })}
              options={referenceOptions(linkedWorkTypes, draft.workTypeId, draft.executorId === initial?.executorId ? initial.workType : null)}
              disabled={!source || !lookup?.ids} placeholder={source ? "Выберите" : "—"}
              emptyMessage="Нет видов работ у исполнителя" contentClassName="w-80"
            />
            {source && lookup?.ids === null && <p role="status" className="text-xs text-amber-600">Не удалось загрузить виды работ исполнителя</p>}
          </div>
          <div className="space-y-1.5 col-span-2 min-w-0">
            <Label htmlFor={`${id}-description`}>Описание работы *</Label>
            <Input id={`${id}-description`} value={draft.description} disabled={!source} onChange={(e) => change({ description: e.target.value })} placeholder="Описание..." />
            <WorkFieldLinks text={draft.description} />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`${id}-responsible`}>Ответственный *</Label>
            <SearchableSelect
              id={`${id}-responsible`} value={draft.responsibleExecutorId} onValueChange={(responsibleExecutorId) => change({ responsibleExecutorId })}
              options={referenceOptions(responsibleCatalog, draft.responsibleExecutorId, initial?.responsibleExecutor)}
              disabled={!responsibleEditable} placeholder={responsibleEditable ? "Выберите" : "—"}
            />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`${id}-method`}>Способ оплаты</Label>
            <Select value={draft.preferredPayMethod} disabled={!source} onValueChange={(v) => change({ preferredPayMethod: v ?? "" })}>
              <SelectTrigger id={`${id}-method`}><SelectValue>{draft.preferredPayMethod || "—"}</SelectValue></SelectTrigger>
              <SelectContent className="w-80">
                <SelectItem value="">—</SelectItem>
                {PREFERRED_PAY_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`${id}-amount`}>Сумма работы *</Label>
            <Input id={`${id}-amount`} type="number" value={draft.amount} disabled={!source} placeholder="0"
              onChange={(e) => {
                const amount = e.target.value;
                change({ amount, ...(!paymentAmountTouched && { paymentAmount: amount }) });
              }}
            />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`${id}-payment`}>Сумма выплаты *</Label>
            <Input id={`${id}-payment`} type="number" value={draft.paymentAmount} disabled={!source} placeholder={source ? "0" : "—"}
              onChange={(e) => {
                setPaymentAmountTouched(true);
                change({ paymentAmount: e.target.value });
              }}
            />
          </div>
          {financialError === AMOUNTS_UNEQUAL && <p className="col-span-2 text-xs text-amber-600">{financialError}</p>}
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`${id}-date`}>Дата оплаты — план</Label>
            <DateInput id={`${id}-date`} className="h-9" value={draft.plannedPayAt} disabled={!source || !plannedDateEditable(initial)}
              onChange={(e) => change({ plannedPayAt: e.target.value })} />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`${id}-status`}>Статус работы</Label>
            {workStatuses.length ? (
              <Select value={draft.workStatus} onValueChange={(v) => v && change({ workStatus: v })}>
                <SelectTrigger id={`${id}-status`}><SelectValue>{workLabel}</SelectValue></SelectTrigger>
                <SelectContent>
                  {workStatuses.map((s) => <SelectItem key={s} value={s}>{WORK_STATUSES[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : <Input id={`${id}-status`} value={workLabel} disabled className="h-9" />}
            {source && paymentCreated && workStatuses.length > 0 && draft.workStatus !== initial?.workStatus && (
              <p className="text-xs text-amber-600">Выплата будет удалена при сохранении</p>
            )}
          </div>
          {initial && (!source || (isAdmin && paymentCreated)) && (
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor={`${id}-payment-status`}>Статус выплаты</Label>
              {source && isAdmin && initial.paymentStatus === "paid" ? (
                <Select value={draft.paymentStatus} onValueChange={(v) => v && change({ paymentStatus: v })}>
                  <SelectTrigger id={`${id}-payment-status`}><SelectValue>{paymentLabel}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planned">{PAYMENT_STATUSES.planned.label}</SelectItem>
                    <SelectItem value="paid">{PAYMENT_STATUSES.paid.label}</SelectItem>
                  </SelectContent>
                </Select>
              ) : <Input id={`${id}-payment-status`} value={paymentLabel} disabled className="h-9" />}
            </div>
          )}
          {initial && (
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor={`${id}-bank`}>Источник перевода</Label>
              <SearchableSelect
                id={`${id}-bank`} value={draft.bankAccountId} disabled={!source} onValueChange={(bankAccountId) => change({ bankAccountId })}
                options={[{ value: "", label: "—" }, ...referenceOptions(source ? bankAccounts : [], draft.bankAccountId, initial.bankAccount)]}
              />
            </div>
          )}
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`${id}-comment`}>Комментарий</Label>
            <Input id={`${id}-comment`} value={draft.comment} disabled={view} onChange={(e) => change({ comment: e.target.value })} />
          </div>
        </div>
        {!view && isAdmin && initial && <EntityActivityHistory entityType="OtherExpense" entityId={initial.id} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{view ? "Закрыть" : "Отмена"}</Button>
          {!view && <Button onClick={handleSave} disabled={saving || (source ? !!financialError : !reviewCanSave)}>
            {saving ? "Сохранение..." : initial ? "Сохранить" : "Создать"}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
