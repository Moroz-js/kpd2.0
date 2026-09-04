"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { FilterResetButton } from "@/components/ui-custom/FilterResetButton";
import { EntityActivityHistory } from "@/components/ui-custom/EntityActivityHistory";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { ConfirmDialog } from "@/components/ui-custom/ConfirmDialog";
import { ENTITY_STATUSES, PROJECT_TYPES } from "@/lib/statuses";
import { formatMoney } from "@/lib/format";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner } from "@/lib/table-styles";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VerificationTab } from "./VerificationTab";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { sortByNameRu, sortByRu } from "@/lib/sort";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";
import { useUrlSyncedFilters } from "@/lib/useUrlSyncedFilters";
import { useCompatibleFilterOptions } from "@/lib/useCompatibleFilterOptions";

type Row = {
  id: string;
  number: string | null;
  numberSerial: number | null;
  name: string;
  shortName: string;
  type: string;
  status: string;
  responsibleUserId: string | null;
  responsibleName: string | null;
  clientId: string | null;
  clientName: string | null;
  company: string | null;
  debt: number;
  paid: number;
  charged: number;
  createdAt: string;
};

type ClientRow = { id: string; name: string; company: string; status: string };
type ResponsibleRow = { id: string; fullName: string; isActive: boolean };
type ExecutorRow = { id: string; name: string; status: string };

const fetcher = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<T>;
  });

type SortField =
  | "numberSerial"
  | "name"
  | "createdAt"
  | "debt"
  | "paid"
  | "charged"
  | "responsibleName"
  | "clientName"
  | "status";
type SortDir = "asc" | "desc";

