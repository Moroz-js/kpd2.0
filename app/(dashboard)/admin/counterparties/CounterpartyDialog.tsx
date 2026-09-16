"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DepartmentCombobox } from "@/components/ui-custom/DepartmentCombobox";
import { EntityActivityHistory } from "@/components/ui-custom/EntityActivityHistory";
import { COUNTERPARTY_ALIAS_SOURCES, COUNTERPARTY_LEGAL_TYPES } from "@/lib/statuses";
import {
  splitRequisites,
  type AccountDraft,
  type CardDraft,
  type TaxIdDraft,
} from "@/lib/counterparty-requisites";
import {
  LINK_LABELS,
  linkedEntityHref,
  type Counterparty,
  type LinkKind,
  type LinkOption,
} from "./types";

type AliasDraft = { id: string; isNew: boolean; value: string; source: string };
type OptionRow = { id: string; name: string; status?: string };

let draftSeq = 0;
const nextDraftId = () => `draft-${++draftSeq}`;

type Prefill = { name?: string; alias?: string; taxId?: string; accountNumber?: string };

function prefillAliases(prefill?: Prefill): AliasDraft[] {
  if (!prefill?.alias) return [];
  return [{ id: nextDraftId(), isNew: true, value: prefill.alias, source: "robot" }];
}

function emptySections(prefill?: Prefill) {
  return {
    taxIds: prefill?.taxId
      ? [{ id: nextDraftId(), isNew: true, taxId: prefill.taxId }]
      : ([] as TaxIdDraft[]),
    accounts: prefill?.accountNumber
      ? [
          {
            id: nextDraftId(),
            isNew: true,
            accountNumber: prefill.accountNumber,
            bankName: "",
            bic: "",
          },
        ]
      : ([] as AccountDraft[]),
    cards: [] as CardDraft[],
    leftoverIds: [] as string[],
  };
}

const NONE = "__none__";
const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<OptionRow[]>);

type BankRow = { id: string; name: string; country: string; status: string };
const banksFetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<BankRow[]>);

