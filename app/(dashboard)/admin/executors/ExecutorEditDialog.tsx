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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { WorkTypesMultiSelect } from "@/components/ui-custom/WorkTypesMultiSelect";
import { RecipientTypesPicker } from "@/components/ui-custom/RecipientTypesPicker";
import { CompanyStatusPicker } from "@/components/ui-custom/CompanyStatusPicker";
import { EXECUTOR_TYPES, parseCompanyStatus, serializeCompanyStatus } from "@/lib/statuses";
import { normalizeExecutorType } from "@/lib/executor-type";
import { sortByNameRu, sortByRu } from "@/lib/sort";
import type { ExecutorRow } from "./ExecutorsClient";

type BankOption = { id: string; name: string; status: string };
type ResponsibleOption = { id: string; fullName: string; isActive: boolean };
type WorkTypeOption = { id: string; name: string; status: string; segment?: string };

export function ExecutorEditDialog({
  row,
  bankAccounts: bankAccountsProp,
  responsibles: responsiblesProp,
  workTypes,
  onClose,
  onSaved,
}: {
  row: ExecutorRow;
  bankAccounts: BankOption[];
  responsibles: ResponsibleOption[];
  workTypes: WorkTypeOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const bankAccounts = React.useMemo(() => sortByNameRu(bankAccountsProp), [bankAccountsProp]);
  const responsibles = React.useMemo(() => sortByRu(responsiblesProp, (r) => r.fullName), [responsiblesProp]);
  const [name, setName] = React.useState(row.name);
  const [companyStatuses, setCompanyStatuses] = React.useState<string[]>(() =>
    parseCompanyStatus(row.companyStatus)
  );
  const [specialty, setSpecialty] = React.useState(row.specialty ?? "");
  const [contacts, setContacts] = React.useState(row.contacts ?? "");
  const [contactEmail, setContactEmail] = React.useState(row.contactEmail ?? "");
  const [requisites, setRequisites] = React.useState(row.requisites ?? "");
  const [recipientTypes, setRecipientTypes] = React.useState<string[]>(row.recipientTypes);
  const [responsibleUserId, setResponsibleUserId] = React.useState(row.responsibleUserId ?? "");
  const [defaultBankAccountId, setDefaultBankAccountId] = React.useState(
    row.defaultBankAccountId ?? ""
  );
  const [workTypeIds, setWorkTypeIds] = React.useState<string[]>(row.workTypeIds);
  const [submitting, setSubmitting] = React.useState(false);

  const normalizedType = normalizeExecutorType(row.type);
  const isPermanent = normalizedType === "permanent";
  const typeName = EXECUTOR_TYPES[normalizedType] ?? row.type;

  const workTypeOptions = React.useMemo(
    () =>
      workTypes
        .filter((w) => w.status === "active" || workTypeIds.includes(w.id))
        .map((w) => ({ id: w.id, name: w.name, segment: w.segment, status: w.status })),
    [workTypes, workTypeIds]
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Введите имя");

    setSubmitting(true);
    const res = await fetch(`/api/executors/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        companyStatus: serializeCompanyStatus(companyStatuses),
        specialty: specialty || null,
        contacts: contacts || null,
        contactEmail: contactEmail.trim().toLowerCase() || null,
        requisites: requisites || null,
        recipientTypes,
        responsibleUserId: responsibleUserId || null,
        defaultBankAccountId: defaultBankAccountId || null,
        workTypeIds,
      }),
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Редактирование: {row.name}</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">Тип:</span>
            <span className="text-xs font-medium text-neutral-700 bg-neutral-100 rounded px-2 py-0.5">{typeName}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Исполнитель <span className="font-normal text-neutral-400">(ФИ, название компании, сервиса)</span></Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            {isPermanent && (
              <div className="space-y-1.5">
                <Label>Статус в компании</Label>
                <CompanyStatusPicker value={companyStatuses} onChange={setCompanyStatuses} />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Виды работ</Label>
            {workTypes.length === 0 ? (
              <span className="text-sm text-neutral-500">Сначала создайте виды работ</span>
            ) : (
              <WorkTypesMultiSelect
                options={workTypeOptions}
                value={workTypeIds}
                onChange={setWorkTypeIds}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="responsible">Ответственный (account-менеджер)</Label>
              <SearchableSelect
                id="responsible"
                value={responsibleUserId || "__none__"}
                onValueChange={(v) => setResponsibleUserId(v === "__none__" ? "" : v)}
                options={[
                  { value: "__none__", label: "— Не задан —" },
                  ...responsibles
                    .filter((responsible) => responsible.isActive || responsible.id === responsibleUserId)
                    .map((responsible) => ({
                      value: responsible.id,
                      label: `${responsible.fullName}${!responsible.isActive ? " (архив)" : ""}`,
                    })),
                ]}
                placeholder={responsibleUserId}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="defaultBank">Источник оплаты</Label>
              <SearchableSelect
                id="defaultBank"
                value={defaultBankAccountId || "__none__"}
                onValueChange={(v) => setDefaultBankAccountId(v === "__none__" ? "" : v)}
                options={[
                  { value: "__none__", label: "— Не задан —" },
                  ...bankAccounts
                    .filter((bankAccount) => bankAccount.status === "active" || bankAccount.id === defaultBankAccountId)
                    .map((bankAccount) => ({
                      value: bankAccount.id,
                      label: `${bankAccount.name}${bankAccount.status === "archived" ? " (архив)" : ""}`,
                    })),
                ]}
                placeholder={defaultBankAccountId}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label>Тип получателя</Label>
              <RecipientTypesPicker value={recipientTypes} onChange={setRecipientTypes} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="specialty">Специальность</Label>
              <Input
                id="specialty"
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="requisites">Реквизиты</Label>
            <Textarea
              id="requisites"
              value={requisites}
              onChange={(e) => setRequisites(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contacts">Контакт общее</Label>
            <Textarea
              id="contacts"
              value={contacts}
              onChange={(e) => setContacts(e.target.value)}
              rows={2}
              placeholder="Мессенджеры, телефоны и т.п."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contactEmail">Контакт email</Label>
            <Input
              id="contactEmail"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
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