export function ProjectsClient({ scope }: { scope: "all" | "mine" }) {
  const apiUrl = scope === "mine" ? "/api/projects?scope=mine" : "/api/projects";
  const { data, isLoading, mutate } = useSWR<Row[]>(apiUrl, fetcher);
  const { data: clients } = useSWR<ClientRow[]>(
    scope === "all" ? "/api/clients" : null,
    fetcher
  );
  const { data: responsibles } = useSWR<ResponsibleRow[]>(
    scope === "all" ? "/api/responsibles" : null,
    fetcher
  );
  const { data: allExecutors } = useSWR<ExecutorRow[]>(
    scope === "all" ? "/api/executors" : null,
    fetcher
  );

  const [responsibleFilter, setResponsibleFilter] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<string[]>(["active"]);
  const [clientFilter, setClientFilter] = React.useState<string[]>([]);
  const [typeFilter, setTypeFilter] = React.useState<string[]>([]);
  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }>({
    field: "createdAt",
    dir: "desc",
  });
  const hasActiveFilters =
    responsibleFilter.length > 0 || clientFilter.length > 0 ||
    typeFilter.length > 0 || statusFilter.length > 0;
  const resetFilters = () => {
    setResponsibleFilter([]);
    setClientFilter([]);
    setTypeFilter([]);
    setStatusFilter([]);
  };
  const urlFilters = useUrlSyncedFilters([
    { stateKey: "responsibleFilter", param: "responsible", kind: "array", value: responsibleFilter, defaultValue: [], setValue: setResponsibleFilter },
    { stateKey: "clientFilter", param: "client", kind: "array", value: clientFilter, defaultValue: [], setValue: setClientFilter },
    { stateKey: "typeFilter", param: "type", kind: "array", value: typeFilter, defaultValue: [], setValue: setTypeFilter },
    { stateKey: "statusFilter", param: "status", kind: "array", value: statusFilter, defaultValue: [], setValue: setStatusFilter },
  ]);

  const [editing, setEditing] = React.useState<Row | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<Row | null>(null);
  const [unarchiveTarget, setUnarchiveTarget] = React.useState<Row | null>(null);

  const rows = React.useMemo(() => {
    let list = data ?? [];
    if (responsibleFilter.length) {
      list = list.filter((r) =>
        responsibleFilter.includes(r.responsibleUserId ?? "__none__")
      );
    }
    if (statusFilter.length) list = list.filter((r) => statusFilter.includes(r.status));
    if (clientFilter.length) {
      list = list.filter((r) => clientFilter.includes(r.clientId ?? "__empty__"));
    }
    if (typeFilter.length) list = list.filter((r) => typeFilter.includes(r.type));

    list = [...list].sort((a, b) => {
      if (sort.field === "numberSerial") {
        if (a.numberSerial === null) return b.numberSerial === null ? 0 : 1;
        if (b.numberSerial === null) return -1;
        const cmp = a.numberSerial - b.numberSerial;
        return sort.dir === "asc" ? cmp : -cmp;
      }
      const av = a[sort.field];
      const bv = b[sort.field];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av ?? "").localeCompare(String(bv ?? ""), "ru");
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data, responsibleFilter, statusFilter, clientFilter, typeFilter, sort]);

  const compatibleValues = useCompatibleFilterOptions(data, [
    {
      key: "responsible",
      value: responsibleFilter,
      setValue: setResponsibleFilter,
      matches: (row, value) => !value.length || value.includes(row.responsibleUserId ?? "__none__"),
      values: (row) => [row.responsibleUserId ?? "__none__"],
    },
    {
      key: "client",
      value: clientFilter,
      setValue: setClientFilter,
      matches: (row, value) => !value.length || value.includes(row.clientId ?? "__empty__"),
      values: (row) => [row.clientId ?? "__empty__"],
    },
    {
      key: "type",
      value: typeFilter,
      setValue: setTypeFilter,
      matches: (row, value) => !value.length || value.includes(row.type),
      values: (row) => [row.type],
    },
    {
      key: "status",
      value: statusFilter,
      setValue: setStatusFilter,
      matches: (row, value) => !value.length || value.includes(row.status),
      values: (row) => [row.status],
    },
  ]);

  function handleSort(field: string, dir: SortDir) {
    setSort({ field: field as SortField, dir });
  }

  async function handleArchive(row: Row) {
    const res = await fetch(`/api/projects/${row.id}/archive`, { method: "POST" });
    if (!res.ok) return toast.error("Не удалось архивировать");
    toast.success(`Проект «${row.name}» архивирован`);
    mutate();
  }

  async function handleUnarchive(row: Row) {
    const res = await fetch(`/api/projects/${row.id}/archive`, { method: "DELETE" });
    if (!res.ok) return toast.error("Не удалось вернуть из архива");
    toast.success(`Проект «${row.name}» снова активен`);
    mutate();
  }

  const responsibleOptions = React.useMemo(() => {
    const list = data ?? [];
    const map = new Map<string, string>();
    for (const r of list) {
      const id = r.responsibleUserId ?? "__none__";
      const name = r.responsibleName ?? "— Без руководителя —";
      map.set(id, name);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "ru"))
      .map(([value, label]) => ({ value, label }))
      .filter((option) => compatibleValues.responsible?.has(option.value));
  }, [compatibleValues, data]);

  const clientOptions = React.useMemo(() => {
    const list = data ?? [];
    const map = new Map<string, string>();
    for (const r of list) {
      const id = r.clientId ?? "__empty__";
      map.set(id, r.clientName ?? "Пусто");
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "ru"))
      .map(([value, label]) => ({ value, label }))
      .filter((option) => compatibleValues.client?.has(option.value));
  }, [compatibleValues, data]);

  const isAdmin = scope === "all";
  const [activeTab, setActiveTab] = React.useState<"projects" | "verification">("projects");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  usePersistedInterfaceState(
    `projects:${scope}`,
    {
      responsibleFilter,
      statusFilter,
      clientFilter,
      typeFilter,
      sort,
      activeTab,
    },
    (stored) => {
      urlFilters.restorePersisted(stored);
      if (stored.sort) setSort(stored.sort);
      if (stored.activeTab !== undefined) setActiveTab(stored.activeTab);
    }
  );
  usePersistedScroll(scrollRef, `projects-table:${scope}:${activeTab}`, {
    enabled: !isLoading && !!data,
    signature: {
      responsibleFilter,
      statusFilter,
      clientFilter,
      typeFilter,
      sort,
      activeTab,
    },
  });
  const detailHref = (id: string) =>
    isAdmin ? `/admin/projects/${id}` : `/responsible/projects/${id}`;

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Проекты"
        actions={
          isAdmin ? (
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4 mr-1" /> Добавить проект
            </Button>
          ) : undefined
        }
      />

      {/* Tab bar — only for admin */}
      {isAdmin && (
        <div className="border-b border-neutral-200 mb-4">
          <nav className="flex gap-0">
            {(["projects", "verification"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-neutral-500 hover:text-neutral-800 hover:border-neutral-300"
                }`}
              >
                {tab === "projects" ? "Проекты" : "Проверка"}
              </button>
            ))}
          </nav>
        </div>
      )}

      {isAdmin && activeTab === "verification" && (
        <div className="flex-1 min-h-0 flex flex-col">
          <VerificationTab />
        </div>
      )}

      {(!isAdmin || activeTab === "projects") && (
      <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterResetButton active={hasActiveFilters} onClick={resetFilters} />
        <MultiSelectFilter
          label="Руководитель"
          options={responsibleOptions}
          value={responsibleFilter}
          onChange={setResponsibleFilter}
        />
        <MultiSelectFilter
          label="Клиент"
          options={clientOptions}
          value={clientFilter}
          onChange={setClientFilter}
        />
        <MultiSelectFilter
          label="Тип"
          options={Object.entries(PROJECT_TYPES)
            .map(([value, label]) => ({ value, label }))
            .filter((option) => compatibleValues.type?.has(option.value))}
          value={typeFilter}
          onChange={setTypeFilter}
        />
        <MultiSelectFilter
          label="Статус"
          options={Object.entries(ENTITY_STATUSES)
            .map(([value, { label }]) => ({ value, label }))
            .filter((option) => compatibleValues.status?.has(option.value))}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      </div>

      <Table
        className="min-w-[1040px]"
        containerRef={scrollRef}
        containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto"
      >
          <TableHeader>
            <TableRow>
              <SortableHead
                field="numberSerial"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
                className="w-[1%] min-w-[76px]"
              >
                Номер
              </SortableHead>
              <SortableHead field="name" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort}>
                Проект
              </SortableHead>
              <SortableHead
                field="responsibleName"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
              >
                Руководитель
              </SortableHead>
              <SortableHead
                field="debt"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
                className="text-right"
              >
                Текущий долг
              </SortableHead>
              <SortableHead
                field="paid"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
                className="text-right"
              >
                Выплачено
              </SortableHead>
              <SortableHead
                field="charged"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
                className="text-right"
              >
                Начислено
              </SortableHead>
              <SortableHead
                field="clientName"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
              >
                Клиент
              </SortableHead>
              <SortableHead
                field="status"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
              >
                Статус
              </SortableHead>
              <TableHead>Тип</TableHead>
              {isAdmin && <TableHead className={stickyActionsHead} />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 10 : 9} className="text-center text-neutral-500 py-8">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 10 : 9} className="text-center text-neutral-500 py-8">
                  {scope === "mine"
                    ? "Вы пока не назначены руководителем ни на один проект."
                    : "Нет проектов"}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className={r.status === "archived" ? "bg-neutral-100 text-neutral-400" : ""}>
                  <TableCell className="w-[1%] min-w-[76px] tabular-nums font-medium">
                    {r.number ?? <span className="text-neutral-400">—</span>}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={detailHref(r.id)}
                      className="hover:underline text-neutral-900"
                    >
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {r.responsibleName ?? <span className="text-neutral-400">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-sm">{formatMoney(r.debt)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-sm">{formatMoney(r.paid)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-sm">{formatMoney(r.charged)}</TableCell>
                  <TableCell>{r.clientName ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge dict={ENTITY_STATUSES} value={r.status} />
                  </TableCell>
                  <TableCell className="text-sm">
                    <StatusBadge
                      tone={r.type === "internal" ? "blue" : r.type === "client" ? "slate" : "gray"}
                      label={PROJECT_TYPES[r.type as keyof typeof PROJECT_TYPES] ?? "—"}
                    />
                  </TableCell>
                  {isAdmin && (
                    <TableCell className={cn(stickyActionsCell, r.status === "archived" && "bg-neutral-100 text-neutral-400")}>
                      <div className={stickyActionsInner}>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(r)} title="Редактировать">
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
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </>
      )}

      {isAdmin && editing && clients && responsibles && (
        <ProjectEditDialog
          row={editing === "new" ? null : editing}
          clients={clients}
          responsibles={responsibles}
          executors={allExecutors ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            mutate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        title="Архивировать проект?"
        description={`Проект «${archiveTarget?.name}» станет недоступен для выбора в новых работах и начислениях. Все существующие данные сохранятся.`}
        confirmLabel="Архивировать"
        destructive
        onConfirm={async () => {
          if (archiveTarget) await handleArchive(archiveTarget);
        }}
      />
      <ConfirmDialog
        open={!!unarchiveTarget}
        onOpenChange={(o) => !o && setUnarchiveTarget(null)}
        title="Вернуть проект из архива?"
        description={`Проект «${unarchiveTarget?.name}» снова станет доступен в активных списках.`}
        confirmLabel="Вернуть"
        onConfirm={async () => {
          if (unarchiveTarget) await handleUnarchive(unarchiveTarget);
        }}
      />
    </div>
  );
}

function ProjectEditDialog({
  row,
  clients,
  responsibles,
  executors,
  onClose,
  onSaved,
}: {
  row: Row | null;
  clients: ClientRow[];
  responsibles: ResponsibleRow[];
  executors: ExecutorRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [shortName, setShortName] = React.useState(row?.shortName ?? "");
  const [clientId, setClientId] = React.useState(row?.clientId ?? "");
  const [responsibleUserId, setResponsibleUserId] = React.useState(row?.responsibleUserId ?? "");
  const [submitting, setSubmitting] = React.useState(false);
  const [confirmClientChange, setConfirmClientChange] = React.useState(false);

  React.useEffect(() => {
    setShortName(row?.shortName ?? "");
    setClientId(row?.clientId ?? "");
    setResponsibleUserId(row?.responsibleUserId ?? "");
  }, [row]);

  const activeClients = sortByNameRu(
    clients.filter((c) => c.status === "active" || c.id === row?.clientId)
  );
  const activeResponsibles = sortByRu(
    responsibles.filter((r) => r.isActive || r.id === row?.responsibleUserId),
    (r) => r.fullName
  );

  const selectedClient = clients.find((c) => c.id === clientId);
  const previewName = selectedClient
    ? `${shortName.trim()} – ${selectedClient.name}`
    : shortName.trim();
  const previewType = selectedClient
    ? selectedClient.name.toLowerCase().includes("кпд")
      ? "Внутренний"
      : "Клиентский"
    : "—";

  const clientChanged = !!row && row.clientId !== clientId;
  const isNew = !row;

  async function performSave() {
    setSubmitting(true);
    const payload: Record<string, unknown> = {
      shortName: shortName.trim(),
      clientId,
    };
    if (responsibleUserId) payload.responsibleUserId = responsibleUserId;
    else payload.responsibleUserId = null;

    const res = await fetch(isNew ? "/api/projects" : `/api/projects/${row.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setSubmitting(false);
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Не удалось сохранить");
      return;
    }
    const saved = await res.json();

    setSubmitting(false);
    toast.success(isNew ? "Проект создан" : "Проект обновлён");
    onSaved();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!shortName.trim()) return toast.error("Введите название проекта");
    if (!clientId) return toast.error("Выберите клиента");
    if (!responsibleUserId) return toast.error("Выберите руководителя проекта");
    if (clientChanged) {
      setConfirmClientChange(true);
      return;
    }
    await performSave();
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{row ? "Редактировать проект" : "Новый проект"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="clientId">Клиент</Label>
              <SearchableSelect
                id="clientId"
                value={clientId}
                onValueChange={setClientId}
                options={activeClients.map((client) => ({
                  value: client.id,
                  label: `${client.name}${client.status === "archived" ? " (архив)" : ""}`,
                }))}
                placeholder={clientId || "Выберите клиента"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shortName">Название проекта</Label>
              <Input
                id="shortName"
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                placeholder="Например: Контент"
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="responsibleUserId">Руководитель проекта</Label>
              <SearchableSelect
                id="responsibleUserId"
                value={responsibleUserId || "__none__"}
                onValueChange={(v) => setResponsibleUserId(v === "__none__" ? "" : v)}
                options={[
                  { value: "__none__", label: "— Выберите руководителя —" },
                  ...activeResponsibles.map((responsible) => ({
                    value: responsible.id,
                    label: `${responsible.fullName}${!responsible.isActive ? " (архив)" : ""}`,
                  })),
                ]}
                placeholder={row?.responsibleName ?? "— Выберите руководителя —"}
              />
            </div>
            {previewName && (
              <div className="rounded-md bg-neutral-50 border border-neutral-200 px-3 py-2 text-sm space-y-1">
                <div>
                  <span className="text-neutral-500">Полное название: </span>
                  <span className="font-medium">{previewName}</span>
                </div>
                <div>
                  <span className="text-neutral-500">Тип проекта: </span>
                  <span className="font-medium">{previewType}</span>
                </div>
              </div>
            )}
            {row && (
              <EntityActivityHistory entityType="Project" entityId={row.id} />
            )}
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

      <ConfirmDialog
        open={confirmClientChange}
        onOpenChange={setConfirmClientChange}
        title="Сменить клиента у проекта?"
        description="Клиент проекта будет изменён. Все связанные работы и начисления перейдут на нового клиента."
        confirmLabel="Сменить и сохранить"
        onConfirm={async () => {
          await performSave();
        }}
      />
    </>
  );
}