export function CounterpartyDialog({
  row,
  prefill,
  executors,
  clients,
  bankAccounts,
  lockLink,
  onClose,
  onSaved,
}: {
  row: Counterparty | null;
  prefill?: Prefill;
  executors: LinkOption[];
  clients: LinkOption[];
  bankAccounts: LinkOption[];
  lockLink?: { kind: LinkKind; id: string };
  onClose: () => void;
  onSaved: (counterpartyId: string) => void;
}) {
  const initialLinkKind: LinkKind =
    lockLink?.kind ??
    (row?.clientId ? "client" : row?.bankAccountId ? "bankAccount" : "executor");

  const [linkKind, setLinkKind] = React.useState<LinkKind>(initialLinkKind);
  const [linkId, setLinkId] = React.useState(
    lockLink?.id ?? row?.executorId ?? row?.clientId ?? row?.bankAccountId ?? ""
  );
  const [name, setName] = React.useState(row?.name ?? prefill?.name ?? "");
  const [legalType, setLegalType] = React.useState(row?.legalType ?? "");
  const [comment, setComment] = React.useState(row?.comment ?? "");
  const [uniqueProjectId, setUniqueProjectId] = React.useState(row?.uniqueProjectId ?? NONE);
  const [uniqueWorkTypeId, setUniqueWorkTypeId] = React.useState(row?.uniqueWorkTypeId ?? NONE);
  const initialSections = React.useMemo(
    () => (row ? splitRequisites(row.requisites) : emptySections(prefill)),
    [row, prefill]
  );
  const [taxIds, setTaxIds] = React.useState<TaxIdDraft[]>(initialSections.taxIds);
  const [accounts, setAccounts] = React.useState<AccountDraft[]>(initialSections.accounts);
  const [cards, setCards] = React.useState<CardDraft[]>(initialSections.cards);
  const [removedRequisites, setRemovedRequisites] = React.useState<string[]>(
    initialSections.leftoverIds
  );
  const [aliases, setAliases] = React.useState<AliasDraft[]>(() =>
    row
      ? row.aliases.map((a) => ({ id: a.id, isNew: false, value: a.value, source: a.source }))
      : prefillAliases(prefill)
  );
  const [removedAliases, setRemovedAliases] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [extraBanks, setExtraBanks] = React.useState<string[]>([]);

  const { data: projects } = useSWR<OptionRow[]>("/api/projects/options", fetcher);
  const { data: workTypes } = useSWR<OptionRow[]>("/api/work-types?status=active", fetcher);
  const { data: directoryBanks, mutate: mutateBanks } = useSWR<BankRow[]>(
    "/api/banks?status=active",
    banksFetcher
  );

  const bankOptions = React.useMemo(() => {
    const names = new Set<string>();
    for (const b of directoryBanks ?? []) {
      if (b.name.trim()) names.add(b.name.trim());
    }
    for (const n of extraBanks) if (n.trim()) names.add(n.trim());
    for (const n of [...accounts.map((a) => a.bankName), ...cards.map((c) => c.bankName)]) {
      if (n.trim()) names.add(n.trim());
    }
    return [...names].sort((a, b) => a.localeCompare(b, "ru"));
  }, [directoryBanks, extraBanks, accounts, cards]);

  async function addBankOption(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setExtraBanks((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    const res = await fetch("/api/banks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, country: "ru" }),
    });
    if (res.ok) {
      mutateBanks();
      return;
    }
    if (res.status === 409) mutateBanks();
  }

  const linkOptions =
    linkKind === "executor" ? executors : linkKind === "client" ? clients : bankAccounts;
  const linkedHref = row
    ? linkedEntityHref(row)
    : linkKind === "executor" && linkId
      ? `/admin/executors/${linkId}?tab=settings`
      : linkKind === "client" && linkId
        ? `/admin/clients?open=${linkId}`
        : linkKind === "bankAccount" && linkId
          ? `/admin/bank-accounts?open=${linkId}`
          : null;

  function handleLinkChange(value: string) {
    setLinkId(value);
    if (!name.trim()) {
      const picked = linkOptions.find((o) => o.id === value);
      if (picked) setName(picked.name);
    }
  }

  function dropRequisite(id: string, isNew: boolean) {
    if (!isNew) setRemovedRequisites((prev) => [...prev, id]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!linkId) {
      toast.error(`Выберите, на что ссылается контрагент: ${LINK_LABELS[linkKind]}`);
      return;
    }
    if (!name.trim()) {
      toast.error("Введите название контрагента");
      return;
    }

    setSubmitting(true);
    try {
      const links = {
        executorId: linkKind === "executor" ? linkId : null,
        clientId: linkKind === "client" ? linkId : null,
        bankAccountId: linkKind === "bankAccount" ? linkId : null,
      };
      const unique = {
        uniqueProjectId: uniqueProjectId === NONE ? null : uniqueProjectId,
        uniqueWorkTypeId: uniqueWorkTypeId === NONE ? null : uniqueWorkTypeId,
      };

      let counterpartyId = row?.id ?? "";
      if (row) {
        const res = await fetch(`/api/counterparties/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            legalType: legalType || null,
            comment: comment.trim() || null,
            ...links,
            ...unique,
          }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Не удалось сохранить");
      } else {
        const res = await fetch("/api/counterparties", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            legalType: legalType || null,
            comment: comment.trim() || null,
            ...links,
            ...unique,
            requisites: [
              ...taxIds
                .filter((r) => r.taxId.trim())
                .map((r) => ({ paymentMethod: "bank_transfer", taxId: r.taxId.trim() })),
              ...accounts
                .filter((r) => r.accountNumber.trim() || r.bankName.trim() || r.bic.trim())
                .map((r) => ({
                  paymentMethod: "bank_transfer",
                  accountNumber: r.accountNumber.trim() || null,
                  bankName: r.bankName.trim() || null,
                  bic: r.bic.trim() || null,
                })),
              ...cards
                .filter((r) => r.cardNumber.trim() || r.bankName.trim())
                .map((r) => ({
                  paymentMethod: "card",
                  cardNumber: r.cardNumber.trim() || null,
                  bankName: r.bankName.trim() || null,
                })),
            ],
            aliases: aliases
              .filter((a) => a.value.trim())
              .map((a) => ({ value: a.value.trim(), source: a.source })),
          }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Не удалось сохранить");
        counterpartyId = (await res.json()).id;
      }

      if (row) {
        for (const id of removedRequisites) {
          await fetch(`/api/counterparties/requisites/${id}`, { method: "DELETE" });
        }
        const updates = [
          ...taxIds
            .filter((r) => r.taxId.trim())
            .map((r) => ({
              id: r.id,
              isNew: r.isNew,
              payload: {
                paymentMethod: "bank_transfer",
                taxId: r.taxId.trim(),
                accountNumber: null,
                cardNumber: null,
                bankName: null,
                bic: null,
              },
            })),
          ...accounts
            .filter((r) => r.accountNumber.trim() || r.bankName.trim() || r.bic.trim())
            .map((r) => ({
              id: r.id,
              isNew: r.isNew,
              payload: {
                paymentMethod: "bank_transfer",
                taxId: null,
                accountNumber: r.accountNumber.trim() || null,
                bankName: r.bankName.trim() || null,
                bic: r.bic.trim() || null,
                cardNumber: null,
              },
            })),
          ...cards
            .filter((r) => r.cardNumber.trim() || r.bankName.trim())
            .map((r) => ({
              id: r.id,
              isNew: r.isNew,
              payload: {
                paymentMethod: "card",
                taxId: null,
                accountNumber: null,
                bic: null,
                cardNumber: r.cardNumber.trim() || null,
                bankName: r.bankName.trim() || null,
              },
            })),
        ];
        for (const item of updates) {
          if (item.isNew) {
            await fetch(`/api/counterparties/${counterpartyId}/requisites`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(item.payload),
            });
          } else {
            await fetch(`/api/counterparties/requisites/${item.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(item.payload),
            });
          }
        }
        for (const id of removedAliases) {
          await fetch(`/api/counterparties/aliases/${id}`, { method: "DELETE" });
        }
        for (const a of aliases) {
          if (!a.isNew || !a.value.trim()) continue;
          const res = await fetch(`/api/counterparties/${counterpartyId}/aliases`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: a.value.trim(), source: a.source }),
          });
          if (res.status === 409) {
            toast.error((await res.json()).error);
          }
        }
      }

      toast.success(row ? "Контрагент обновлён" : "Контрагент создан");
      onSaved(counterpartyId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row ? "Контрагент" : "Новый контрагент"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Связан с</Label>
              <div className="flex gap-1">
                {(Object.keys(LINK_LABELS) as LinkKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    disabled={!!lockLink}
                    onClick={() => {
                      setLinkKind(kind);
                      setLinkId("");
                    }}
                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                      linkKind === kind
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-neutral-200 text-neutral-600 hover:border-neutral-300"
                    } disabled:opacity-60`}
                  >
                    {LINK_LABELS[kind]}
                  </button>
                ))}
              </div>
              <SearchableSelect
                value={linkId}
                onValueChange={handleLinkChange}
                options={linkOptions.map((o) => ({
                  value: o.id,
                  label: o.name,
                  searchText: o.name,
                }))}
                placeholder={`Выберите: ${LINK_LABELS[linkKind].toLowerCase()}`}
                disabled={!!lockLink}
              />
              {linkedHref && (
                <Link
                  href={linkedHref}
                  className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                >
                  Открыть связанную сущность
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cp-name">Название (юридический получатель)</Label>
              <Input
                id="cp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ИП Иванов Иван"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Юрлицо</Label>
              <SearchableSelect
                value={legalType}
                onValueChange={setLegalType}
                options={Object.entries(COUNTERPARTY_LEGAL_TYPES).map(([value, label]) => ({
                  value,
                  label,
                }))}
                placeholder="Не указано"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cp-comment">Комментарий</Label>
              <Input
                id="cp-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Уникальный проект</Label>
              <SearchableSelect
                value={uniqueProjectId}
                onValueChange={setUniqueProjectId}
                options={[
                  { value: NONE, label: "Не задан" },
                  ...(projects ?? [])
                    .filter((p) => p.status !== "archived")
                    .map((p) => ({ value: p.id, label: p.name })),
                ]}
                placeholder="Не задан"
              />
            </div>

            <div className="space-y-2">
              <Label>Уникальный вид работ</Label>
              <SearchableSelect
                value={uniqueWorkTypeId}
                onValueChange={setUniqueWorkTypeId}
                options={[
                  { value: NONE, label: "Не задан" },
                  ...(workTypes ?? []).map((w) => ({ value: w.id, label: w.name })),
                ]}
                placeholder="Не задан"
              />
            </div>
          </div>

          <RequisiteSection
            title="ИНН / ИИК / IBAN"
            addLabel="Значение"
            empty="Значений нет — добавьте ИНН, ИИК или IBAN, если они есть в выписке."
            onAdd={() => setTaxIds((prev) => [...prev, { id: nextDraftId(), isNew: true, taxId: "" }])}
          >
            {taxIds.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <Input
                  value={row.taxId}
                  onChange={(e) =>
                    setTaxIds((prev) =>
                      prev.map((x) => (x.id === row.id ? { ...x, taxId: e.target.value } : x))
                    )
                  }
                  placeholder="7701234567"
                />
                <IconRemove
                  onClick={() => {
                    setTaxIds((prev) => prev.filter((x) => x.id !== row.id));
                    dropRequisite(row.id, row.isNew);
                  }}
                />
              </div>
            ))}
          </RequisiteSection>

          <RequisiteSection
            title="Номера счетов + банк"
            addLabel="Счёт"
            empty="Счетов нет. Несколько расчётных счетов одного ИП — отдельные строки здесь."
            onAdd={() =>
              setAccounts((prev) => [
                ...prev,
                { id: nextDraftId(), isNew: true, accountNumber: "", bankName: "", bic: "" },
              ])
            }
          >
            {accounts.map((row) => (
              <div key={row.id} className="grid grid-cols-[1fr_1fr_8rem_auto] gap-2">
                <Input
                  value={row.accountNumber}
                  onChange={(e) =>
                    setAccounts((prev) =>
                      prev.map((x) => (x.id === row.id ? { ...x, accountNumber: e.target.value } : x))
                    )
                  }
                  placeholder="Номер счёта"
                />
                <DepartmentCombobox
                  value={row.bankName}
                  onValueChange={(bankName) =>
                    setAccounts((prev) =>
                      prev.map((x) => (x.id === row.id ? { ...x, bankName } : x))
                    )
                  }
                  options={bankOptions}
                  onAddOption={addBankOption}
                  placeholder="Банк"
                />
                <Input
                  value={row.bic}
                  onChange={(e) =>
                    setAccounts((prev) =>
                      prev.map((x) => (x.id === row.id ? { ...x, bic: e.target.value } : x))
                    )
                  }
                  placeholder="БИК"
                />
                <IconRemove
                  onClick={() => {
                    setAccounts((prev) => prev.filter((x) => x.id !== row.id));
                    dropRequisite(row.id, row.isNew);
                  }}
                />
              </div>
            ))}
          </RequisiteSection>

          <RequisiteSection
            title="Номера карт + банк"
            addLabel="Карта"
            empty="Карт нет."
            onAdd={() =>
              setCards((prev) => [
                ...prev,
                { id: nextDraftId(), isNew: true, cardNumber: "", bankName: "" },
              ])
            }
          >
            {cards.map((row) => (
              <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input
                  value={row.cardNumber}
                  onChange={(e) =>
                    setCards((prev) =>
                      prev.map((x) => (x.id === row.id ? { ...x, cardNumber: e.target.value } : x))
                    )
                  }
                  placeholder="Номер карты"
                />
                <DepartmentCombobox
                  value={row.bankName}
                  onValueChange={(bankName) =>
                    setCards((prev) => prev.map((x) => (x.id === row.id ? { ...x, bankName } : x)))
                  }
                  options={bankOptions}
                  onAddOption={addBankOption}
                  placeholder="Банк"
                />
                <IconRemove
                  onClick={() => {
                    setCards((prev) => prev.filter((x) => x.id !== row.id));
                    dropRequisite(row.id, row.isNew);
                  }}
                />
              </div>
            ))}
          </RequisiteSection>

          <RequisiteSection
            title="Имена в выписке"
            addLabel="Написание"
            empty="Написаний нет. ИНН и номера счетов сюда не дублируются — они в разделах выше."
            onAdd={() =>
              setAliases((prev) => [
                ...prev,
                { id: nextDraftId(), isNew: true, value: "", source: "manual" },
              ])
            }
          >
            {aliases.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <Input
                  value={a.value}
                  onChange={(e) =>
                    setAliases((prev) =>
                      prev.map((x) => (x.id === a.id ? { ...x, value: e.target.value } : x))
                    )
                  }
                  placeholder="Как в выписке банка"
                  disabled={!a.isNew}
                />
                <div className="w-52 shrink-0">
                  <SearchableSelect
                    value={a.source}
                    onValueChange={(v) =>
                      setAliases((prev) =>
                        prev.map((x) => (x.id === a.id ? { ...x, source: v } : x))
                      )
                    }
                    options={Object.entries(COUNTERPARTY_ALIAS_SOURCES).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                    disabled={!a.isNew}
                  />
                </div>
                <IconRemove
                  title="Удалить написание"
                  onClick={() => {
                    setAliases((prev) => prev.filter((x) => x.id !== a.id));
                    if (!a.isNew) setRemovedAliases((prev) => [...prev, a.id]);
                  }}
                />
              </div>
            ))}
          </RequisiteSection>

          {row && <EntityActivityHistory entityType="Counterparty" entityId={row.id} />}

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

function RequisiteSection({
  title,
  addLabel,
  empty,
  onAdd,
  children,
}: {
  title: string;
  addLabel: string;
  empty: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const items = React.Children.toArray(children);
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        <Button type="button" size="sm" variant="ghost" onClick={onAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" /> {addLabel}
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-neutral-500">{empty}</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function IconRemove({ onClick, title = "Удалить" }: { onClick: () => void; title?: string }) {
  return (
    <Button type="button" size="sm" variant="ghost" onClick={onClick} title={title}>
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
