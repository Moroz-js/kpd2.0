"use client";

import React, { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkTypesMultiSelect } from "@/components/ui-custom/WorkTypesMultiSelect";
import { RecipientTypesPicker } from "@/components/ui-custom/RecipientTypesPicker";
import { EXECUTOR_TYPES, WORK_TYPE_SEGMENTS, parseCompanyStatus, serializeCompanyStatus } from "@/lib/statuses";
import { parseRecipientTypes } from "@/lib/executor-recipient-type";
import { CompanyStatusPicker } from "@/components/ui-custom/CompanyStatusPicker";
import {
  canBeResponsible,
  EXECUTOR_TYPE_OPTIONS,
  normalizeExecutorType,
} from "@/lib/executor-type";
import type { ExecutorType } from "@/lib/statuses";
import { sortByNameRu } from "@/lib/sort";
import { RefreshCw, X } from "lucide-react";

function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%";
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

type BankAccount = { id: string; name: string };
type WorkType = { id: string; name: string; segment?: string };
type PlanProject = { id: string; name: string };

type ExecutorDetail = {
  id: string;
  name: string;
  type: string;
  status: string;
  companyStatus: string | null;
  accessRevokedAt: string | null;
  contacts: string | null;
  contactEmail: string | null;
  accessEmail: string | null;
  requisites: string | null;
  recipientType: string | null;
  defaultBankAccountId: string | null;
  specialties: string | null;
  contractFile: string | null;
  ndaFile: string | null;
  note: string | null;
  inTgChat: boolean;
  isResponsible: boolean;
  responsibleActive: boolean;
  user: { id: string; email: string; fullName: string; role: string; isActive: boolean } | null;
  executorWorkTypes: { workType: WorkType }[];
};

type Props = {
  executorId: string;
  executor: ExecutorDetail;
  bankAccounts: BankAccount[];
  allWorkTypes: WorkType[];
  onChanged: () => void;
  /** Полный доступ: смена типа, учётка, доступ, роль ответственного. */
  isAdmin?: boolean;
  /** Может назначать/снимать роль admin (только супер-админ). */
  viewerIsSuperAdmin?: boolean;
  /** Может редактировать поля профиля (false — только просмотр). */
  canEdit?: boolean;
};

