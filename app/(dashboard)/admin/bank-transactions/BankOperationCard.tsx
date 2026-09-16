"use client";

/**
 * Карточка операции: слева выписка как пришла из банка, справа разбор с правкой.
 *
 * Под каждым определённым значением — трассировка: откуда оно взялось.
 * Контрагент выбирается из справочника, а не вводится текстом: тип контрагента
 * берётся из его карточки. После смены контрагента показывается блок
 * «запоминать по» — признаки в нём берутся только из полей этой операции, и
 * выбранный признак превращается в правило разбора.
 */

import * as React from "react";
import { toast } from "sonner";
import { Link2, Sparkles, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { EntityActivityHistory } from "@/components/ui-custom/EntityActivityHistory";
import {
  BANK_CHARGE_MATCH_STATES,
  BANK_COUNTERPARTY_TYPES,
  BANK_OPERATION_KINDS,
  BANK_OPERATION_STATUSES,
} from "@/lib/statuses";
import { formatDate, formatMoney, monthFullLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { determineOperationKind, statementFieldLabels } from "@/lib/statement-formats";
import type { BankOperation, ChargeCandidate, CounterpartyOption, OptionRow } from "./types";
import { ChargeLinkDialog } from "./ChargeLinkDialog";
import { CounterpartyDialog } from "../counterparties/CounterpartyDialog";
import type { LinkOption } from "../counterparties/types";

const NONE = "__none__";

type RememberBy = "name" | "account" | "inn";

export function BankOperationCard({
  operation,
  projects,
  workTypes,
  chargeCandidates,
  counterparties,
  executorOptions,
  clientOptions,
  bankAccountOptions,
  onCounterpartiesChanged,
  onClose,
  onSaved,
}: {
  operation: BankOperation;
  projects: OptionRow[];
  workTypes: OptionRow[];
  chargeCandidates: ChargeCandidate[];
  counterparties: CounterpartyOption[];
  executorOptions: LinkOption[];
  clientOptions: LinkOption[];
  bankAccountOptions: LinkOption[];
  onCounterpartiesChanged: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = React.useState(operation.kind);
  const [isInternal, setIsInternal] = React.useState(operation.isInternalTransfer);
  const [counterpartyId, setCounterpartyId] = React.useState(operation.counterpartyId ?? NONE);
  const [counterpartyDialogOpen, setCounterpartyDialogOpen] = React.useState(false);
  const [projectId, setProjectId] = React.useState(operation.projectId ?? NONE);
  const [workTypeId, setWorkTypeId] = React.useState(operation.workTypeId ?? NONE);
  const [workDescription, setWorkDescription] = React.useState(operation.workDescription ?? "");
  const [paymentOrder, setPaymentOrder] = React.useState(operation.paymentOrder ?? "");
  const [paymentPurpose, setPaymentPurpose] = React.useState(operation.paymentPurpose ?? "");
  const [basis, setBasis] = React.useState(operation.basis ?? "");
  const [comment, setComment] = React.useState(operation.comment ?? "");
  const [status, setStatus] = React.useState(operation.status);
  const [rememberBy, setRememberBy] = React.useState<RememberBy | null>(null);
  const [chargeDialogOpen, setChargeDialogOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const counterpartyChanged = counterpartyId !== (operation.counterpartyId ?? NONE);
  const selectedCounterparty = counterparties.find((c) => c.id === counterpartyId) ?? null;
  const rawLabels = statementFieldLabels(operation.statementFormat);
  const suggestedKind = determineOperationKind(operation.statementFormat, {
    operationType: operation.raw.operationType,
    amount: operation.raw.amount,
  });

  // Запоминать можно только по тем признакам, которые есть в самой операции.
  const rememberOptions: { value: RememberBy; label: string; hint: string }[] = [
    operation.raw.counterparty
      ? { value: "name" as const, label: "по имени в выписке", hint: operation.raw.counterparty }
      : null,
    operation.raw.account
      ? { value: "account" as const, label: "по номеру счёта", hint: operation.raw.account }
      : null,
    operation.raw.inn ? { value: "inn" as const, label: "по ИНН", hint: operation.raw.inn } : null,
  ].filter((o): o is { value: RememberBy; label: string; hint: string } => o !== null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await fetch(`/api/bank-operations/${operation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        isInternalTransfer: isInternal,
        counterpartyId: counterpartyId === NONE ? null : counterpartyId,
        projectId: projectId === NONE ? null : projectId,
        workTypeId: workTypeId === NONE ? null : workTypeId,
        workDescription: workDescription.trim() || null,
        paymentOrder: paymentOrder.trim() || null,
        paymentPurpose: paymentPurpose.trim() || null,
        basis: basis.trim() || null,
        comment: comment.trim() || null,
        status,
        rememberBy: counterpartyChanged ? rememberBy : undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Не удалось сохранить операцию");
      return;
    }
    toast.success("Операция сохранена");
    onSaved();
  }

  async function handleConfirmSuggested() {
    const res = await fetch(`/api/bank-operations/${operation.id}/charges`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        charges: operation.charges.map((c) => ({ chargeId: c.chargeId, amount: c.amount })),
      }),
    });
    if (!res.ok) {
      toast.error("Не удалось подтвердить начисления");
      return;
    }
    toast.success("Начисления подтверждены");
    onSaved();
  }

  async function handleWithoutCharge() {
    const res = await fetch(`/api/bank-operations/${operation.id}/charges`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ charges: [], withoutCharge: true }),
    });
    if (!res.ok) {
      toast.error("Не удалось изменить привязку");
      return;
    }
    toast.success("Операция помечена «без начисления»");
    onSaved();
  }

  const hasSuggested = operation.charges.some((c) => c.link === "suggested");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {formatMoney(operation.amount)} {operation.currency}
            <StatusBadge dict={BANK_OPERATION_STATUSES} value={operation.status} />
            {operation.isInternalTransfer && (
              <StatusBadge tone="blue" label="Внутренний перевод" />
            )}
          </DialogTitle>
          <DialogDescription>
            {formatDate(operation.date)} · {operation.bankAccountName} ·{" "}
            {BANK_OPERATION_KINDS[operation.kind as keyof typeof BANK_OPERATION_KINDS] ??
              operation.kind}
            {operation.confirmedByName && ` · подтвердил ${operation.confirmedByName}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          {/* ── Слева: сырая выписка ─────────────────────────────────────── */}
          <div className="rounded-md border bg-neutral-50 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Как пришло из банка
            </div>
            <dl className="space-y-1.5 text-xs">
              <RawField label="Документ" value={operation.raw.docNumber} />
              <RawField label="Дата" value={operation.raw.date} />
              <RawField
                label="Сумма"
                value={
                  operation.raw.amount
                    ? `${operation.raw.amount} ${operation.raw.currency ?? ""}`.trim()
                    : null
                }
              />
              <RawField label={rawLabels.operationType} value={operation.raw.operationType} />
              <RawField label="Контрагент" value={operation.raw.counterparty} />
              <RawField label={rawLabels.taxId} value={operation.raw.inn} />
              <RawField label={rawLabels.account} value={operation.raw.account} />
              <RawField label={rawLabels.bic} value={operation.raw.bik} />
              <RawField label="Назначение" value={operation.raw.purpose} />
              <RawField label="Категория банка" value={operation.raw.category} />
              <RawField
                label="Период"
                value={`${monthFullLabel(operation.month)} ${operation.year}`}
              />
            </dl>
          </div>

          {/* ── Справа: разбор ───────────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Что определила система
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ветка</Label>
                <SearchableSelect
                  value={kind}
                  onValueChange={setKind}
                  options={Object.entries(BANK_OPERATION_KINDS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
                {suggestedKind && suggestedKind !== kind && (
                  <p className="text-[11px] text-amber-700">
                    По формату выписки это{" "}
                    {BANK_OPERATION_KINDS[suggestedKind]}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Статус</Label>
                <SearchableSelect
                  value={status}
                  onValueChange={setStatus}
                  options={Object.entries(BANK_OPERATION_STATUSES).map(([value, { label }]) => ({
                    value,
                    label,
                  }))}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-neutral-700">
              <Checkbox
                checked={isInternal}
                onCheckedChange={(checked) => setIsInternal(!!checked)}
              />
              Внутренний перевод — не доход и не расход в кэшфлоу
            </label>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Контрагент</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => setCounterpartyDialogOpen(true)}
                >
                  <UserPlus className="mr-1 h-3.5 w-3.5" /> Создать из операции
                </Button>
              </div>
              <SearchableSelect
                value={counterpartyId}
                onValueChange={(value) => {
                  setCounterpartyId(value);
                  const picked = counterparties.find((c) => c.id === value);
                  if (picked?.uniqueProjectId && projectId === NONE) {
                    setProjectId(picked.uniqueProjectId);
                  }
                  if (picked?.uniqueWorkTypeId && workTypeId === NONE) {
                    setWorkTypeId(picked.uniqueWorkTypeId);
                  }
                }}
                options={[
                  { value: NONE, label: "Не определён" },
                  ...counterparties.map((c) => ({
                    value: c.id,
                    label: c.name,
                    searchText: c.searchText,
                  })),
                ]}
                placeholder="Не определён"
                searchPlaceholder="Имя, ИНН, номер счёта..."
              />
              {selectedCounterparty ? (
                <p className="text-xs text-neutral-500">
                  Тип из карточки:{" "}
                  {BANK_COUNTERPARTY_TYPES[
                    selectedCounterparty.kind as keyof typeof BANK_COUNTERPARTY_TYPES
                  ] ?? selectedCounterparty.kind}
                  {selectedCounterparty.status === "archived" && " · в архиве"}
                </p>
              ) : (
                operation.counterpartyName && (
                  <p className="text-xs text-neutral-500">
                    В выписке: {operation.counterpartyName} — в справочнике не сопоставлен
                  </p>
                )
              )}
              <Trace value={operation.trace.counterparty} />
            </div>

            {counterpartyChanged && (
              <div className="rounded-md border border-blue-200 bg-blue-50/60 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-blue-900">
                  <Sparkles className="h-3.5 w-3.5" />
                  Как узнавать этого контрагента дальше
                </div>
                {rememberOptions.length === 0 ? (
                  <p className="text-xs text-neutral-600">
                    В операции нет признаков для запоминания — привязка останется разовой.
                  </p>
                ) : counterpartyId === NONE ? (
                  <p className="text-xs text-neutral-600">
                    Правило создаётся только вместе с контрагентом — сначала выберите его.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {rememberOptions.map((option) => (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-start gap-2 text-xs"
                      >
                        <input
                          type="radio"
                          name="rememberBy"
                          className="mt-0.5"
                          checked={rememberBy === option.value}
                          onChange={() => setRememberBy(option.value)}
                        />
                        <span>
                          {option.label}
                          <span className="ml-1 text-neutral-500">— {option.hint}</span>
                        </span>
                      </label>
                    ))}
                    <label className="flex cursor-pointer items-center gap-2 text-xs">
                      <input
                        type="radio"
                        name="rememberBy"
                        checked={rememberBy === null}
                        onChange={() => setRememberBy(null)}
                      />
                      не запоминать, привязка разовая
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Проект</Label>
              <SearchableSelect
                value={projectId}
                onValueChange={setProjectId}
                options={[
                  { value: NONE, label: "Не определён" },
                  ...projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              <Trace value={operation.trace.project} />
            </div>

            <div className="space-y-1.5">
              <Label>Вид работ</Label>
              <SearchableSelect
                value={workTypeId}
                onValueChange={setWorkTypeId}
                options={[
                  { value: NONE, label: "Не определён" },
                  ...workTypes.map((w) => ({ value: w.id, label: w.name })),
                ]}
              />
              <Trace value={operation.trace.workType} />
            </div>

            {kind === "incoming" && !isInternal && (
              <div className="space-y-1.5">
                <Label htmlFor="paymentOrder">Платёжное поручение</Label>
                <Input
                  id="paymentOrder"
                  value={paymentOrder}
                  onChange={(e) => setPaymentOrder(e.target.value)}
                  placeholder="ПП 415"
                />
              </div>
            )}

            {kind === "outgoing" && !isInternal && (
              <div className="space-y-1.5">
                <Label htmlFor="paymentPurpose">Назначение платежа</Label>
                <Input
                  id="paymentPurpose"
                  value={paymentPurpose}
                  onChange={(e) => setPaymentPurpose(e.target.value)}
                />
              </div>
            )}

            {isInternal && (
              <div className="space-y-1.5">
                <Label htmlFor="basis">Основание</Label>
                <Input id="basis" value={basis} onChange={(e) => setBasis(e.target.value)} />
                {operation.pairedAccountName && (
                  <p className="text-xs text-neutral-500">
                    Пара найдена: {operation.bankAccountName} → {operation.pairedAccountName}
                  </p>
                )}
                {!operation.pairedOperationId && (
                  <p className="text-xs text-amber-700">
                    Пара не найдена — вторая половина перевода ещё не пришла в выписке.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="workDescription">Описание работы</Label>
              <Textarea
                id="workDescription"
                value={workDescription}
                onChange={(e) => setWorkDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="comment">Комментарий</Label>
              <Input
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            <DialogFooter className="mx-0 mb-0 rounded-md border">
              <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
                Отмена
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Сохранение..." : "Сохранить"}
              </Button>
            </DialogFooter>
          </form>
        </div>

        {/* ── Начисления: только для пополнений ──────────────────────────── */}
        {operation.kind === "incoming" && !operation.isInternalTransfer && (
          <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Начисления
              </span>
              {operation.chargeMatch && (
                <StatusBadge
                  dict={BANK_CHARGE_MATCH_STATES}
                  value={operation.chargeMatch}
                />
              )}
            </div>

            {operation.charges.length === 0 ? (
              <p className="text-xs text-neutral-500">
                {operation.chargeMatch === "no_charge"
                  ? "Операция помечена «без начисления» и в сверку не попадает."
                  : "Начисление не привязано — подберите вручную."}
              </p>
            ) : (
              <div className="space-y-1.5">
                {operation.charges.map((c) => (
                  <div
                    key={c.chargeId}
                    className="flex items-center gap-2 rounded-sm bg-neutral-50 px-2 py-1.5 text-xs"
                  >
                    <Link2 className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                    <span className="font-medium">{c.chargeNumber}</span>
                    {c.invoiceNumber && (
                      <span className="text-neutral-500">счёт {c.invoiceNumber}</span>
                    )}
                    <span className="truncate text-neutral-500">{c.projectName ?? "—"}</span>
                    <span className="ml-auto shrink-0 tabular-nums">
                      {formatMoney(c.amount ?? c.chargeAmount)} из {formatMoney(c.chargeAmount)}
                    </span>
                    {c.link === "suggested" && (
                      <StatusBadge tone="yellow" label={c.reason ?? "предложено"} />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {hasSuggested && (
                <Button size="sm" onClick={handleConfirmSuggested}>
                  Подтвердить предложенное
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setChargeDialogOpen(true)}>
                {operation.charges.length ? "Изменить привязку" : "Привязать начисление"}
              </Button>
              {operation.chargeMatch !== "no_charge" && (
                <Button size="sm" variant="ghost" onClick={handleWithoutCharge}>
                  Без начисления
                </Button>
              )}
            </div>
          </div>
        )}

        <EntityActivityHistory entityType="BankOperation" entityId={operation.id} />

        {counterpartyDialogOpen && (
          <CounterpartyDialog
            row={null}
            prefill={{
              name: operation.raw.counterparty ?? operation.counterpartyName ?? "",
              alias: operation.raw.counterparty ?? undefined,
              taxId: operation.raw.inn ?? undefined,
              accountNumber: operation.raw.account ?? undefined,
            }}
            executors={executorOptions}
            clients={clientOptions}
            bankAccounts={bankAccountOptions}
            onClose={() => setCounterpartyDialogOpen(false)}
            onSaved={(newId) => {
              setCounterpartyDialogOpen(false);
              setCounterpartyId(newId);
              onCounterpartiesChanged();
            }}
          />
        )}

        {chargeDialogOpen && (
          <ChargeLinkDialog
            operation={operation}
            candidates={chargeCandidates}
            onClose={() => setChargeDialogOpen(false)}
            onSaved={() => {
              setChargeDialogOpen(false);
              onSaved();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RawField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <dt className="text-neutral-500">{label}</dt>
      <dd className={cn("break-words", value ? "text-neutral-800" : "text-neutral-400")}>
        {value || "—"}
      </dd>
    </div>
  );
}

/** Трассировка: откуда взялось значение. Без источника поле считается неразобранным. */
function Trace({ value }: { value: string | null }) {
  if (!value) return <p className="text-xs text-neutral-400">источник не определён</p>;
  return <p className="text-xs text-neutral-500">{value}</p>;
}
