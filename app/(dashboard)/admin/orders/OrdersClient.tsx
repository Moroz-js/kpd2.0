"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { ConfirmDialog } from "@/components/ui-custom/ConfirmDialog";
import { ENTITY_STATUSES } from "@/lib/statuses";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner } from "@/lib/table-styles";
import { sortByNameRu } from "@/lib/sort";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";

type Row = {
  id: string;
  orderNumber: string;
  description: string | null;
  contractNumber: string | null;
  status: string;
  projectId: string;
  projectName: string;
  clientId: string | null;
  clientName: string | null;
  company: string | null;
  hasUnpaidCharges: boolean;
  createdAt: string;
};

type ProjectOption = {
  id: string;
  name: string;
  status: string;
};

const fetcher = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<T>;
  });

type SortField = "orderNumber" | "description" | "projectName" | "clientName" | "status";
type SortDir = "asc" | "desc";

export function OrdersClient() {
  const { data, isLoading, mutate } = useSWR<Row[]>("/api/orders", fetcher);
  const { data: projects } = useSWR<ProjectOption[]>("/api/projects/options", fetcher);

  const [companyFilter, setCompanyFilter] = React.useState<string[]>([]);
  const [clientFilter, setClientFilter] = React.useState<string[]>([]);
  const [projectFilter, setProjectFilter] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<string[]>(["active"]);
  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }>({
    field: "orderNumber",
    dir: "desc",
  });
  const [editing, setEditing] = React.useState<Row | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<Row | null>(null);
  const [unarchiveTarget, setUnarchiveTarget] = React.useState<Row | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  usePersistedInterfaceState(
    "orders",
    { companyFilter, clientFilter, projectFilter, statusFilter, sort },
    (stored) => {
      if (stored.companyFilter) setCompanyFilter(stored.companyFilter);
      if (stored.clientFilter) setClientFilter(stored.clientFilter);
      if (stored.projectFilter) setProjectFilter(stored.projectFilter);
      if (stored.statusFilter) setStatusFilter(stored.statusFilter);
      if (stored.sort) setSort(stored.sort);
    }
  );
  usePersistedScroll(scrollRef, "orders-table");

  const companyOptions = React.useMemo(() => {
    const companies = Array.from(new Set((data ?? []).map((r) => r.company ?? "__empty__")));
    return companies
      .map((c) => ({ value: c, label: c === "__empty__" ? "Пусто" : c }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [data]);

  const clientOptions = React.useMemo(() => {
    const list = data ?? [];
    const map = new Map<string, string>();
    for (const r of list) {
      if (!r.clientId || !r.clientName) continue;
      map.set(r.clientId, r.clientName);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "ru"))
      .map(([value, label]) => ({ value, label }));
  }, [data]);

  const projectOptions = React.useMemo(() => {
    const list = data ?? [];
    const map = new Map<string, string>();
    for (const r of list) map.set(r.projectId, r.projectName);
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "ru"))
      .map(([value, label]) => ({ value, label }));
  }, [data]);

  const rows = React.useMemo(() => {
    let list = data ?? [];
    if (companyFilter.length) list = list.filter((r) => companyFilter.includes(r.company ?? "__empty__"));
    if (clientFilter.length) list = list.filter((r) => clientFilter.includes(r.clientId ?? ""));
    if (projectFilter.length) list = list.filter((r) => projectFilter.includes(r.projectId));
    if (statusFilter.length) list = list.filter((r) => statusFilter.includes(r.status));
    list = [...list].sort((a, b) => {
      const av = a[sort.field];
      const bv = b[sort.field];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av ?? "").localeCompare(String(bv ?? ""), "ru");
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data, companyFilter, clientFilter, projectFilter, statusFilter, sort]);

  function handleSort(field: string, dir: SortDir) {
    setSort({ field: field as SortField, dir });
  }

  async function handleArchive(row: Row) {
    const res = await fetch(`/api/orders/${row.id}/archive`, { method: "POST" });
    if (!res.ok) return toast.error("Не удалось архивировать");
    toast.success(`Заказ №${row.orderNumber} архивирован`);
    mutate();
  }
  async function handleUnarchive(row: Row) {
    const res = await fetch(`/api/orders/${row.id}/archive`, { method: "DELETE" });
    if (!res.ok) return toast.error("Не удалось вернуть из архива");
    toast.success(`Заказ №${row.orderNumber} снова активен`);
    mutate();
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] min-h-0">
      <PageHeader
        title="Заказы"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4 mr-1" /> Добавить заказ
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <MultiSelectFilter
          label="Компания"
          options={companyOptions}
          value={companyFilter}
          onChange={setCompanyFilter}
        />
        <MultiSelectFilter
          label="Клиент"
          options={clientOptions}
          value={clientFilter}
          onChange={setClientFilter}
        />
        <MultiSelectFilter
          label="Проект"
          options={projectOptions}
          value={projectFilter}
          onChange={setProjectFilter}
        />
        <MultiSelectFilter
          label="Статус"
          options={Object.entries(ENTITY_STATUSES).map(([value, { label }]) => ({ value, label }))}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      </div>

      <Table containerRef={scrollRef} containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto">
          <TableHeader>
            <TableRow>
              <SortableHead
                field="orderNumber"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
              >
                №
              </SortableHead>
              <SortableHead
                field="description"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
              >
                Описание
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
                field="projectName"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
              >
                Проект
              </SortableHead>
              <TableHead>Договор / ДС</TableHead>
              <SortableHead
                field="status"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
              >
                Статус
              </SortableHead>
              <TableHead className={stickyActionsHead} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-neutral-500 py-8">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-neutral-500 py-8">
                  Нет заказов
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className={r.status === "archived" ? "bg-neutral-100 text-neutral-400" : ""}>
                  <TableCell className="font-medium tabular-nums">{r.orderNumber}</TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell className="text-sm">{r.clientName ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.projectName}</TableCell>
                  <TableCell className="text-sm">{r.contractNumber ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge dict={ENTITY_STATUSES} value={r.status} />
                  </TableCell>
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

      {editing && projects && (
        <OrderEditDialog
          row={editing === "new" ? null : editing}
          projects={projects}
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
        title="Архивировать заказ?"
        description={
          archiveTarget?.hasUnpaidCharges
            ? `У заказа №${archiveTarget.orderNumber} есть неоплаченные начисления. Архивировать всё равно? Начисления продолжат работать со ссылкой на архивный заказ.`
            : `Заказ №${archiveTarget?.orderNumber} исчезнет из выпадающих списков (Начисления). История останется.`
        }
        confirmLabel="Архивировать"
        destructive
        onConfirm={async () => {
          if (archiveTarget) await handleArchive(archiveTarget);
        }}
      />
      <ConfirmDialog
        open={!!unarchiveTarget}
        onOpenChange={(o) => !o && setUnarchiveTarget(null)}
        title="Вернуть заказ из архива?"
        description={`Заказ №${unarchiveTarget?.orderNumber} снова станет доступен в активных списках.`}
        confirmLabel="Вернуть"
        onConfirm={async () => {
          if (unarchiveTarget) await handleUnarchive(unarchiveTarget);
        }}
      />
    </div>
  );
}

function OrderEditDialog({
  row,
  projects,
  onClose,
  onSaved,
}: {
  row: Row | null;
  projects: ProjectOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = React.useState(row?.description ?? "");
  const [projectId, setProjectId] = React.useState(row?.projectId ?? "");
  const [contractNumber, setContractNumber] = React.useState(row?.contractNumber ?? "");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    setDescription(row?.description ?? "");
    setProjectId(row?.projectId ?? "");
    setContractNumber(row?.contractNumber ?? "");
  }, [row]);

  const activeProjects = sortByNameRu(
    projects.filter((p) => p.status === "active" || p.id === row?.projectId)
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return toast.error("Введите описание заказа");
    if (!projectId) return toast.error("Выберите проект");

    setSubmitting(true);
    const isNew = !row;
    const res = await fetch(isNew ? "/api/orders" : `/api/orders/${row.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: description.trim(),
        projectId,
        contractNumber: contractNumber.trim() || null,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Не удалось сохранить");
      return;
    }
    toast.success(isNew ? "Заказ создан" : "Заказ обновлён");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? `Редактировать заказ №${row.orderNumber}` : "Новый заказ"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="description">Описание заказа</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Например: SMM-ведение, Q3 2026"
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="projectId">Проект</Label>
            <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
              <SelectTrigger id="projectId">
                <SelectValue placeholder="Выберите проект">
                  {projectId
                    ? (activeProjects.find((p) => p.id === projectId)?.name ?? projectId)
                    : undefined}
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
            <Label htmlFor="contractNumber">Номер договора / допсоглашения (опционально)</Label>
            <Input
              id="contractNumber"
              value={contractNumber}
              onChange={(e) => setContractNumber(e.target.value)}
              placeholder="Например: ДС №12 от 01.06.2026"
            />
          </div>
          {!row && (
            <div className="rounded-md bg-neutral-50 border border-neutral-200 px-3 py-2 text-sm text-neutral-600">
              Номер заказа будет назначен автоматически (следующий после максимального; стартовый — 3000).
            </div>
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
  );
}