export function SettingsTab({
  executorId,
  executor,
  bankAccounts: bankAccountsProp,
  allWorkTypes,
  onChanged,
  isAdmin = false,
  viewerIsSuperAdmin = false,
  canEdit = true,
}: Props) {
  const bankAccounts = useMemo(() => sortByNameRu(bankAccountsProp), [bankAccountsProp]);
  const [executorType, setExecutorType] = useState<ExecutorType>(() =>
    normalizeExecutorType(executor.type)
  );
  const isPermanent = executorType === "permanent";
  const isService = executorType === "service";
  const [fullName, setFullName] = useState(executor.user?.fullName ?? executor.name);
  const [password, setPassword] = useState(() => generatePassword());
  const [companyStatuses, setCompanyStatuses] = useState<string[]>(() =>
    parseCompanyStatus(executor.companyStatus)
  );
  const [contacts, setContacts] = useState(executor.contacts ?? "");
  const [contactEmail, setContactEmail] = useState(executor.contactEmail ?? "");
  const [requisites, setRequisites] = useState(executor.requisites ?? "");
  const [note, setNote] = useState(executor.note ?? "");
  const [contractFile, setContractFile] = useState(executor.contractFile ?? "");
  const [ndaFile, setNdaFile] = useState(executor.ndaFile ?? "");
  const [inTgChat, setInTgChat] = useState(executor.inTgChat);
  const [recipientTypes, setRecipientTypes] = useState<string[]>(() =>
    parseRecipientTypes(executor.recipientType)
  );
  const [defaultBankAccountId, setDefaultBankAccountId] = useState(
    executor.defaultBankAccountId ?? ""
  );
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>(() => {
    try {
      return JSON.parse(executor.specialties ?? "[]");
    } catch {
      return [];
    }
  });
  const [selectedWorkTypeIds, setSelectedWorkTypeIds] = useState<string[]>(
    executor.executorWorkTypes.map((ewt) => ewt.workType.id)
  );
  const [isResponsible, setIsResponsible] = useState(executor.isResponsible ?? false);
  const [executorStatus, setExecutorStatus] = useState<"active" | "archived">(
    executor.status === "archived" ? "archived" : "active"
  );
  const executorArchived = executorStatus === "archived";
  const [planProjects, setPlanProjects] = useState<PlanProject[]>([]);
  const [loadingPlanProjects, setLoadingPlanProjects] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingAccess, setTogglingAccess] = useState(false);
  const [accessDialogOpen, setAccessDialogOpen] = useState(false);
  const [grantAccessEmail, setGrantAccessEmail] = useState(
    executor.accessEmail ?? executor.user?.email ?? ""
  );
  const hasAccess = Boolean(
    executor.accessEmail?.trim() && !executor.accessRevokedAt && executor.user?.isActive
  );

  // Сброс пароля администратором
  const [adminResettingPassword, setAdminResettingPassword] = useState(false);
  // Флаг роли пользователя (для чекбокса «Администратор»)
  const [isUserAdmin, setIsUserAdmin] = useState(executor.user ? executor.user.role === "admin" : false);

  async function handleAdminResetPassword() {
    if (!executor.user) return;
    setAdminResettingPassword(true);
    try {
      const newPwd = generatePassword();
      const r = await fetch(`/api/users/${executor.user.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPwd }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Не удалось сбросить пароль");
      }
      await navigator.clipboard.writeText(newPwd);
      toast.success("Пароль сброшен и скопирован в буфер обмена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setAdminResettingPassword(false);
    }
  }

  useEffect(() => {
    setExecutorType(normalizeExecutorType(executor.type));
    setFullName(executor.user?.fullName ?? executor.name);
    setCompanyStatuses(parseCompanyStatus(executor.companyStatus));
    setContacts(executor.contacts ?? "");
    setContactEmail(executor.contactEmail ?? "");
    setGrantAccessEmail(executor.accessEmail ?? executor.user?.email ?? "");
    setRequisites(executor.requisites ?? "");
    setNote(executor.note ?? "");
    setContractFile(executor.contractFile ?? "");
    setNdaFile(executor.ndaFile ?? "");
    setInTgChat(executor.inTgChat);
    setRecipientTypes(parseRecipientTypes(executor.recipientType));
    setDefaultBankAccountId(executor.defaultBankAccountId ?? "");
    setExecutorStatus(executor.status === "archived" ? "archived" : "active");
    setIsResponsible(executor.isResponsible ?? false);
    setIsUserAdmin(executor.user ? executor.user.role === "admin" : false);
    setSelectedWorkTypeIds(executor.executorWorkTypes.map((ewt) => ewt.workType.id));
    try {
      setSelectedSpecialties(JSON.parse(executor.specialties ?? "[]"));
    } catch {
      setSelectedSpecialties([]);
    }
  }, [executor]);

  useEffect(() => {
    setLoadingPlanProjects(true);
    fetch(`/api/executors/${executorId}/plan-projects`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((list: PlanProject[]) => setPlanProjects(list))
      .catch(() => setPlanProjects([]))
      .finally(() => setLoadingPlanProjects(false));
  }, [executorId]);

  function handleTypeChange(next: ExecutorType) {
    setExecutorType(next);
    if (!canBeResponsible(next)) setIsResponsible(false);
  }

  async function handleToggleAccess() {
    if (!hasAccess) {
      setAccessDialogOpen(true);
      return;
    }
    setTogglingAccess(true);
    try {
      const r = await fetch(`/api/executors/${executorId}/access`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error();
      toast.success("Доступ отозван");
      onChanged();
    } catch {
      toast.error("Не удалось изменить доступ");
    } finally {
      setTogglingAccess(false);
    }
  }

  async function handleGrantAccess() {
    if (!grantAccessEmail.trim()) return toast.error("Введите Email для доступа");
    if (!executor.user && password.length < 6) {
      return toast.error("Пароль не короче 6 символов");
    }
    setTogglingAccess(true);
    try {
      const r = await fetch(`/api/executors/${executorId}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessEmail: grantAccessEmail.trim().toLowerCase(),
          ...(!executor.user && { password }),
        }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        error?: string;
        warning?: string | null;
      };
      if (!r.ok) throw new Error(body.error ?? "Не удалось дать доступ");
      toast.success("Доступ выдан");
      if (body.warning) toast.warning(body.warning);
      setAccessDialogOpen(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось дать доступ");
    } finally {
      setTogglingAccess(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        type: executorType,
        status: executorStatus,
        name: fullName.trim(),
        companyStatus: isPermanent ? serializeCompanyStatus(companyStatuses) : null,
        contacts: contacts || null,
        contactEmail: contactEmail.trim().toLowerCase() || null,
        requisites: requisites || null,
        note: note || null,
        inTgChat: isService ? false : inTgChat,
        contractFile: isService ? null : contractFile.trim() || null,
        ndaFile: isService ? null : ndaFile.trim() || null,
        recipientTypes,
        defaultBankAccountId: defaultBankAccountId || null,
        specialties: JSON.stringify(selectedSpecialties),
        isResponsible: canBeResponsible(executorType) ? isResponsible : false,
        workTypeIds: selectedWorkTypeIds,
      };
      const r = await fetch(`/api/executors/${executorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Ошибка сохранения");
      }

      if (isAdmin && executor.user) {
        const userPatch: Record<string, unknown> = {
          fullName: fullName || undefined,
        };
        if (viewerIsSuperAdmin) {
          userPatch.role = isUserAdmin ? "admin" : "executor";
        }
        const ur = await fetch(`/api/users/${executor.user.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(userPatch),
        });
        if (!ur.ok) throw new Error("Ошибка обновления пользователя");
      }

      toast.success("Настройки сохранены");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
      setIsResponsible(executor.isResponsible ?? false);
      setExecutorType(normalizeExecutorType(executor.type));
    } finally {
      setSaving(false);
    }
  }

  function toggleSpecialty(s: string) {
    setSelectedSpecialties((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      {isAdmin && (
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-neutral-800">Тип и статус</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Тип исполнителя</Label>
              <Select
                value={executorType}
                onValueChange={(v) => v && handleTypeChange(v as ExecutorType)}
              >
                <SelectTrigger>
                  <SelectValue>{EXECUTOR_TYPES[executorType]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {EXECUTOR_TYPE_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Статус</Label>
              <Select
                value={executorStatus}
                onValueChange={(v) => v && setExecutorStatus(v as "active" | "archived")}
              >
                <SelectTrigger>
                  <SelectValue>
                    {executorStatus === "active" ? "Активный" : "Архивный"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активный</SelectItem>
                  <SelectItem value="archived">Архивный</SelectItem>
                </SelectContent>
              </Select>
              {executorStatus === "archived" && executor.status === "active" && (
                <p className="text-xs text-amber-600">
                  При сохранении доступ к системе будет отозван
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-800">Контакт email и доступ</h3>
        <div className="space-y-1.5">
          <Label>Контакт email</Label>
          <Input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            disabled={!canEdit}
            placeholder="contact@example.com"
          />
        </div>
        {isAdmin && (
          <>
            <div className="space-y-1.5">
              <Label>Email для доступа</Label>
              <Input
                value={executor.accessEmail ?? ""}
                readOnly
                placeholder="Доступ не выдан"
                className="bg-neutral-50"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span
                  className={`text-sm font-medium ${hasAccess ? "text-green-700" : "text-red-600"}`}
                >
                  {hasAccess ? "Доступ активен" : "Доступ не выдан"}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleAccess}
                disabled={togglingAccess || executorArchived}
                className={
                  hasAccess
                    ? "border-red-300 text-red-600 hover:bg-red-50"
                    : "border-green-300 text-green-700 hover:bg-green-50"
                }
              >
                {hasAccess ? "Отозвать доступ" : "Дать доступ"}
              </Button>
            </div>
          </>
        )}
      </div>

      {isAdmin && executor.user && (
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-neutral-800">Сброс пароля</h3>
          <p className="text-xs text-neutral-500">
            Будет сгенерирован случайный пароль и автоматически скопирован в буфер обмена — сообщите его пользователю.
          </p>
          <p className="text-xs text-amber-700">
            Текущий пароль посмотреть невозможно по соображениям безопасности.
          </p>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={handleAdminResetPassword}
              disabled={adminResettingPassword}
            >
              {adminResettingPassword ? "Сброс..." : "Сбросить"}
            </Button>
          </div>
        </div>
      )}

      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-800">Профиль</h3>
        <div className="space-y-1.5">
          <Label>
            Исполнитель{" "}
            <span className="font-normal text-neutral-400">
              (ФИ, название компании, сервиса и т.д.)
            </span>
          </Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={!canEdit} />
          {isService && fullName.trim() && canEdit && (
            <p className="text-xs text-neutral-500">
              Сохранится как: <span className="font-medium">{fullName.trim().toUpperCase()}</span>
            </p>
          )}
        </div>
        {isPermanent && (
          <div className="space-y-1.5">
            <Label>Статус в компании</Label>
            <CompanyStatusPicker value={companyStatuses} onChange={setCompanyStatuses} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Контакт общее</Label>
          <Input
            value={contacts}
            onChange={(e) => setContacts(e.target.value)}
            placeholder="Телеграм, телефон и т.д."
            disabled={!canEdit}
          />
        </div>
        {isAdmin && canBeResponsible(executorType) && (
          <div className="flex flex-col gap-1 pt-1">
            <div className="flex items-center gap-2">
              <Checkbox
                id="isResponsible"
                checked={isResponsible}
                disabled={executorArchived}
                onCheckedChange={(v) => setIsResponsible(Boolean(v))}
              />
              <Label
                htmlFor="isResponsible"
                className={executorArchived ? "text-neutral-400" : "cursor-pointer"}
              >
                Назначить руководителем проекта
              </Label>
            </div>
            {executorArchived && (
              <p className="text-xs text-neutral-500 pl-6">
                Архивного исполнителя нельзя назначить руководителем проекта.
              </p>
            )}
            {isResponsible &&
              !executorArchived &&
              executor.isResponsible &&
              !executor.responsibleActive && (
                <p className="text-xs text-amber-700 pl-6">
                  Роль руководителя проекта в архиве — исполнитель при этом может оставаться активным.
                </p>
              )}
          </div>
        )}
        {viewerIsSuperAdmin && executor.user && (
          <div className="flex flex-col gap-1 pt-1">
            <div className="flex items-center gap-2">
              <Checkbox
                id="isUserAdmin"
                checked={isUserAdmin}
                onCheckedChange={(v) => setIsUserAdmin(Boolean(v))}
              />
              <Label htmlFor="isUserAdmin" className="cursor-pointer">
                Администратор
              </Label>
            </div>
            <p className="text-xs text-neutral-500 pl-6">
              Назначить пользователю полный доступ администратора.
            </p>
          </div>
        )}
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-800">Оплата</h3>
        <div className="space-y-1.5">
          <Label>Реквизиты</Label>
          <Input
            value={requisites}
            onChange={(e) => setRequisites(e.target.value)}
            placeholder="ИНН, расчётный счёт и т.д."
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Источник оплаты по умолчанию</Label>
          <Select value={defaultBankAccountId} onValueChange={(v) => setDefaultBankAccountId(v ?? "")} disabled={!canEdit}>
            <SelectTrigger>
              <SelectValue>
                {defaultBankAccountId
                  ? (bankAccounts.find((b) => b.id === defaultBankAccountId)?.name ?? "—")
                  : "— Не задан —"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">— Не задан —</SelectItem>
              {bankAccounts.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Тип получателя</Label>
          <RecipientTypesPicker value={recipientTypes} onChange={setRecipientTypes} disabled={!canEdit} />
        </div>
      </div>

      {!isService && (
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-neutral-800">Документы</h3>
          <div className="space-y-1.5">
            <Label>Договор (ссылка)</Label>
            <Input
              value={contractFile}
              onChange={(e) => setContractFile(e.target.value)}
              placeholder="https://..."
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1.5">
            <Label>NDA (ссылка)</Label>
            <Input
              value={ndaFile}
              onChange={(e) => setNdaFile(e.target.value)}
              placeholder="https://..."
              disabled={!canEdit}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="inTgChat"
              checked={inTgChat}
              onCheckedChange={(v) => setInTgChat(Boolean(v))}
              disabled={!canEdit}
            />
            <Label htmlFor="inTgChat" className={canEdit ? "cursor-pointer" : "text-neutral-400"}>
              В чате Telegram
            </Label>
          </div>
        </div>
      )}

      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-800">Примечание</h3>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Внутренние заметки"
          disabled={!canEdit}
        />
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-800">Специальности</h3>
        <div className="flex flex-wrap gap-2">
          {WORK_TYPE_SEGMENTS.map((seg) => {
            const selected = selectedSpecialties.includes(seg);
            return (
              <button
                key={seg}
                type="button"
                onClick={() => canEdit && toggleSpecialty(seg)}
                disabled={!canEdit}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  selected
                    ? "bg-violet-100 border-violet-300 text-violet-800"
                    : "bg-neutral-50 border-neutral-200 text-neutral-600 hover:bg-neutral-100"
                } ${!canEdit ? "opacity-60 cursor-default pointer-events-none" : ""}`}
              >
                {seg}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-800">Виды работ</h3>
        {selectedWorkTypeIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedWorkTypeIds.map((id) => {
              const wt = allWorkTypes.find((w) => w.id === id);
              if (!wt) return null;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full bg-neutral-100 border border-neutral-200 px-2.5 py-0.5 text-xs font-medium text-neutral-700"
                >
                  {wt.name}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setSelectedWorkTypeIds(selectedWorkTypeIds.filter((x) => x !== id))}
                      className="ml-0.5 rounded-full hover:bg-neutral-300 p-0.5"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
        {canEdit && (
          allWorkTypes.length === 0 ? (
            <span className="text-xs text-neutral-400">Нет доступных видов работ</span>
          ) : (
            <WorkTypesMultiSelect
              options={allWorkTypes.map((wt) => ({
                id: wt.id,
                name: wt.name,
                segment: wt.segment,
              }))}
              value={selectedWorkTypeIds}
              onChange={setSelectedWorkTypeIds}
            />
          )
        )}
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-800">Проекты</h3>
        {loadingPlanProjects ? (
          <p className="text-xs text-neutral-400">Загрузка…</p>
        ) : planProjects.length === 0 ? (
          <p className="text-xs text-neutral-400">
            Нет проектов в плане расходов. Руководитель добавляет строку с этим исполнителем в
            дашборде проекта.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {planProjects.map((project) => (
              <span
                key={project.id}
                className="rounded-full border px-3 py-1 text-xs font-medium bg-neutral-100 border-neutral-200 text-neutral-700"
              >
                {project.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Сохранение..." : "Сохранить настройки"}
          </Button>
        </div>
      )}

      <Dialog open={accessDialogOpen} onOpenChange={setAccessDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Дать доступ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="grantAccessEmail">Email для доступа *</Label>
              <Input
                id="grantAccessEmail"
                type="email"
                value={grantAccessEmail}
                onChange={(e) => setGrantAccessEmail(e.target.value)}
                placeholder="executor@example.com"
              />
            </div>
            {!executor.user && (
              <div className="space-y-1.5">
                <Label htmlFor="grantPassword">Пароль *</Label>
                <div className="flex gap-2">
                  <Input
                    id="grantPassword"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setPassword(generatePassword())}
                    title="Сгенерировать"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            {grantAccessEmail.trim().toLowerCase() !== contactEmail.trim().toLowerCase() && (
              <p className="text-xs text-amber-700">
                Поле &quot;Контакт email&quot; не перезаписывается автоматически. При необходимости
                исправьте его вручную.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAccessDialogOpen(false)}
              disabled={togglingAccess}
            >
              Отмена
            </Button>
            <Button type="button" onClick={handleGrantAccess} disabled={togglingAccess}>
              {togglingAccess ? "Выдача..." : "Дать доступ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
