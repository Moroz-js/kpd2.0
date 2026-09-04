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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { MONTHS } from "@/lib/format";
import { PAYMENT_STATUSES } from "@/lib/statuses";
import { sortByNameRu } from "@/lib/sort";
import { EntityActivityHistory } from "@/components/ui-custom/EntityActivityHistory";
import type { PayoutRowDTO } from "./PayoutsClient";

type ExecutorOption = { id: string; name: string; status: string };
type BankOption = { id: string; name: string; status: string };

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function PayoutEditDialog({
  row,
  executors,
  banks,
  onClose,
  onSaved,
}: {
  row: PayoutRowDTO;
  executors: ExecutorOption[];
  banks: BankOption[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const isPersonal = row.sourceType === "personal";
  const isOther = row.sourceType === "other-expense";
  const amountLocked = isPersonal && row.hasLinkedWorks === true;

  const [amount, setAmount] = React.useState(
    String(isOther ? (row.paymentAmount ?? row.amount) : row.amount)
  );
  const [workAmount, setWorkAmount] = React.useState(
    String(row.workAmount ?? row.amount)
  );
  const [paymentStatus, setPaymentStatus] = React.useState(row.paymentStatus);
  const [plannedPayAt, setPlannedPayAt] = React.useState(toDateInputValue(row.plannedPayAt));
  const [paidAt, setPaidAt] = React.useState(toDateInputValue(row.paidAt));
  const [bankAccountId, setBankAccountId] = React.useState(row.bankAccountId ?? "");
  const [comment, setComment] = React.useState(row.comment ?? "");
  const [executorId, setExecutorId] = React.useState(row.executorId);
  const [periodMonth, setPeriodMonth] = React.useState(String(row.periodMonth));
  const [periodYear, setPeriodYear] = React.useState(String(row.periodYear));
  const [submitting, setSubmitting] = React.useState(false);

  const otherAmountsMismatch =
    isOther &&
    workAmount !== "" &&
    amount !== "" &&
    parseFloat(workAmount) !== parseFloat(amount);
  const otherAmountsValid =
    !isOther ||
    (workAmount !== "" &&
      amount !== "" &&
      parseFloat(workAmount) > 0 &&
      parseFloat(amount) > 0);

  const activeBanks = sortByNameRu(
    banks.filter((b) => b.status === "active" || b.id === row.bankAccountId)
  );
  const activeExecutors = sortByNameRu(
    executors.filter((e) => e.status === "active" || e.id === row.executorId)
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (!otherAmountsValid) {
      toast.error("Сумма работы и сумма выплаты должны быть положительными");
      return;
    }
    if (otherAmountsMismatch) {
      toast.error("Сумма работы и сумма выплаты не равны");
      return;
    }

    const payload: Record<string, unknown> = {
      paymentStatus,
      paidAt: paidAt ? new Date(paidAt).toISOString() : null,
      plannedPayAt: plannedPayAt ? new Date(plannedPayAt).toISOString() : null,
      bankAccountId: bankAccountId || null,
      comment: comment || null,
    };
    if (isOther) {
      payload.amount = Number(workAmount);
      payload.paymentAmount = Number(amount);
      payload.executorId = executorId;
      payload.executionMonth = Number(periodMonth);
      payload.executionYear = Number(periodYear);
    } else {
      if (!amountLocked) {
        payload.amount = Number(amount);
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/payouts/${row.sourceType}:${row.sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Не удалось сохранить");
        return;
      }
      toast.success("Изменения сохранены");
      await onSaved();
    } catch {
      toast.error("Не удалось сохранить");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Выплата: {row.executorName}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-md bg-neutral-50 border border-neutral-200 px-3 py-2 text-sm space-y-1">
            <div>
              <span className="text-neutral-500">Тип сметы: </span>
              <span className="font-medium">
                {isPersonal ? "Личная смета" : "Прочие траты"}
              </span>
            </div>
            <div>
              <span className="text-neutral-500">Год оплаты (план-факт): </span>
              <span className="font-medium tabular-nums">
                {row.yearPlanFact ?? "—"}
              </span>
            </div>
          </div>

          {!isPersonal && (
            <>
              <div className="space-y-2 min-w-0">
                <Label htmlFor="executorId">Исполнитель</Label>
                <SearchableSelect
                  id="executorId"
                  value={executorId}
                  onValueChange={setExecutorId}
                  options={activeExecutors.map((e) => ({
                    value: e.id,
                    label: `${e.name}${e.status === "archived" ? " (архив)" : ""}`,
                  }))}
                  placeholder="Выберите исполнителя"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2 min-w-0">
                  <Label htmlFor="periodMonth">Месяц выполнения</Label>
                  <Select value={periodMonth} onValueChange={(v) => setPeriodMonth(v ?? "")}>
                    <SelectTrigger id="periodMonth">
                      <SelectValue>
                        {MONTHS.find((m) => m.value === periodMonth)?.label ?? periodMonth}
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
                  <Label htmlFor="periodYear">Год выполнения</Label>
                  <Input
                    id="periodYear"
                    type="number"
                    value={periodYear}
                    onChange={(e) => setPeriodYear(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          {isOther ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2 min-w-0">
                  <Label htmlFor="workAmount">Сумма работы</Label>
                  <Input
                    id="workAmount"
                    type="number"
                    step="0.01"
                    value={workAmount}
                    onChange={(e) => setWorkAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2 min-w-0">
                  <Label htmlFor="amount">Сумма выплаты</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>
              </div>
              {otherAmountsMismatch && (
                <p className="text-xs text-amber-600">
                  Сумма работы и сумма выплаты не равны
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2 min-w-0">
              <Label htmlFor="amount">Сумма выплаты</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={amountLocked}
                required
              />
              {amountLocked && (
                <p className="text-xs text-amber-700">
                  Сумма выплаты привязана к работам. Изменение суммы доступно только через Личную смету исполнителя
                </p>
              )}
            </div>
          )}

          <div className="space-y-2 min-w-0">
            <Label htmlFor="paymentStatus">Статус выплаты</Label>
            <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v ?? "")}>
              <SelectTrigger id="paymentStatus">
                <SelectValue>
                  {PAYMENT_STATUSES[paymentStatus as keyof typeof PAYMENT_STATUSES]?.label ?? paymentStatus}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PAYMENT_STATUSES).map(([value, { label }]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2 min-w-0">
              <Label htmlFor="plannedPayAt">Дата оплаты — план</Label>
              <DateInput
                id="plannedPayAt"
                value={plannedPayAt}
                onChange={(e) => setPlannedPayAt(e.target.value)}
              />
            </div>
            <div className="space-y-2 min-w-0">
              <Label htmlFor="paidAt">Дата оплаты</Label>
              <DateInput
                id="paidAt"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2 min-w-0">
            <Label htmlFor="bankAccountId">Источник оплаты</Label>
            <SearchableSelect
              id="bankAccountId"
              value={bankAccountId || "__none__"}
              onValueChange={(v) => setBankAccountId(v === "__none__" ? "" : v)}
              options={[
                { value: "__none__", label: "— Не задан —" },
                ...activeBanks.map((b) => ({
                  value: b.id,
                  label: `${b.name}${b.status === "archived" ? " (архив)" : ""}`,
                })),
              ]}
            />
          </div>

          <div className="space-y-2 min-w-0">
            <Label htmlFor="comment">Комментарий</Label>
            <Textarea
              id="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
            />
          </div>

          <EntityActivityHistory
            entityType={isPersonal ? "Payment" : "OtherExpense"}
            entityId={row.sourceId}
          />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={submitting || !otherAmountsValid || otherAmountsMismatch}
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
