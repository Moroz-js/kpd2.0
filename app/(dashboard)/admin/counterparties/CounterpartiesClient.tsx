"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ExternalLink, Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { FilterResetButton } from "@/components/ui-custom/FilterResetButton";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { ConfirmDialog } from "@/components/ui-custom/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { compactCell, compactHead, compactTable, stickyActionsCell, stickyActionsHead, stickyActionsInner } from "@/lib/table-styles";
import { matchesSearchText } from "@/lib/search";
import { COUNTERPARTY_LEGAL_TYPES, ENTITY_STATUSES } from "@/lib/statuses";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";
import { CounterpartyDialog } from "./CounterpartyDialog";
import {
  linkedEntityHref,
  linkedEntityLabel,
  type Counterparty,
  type LinkOption,
} from "./types";

const TABS = [
  { id: "all", label: "Все" },
  { id: "executor", label: "Исполнители" },
  { id: "service", label: "Сервисы" },
  { id: "bank", label: "Банки" },
  { id: "client", label: "Клиенты" },
  { id: "own_account", label: "Счета КПД" },
] as const;
type Tab = (typeof TABS)[number]["id"];

type SortField = "name" | "status";
type SortDir = "asc" | "desc";

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<Counterparty[]>);

export function CounterpartiesClient({
  executors,
  clients,
  bankAccounts,
}: {
  executors: LinkOption[];
  clients: LinkOption[];
  bankAccounts: LinkOption[];
}) {
  const { data, isLoading, mutate } = useSWR<Counterparty[]>("/api/counterparties", fetcher);
  const rowsAll = React.useMemo(() => data ?? [], [data]);

  const [activeTab, setActiveTab] = React.useState<Tab>("all");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string[]>(["active"]);
  const [legalTypeFilter, setLegalTypeFilter] = React.useState<string[]>([]);
  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }>({
    field: "name",
    dir: "asc",
  });

  const [editing, setEditing] = React.useState<Counterparty | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<Counterparty | null>(null);
  const [unarchiveTarget, setUnarchiveTarget] = React.useState<Counterparty | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const hasActiveFilters =
    search.trim() !== "" || statusFilter.length > 0 || legalTypeFilter.length > 0;

  function resetFilters() {
    setSearch("");
    setStatusFilter([]);
    setLegalTypeFilter([]);
  }

  usePersistedInterfaceState(
    "counterparties",
    { activeTab, statusFilter, legalTypeFilter, sort },
    (stored) => {
      if (stored.activeTab !== undefined) setActiveTab(stored.activeTab);
      if (stored.statusFilter) setStatusFilter(stored.statusFilter);
      if (stored.legalTypeFilter) setLegalTypeFilter(stored.legalTypeFilter);
      if (stored.sort) setSort(stored.sort);
    }
  );
  usePersistedScroll(scrollRef, `counterparties-table:${activeTab}`, {
    enabled: !isLoading && !!data,
    signature: { activeTab, statusFilter, legalTypeFilter, sort },
  });

  const tabCounts = React.useMemo(
    () =>
      Object.fromEntries(
        TABS.map((tab) => [
          tab.id,
          tab.id === "all" ? rowsAll.length : rowsAll.filter((r) => r.kind === tab.id).length,
        ])
      ) as Record<Tab, number>,
    [rowsAll]
  );

  const rows = React.useMemo(() => {
    let list = activeTab === "all" ? rowsAll : rowsAll.filter((r) => r.kind === activeTab);

    if (statusFilter.length) list = list.filter((r) => statusFilter.includes(r.status));
    if (legalTypeFilter.length)
      list = list.filter((r) => r.legalType && legalTypeFilter.includes(r.legalType));

    if (search.trim()) {
      list = list.filter((r) =>
        matchesSearchText(
          search,
          r.name,
          [
            r.executorName,
            r.clientName,
            r.bankAccountName,
            r.uniqueProjectName,
            r.uniqueWorkTypeName,
            ...r.aliases.map((a) => a.value),
            ...r.requisites.flatMap((q) => [q.taxId, q.accountNumber, q.cardNumber, q.bankName]),
          ]
            .filter(Boolean)
            .join(" ")
        )
      );
    }

    return [...list].sort((a, b) => {
      const cmp = String(a[sort.field]).localeCompare(String(b[sort.field]), "ru");
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rowsAll, activeTab, statusFilter, legalTypeFilter, search, sort]);

  function handleSort(field: string, dir: SortDir) {
    setSort({ field: field as SortField, dir });
  }

  async function toggleArchive(row: Counterparty, archive: boolean) {
    const res = await fetch(`/api/counterparties/${row.id}/archive`, {
      method: archive ? "POST" : "DELETE",
    });
    if (!res.ok) {
      toast.error(archive ? "Не удалось архивировать" : "Не удалось вернуть из архива");
      return;
    }
    toast.success(
      archive ? `Контрагент «${row.name}» в архиве` : `Контрагент «${row.name}» снова активен`
    );
    mutate();
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title="Контрагенты"
        description="Строка — юридический получатель. Реквизиты и написания из выписки лежат внутри карточки."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-4 w-4" /> Добавить контрагента
          </Button>
        }
      />

      <div className="mb-4 border-b border-neutral-200">
        <nav className="flex gap-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-800"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-xs text-neutral-400">{tabCounts[tab.id]}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по названию, написанию в выписке, ИНН, счёту"
          className="h-8 w-96"
        />
        <div className="ml-auto flex items-center gap-2">
          <FilterResetButton active={hasActiveFilters} onClick={resetFilters} />
          <MultiSelectFilter
            label="Юрлицо"
            options={Object.entries(COUNTERPARTY_LEGAL_TYPES).map(([value, label]) => ({
              value,
              label,
            }))}
            value={legalTypeFilter}
            onChange={setLegalTypeFilter}
          />
          <MultiSelectFilter
            label="Статус"
            options={Object.entries(ENTITY_STATUSES).map(([value, { label }]) => ({
              value,
              label,
            }))}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </div>
      </div>

      <Table
        containerRef={scrollRef}
        containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto"
        className={compactTable}
      >
        <TableHeader>
          <TableRow>
            <SortableHead
              field="name"
              sortBy={sort.field}
              sortDir={sort.dir}
              onSort={handleSort}
              className={cn(compactHead, "w-64")}
            >
              Контрагент
            </SortableHead>
            <TableHead className={cn(compactHead, "w-52")}>Связан с</TableHead>
            <TableHead className={cn(compactHead, "w-20")}>Личная смета</TableHead>
            <TableHead className={cn(compactHead, "w-28")}>Юрлицо</TableHead>
            <SortableHead
              field="status"
              sortBy={sort.field}
              sortDir={sort.dir}
              onSort={handleSort}
              className={cn(compactHead, "w-24")}
            >
              Статус
            </SortableHead>
            <TableHead className={stickyActionsHead} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-neutral-500">
                Загрузка...
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-neutral-500">
                Нет контрагентов
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => {
              const linkedHref = linkedEntityHref(r);
              const linkedName = linkedEntityLabel(r);
              return (
                <TableRow key={r.id}>
                  <TableCell className={cn(compactCell, "font-medium")}>
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="block w-full truncate text-left text-blue-700 hover:underline"
                      title="Открыть карточку контрагента"
                    >
                      {r.name}
                    </button>
                  </TableCell>
                  <TableCell className={cn(compactCell, "truncate")}>
                    {linkedHref && linkedName ? (
                      <Link
                        href={linkedHref}
                        className="inline-flex max-w-full items-center gap-1 text-blue-700 hover:underline"
                        title="Открыть связанную сущность"
                      >
                        <span className="truncate">{linkedName}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className={compactCell}>
                    {r.personalEstimateUrl ? (
                      <Link
                        href={r.personalEstimateUrl}
                        className="text-blue-700 hover:underline"
                        title="Открыть личную смету"
                      >
                        Смета
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className={cn(compactCell, "truncate")}>
                    {r.legalType
                      ? (COUNTERPARTY_LEGAL_TYPES[
                          r.legalType as keyof typeof COUNTERPARTY_LEGAL_TYPES
                        ] ?? r.legalType)
                      : "—"}
                  </TableCell>
                  <TableCell className={compactCell}>
                    <StatusBadge dict={ENTITY_STATUSES} value={r.status} />
                  </TableCell>
                  <TableCell className={cn(stickyActionsCell)}>
                    <div className={stickyActionsInner}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(r)}
                        title="Редактировать контрагента"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {r.status === "active" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setArchiveTarget(r)}
                          title="Архивировать"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setUnarchiveTarget(r)}
                          title="Вернуть из архива"
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {editing && (
        <CounterpartyDialog
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          executors={executors}
          clients={clients}
          bankAccounts={bankAccounts}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            mutate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title="Архивировать контрагента?"
        description={`«${archiveTarget?.name}» перестанет предлагаться при разборе операций. Уже привязанные операции не изменятся.`}
        confirmLabel="Архивировать"
        destructive
        onConfirm={async () => {
          if (archiveTarget) await toggleArchive(archiveTarget, true);
        }}
      />

      <ConfirmDialog
        open={!!unarchiveTarget}
        onOpenChange={(open) => !open && setUnarchiveTarget(null)}
        title="Вернуть контрагента из архива?"
        description={`«${unarchiveTarget?.name}» снова появится в активных списках.`}
        confirmLabel="Вернуть"
        onConfirm={async () => {
          if (unarchiveTarget) await toggleArchive(unarchiveTarget, false);
        }}
      />
    </div>
  );
}
