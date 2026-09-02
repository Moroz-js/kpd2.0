"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { FilterResetButton } from "@/components/ui-custom/FilterResetButton";
import { EntityActivityHistory } from "@/components/ui-custom/EntityActivityHistory";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { ConfirmDialog } from "@/components/ui-custom/ConfirmDialog";
import { ExpandableListCell } from "@/components/ui-custom/ExpandableListCell";
import { CLIENT_DEPARTMENTS, ENTITY_STATUSES } from "@/lib/statuses";
import { formatMoney, formatMoneyRub, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DepartmentCombobox } from "@/components/ui-custom/DepartmentCombobox";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner, compactTable, compactHead, compactCell, compactCellClip } from "@/lib/table-styles";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";
import { useUrlSyncedFilters } from "@/lib/useUrlSyncedFilters";
import { useCompatibleFilterOptions } from "@/lib/useCompatibleFilterOptions";

type Row = {
  id: string;
  name: string;
  company: string;
  department: string;
  status: string;
  projects: { id: string; name: string }[];
  projectNames: string[];
  projectsStatus: "has_active" | "all_archived" | "none";
  revenue: number;
  createdAt: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<Row[]>);

type SortField = "name" | "company" | "department" | "createdAt" | "revenue";
type SortDir = "asc" | "desc";

const PROJECTS_STATUS_LABEL: Record<Row["projectsStatus"], string> = {
  has_active: "Есть активные проекты",
  all_archived: "Все проекты архивные",
  none: "Нет проектов",
};

const PROJECTS_STATUS_TONE: Record<Row["projectsStatus"], "green" | "slate" | "gray"> = {
  has_active: "green",
  all_archived: "slate",
  none: "gray",
};

export function ClientsClient() {
  const { data, isLoading, mutate } = useSWR<Row[]>("/api/clients", fetcher);
  const [companyFilter, setCompanyFilter] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<string[]>(["active"]);
  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }>({
    field: "createdAt",
    dir: "desc",
  });
  const hasActiveFilters = companyFilter.length > 0 || statusFilter.length > 0;
  const resetFilters = () => {
    setCompanyFilter([]);
    setStatusFilter([]);
  };
  const urlFilters = useUrlSyncedFilters([
    { stateKey: "companyFilter", param: "company", kind: "array", value: companyFilter, defaultValue: [], setValue: setCompanyFilter },
    { stateKey: "statusFilter", param: "status", kind: "array", value: statusFilter, defaultValue: [], setValue: setStatusFilter },
  ]);
  const [editing, setEditing] = React.useState<Row | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<Row | null>(null);
  const [unarchiveTarget, setUnarchiveTarget] = React.useState<Row | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  usePersistedInterfaceState(
    "clients",
    { companyFilter, statusFilter, sort },
    (stored) => {
      urlFilters.restorePersisted(stored);
      if (stored.sort) setSort(stored.sort);
    }
  );
  usePersistedScroll(scrollRef, "clients-table", {
    enabled: !isLoading && !!data,
    signature: { companyFilter, statusFilter, sort },
  });

  const departmentUsage = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of data ?? []) {
      if (!r.department) continue;
      counts[r.department] = (counts[r.department] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  const existingDepartments = React.useMemo(() => {
    const list = data ?? [];
    return Array.from(new Set(list.map((r) => r.department).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "ru")
    );
  }, [data]);

  const companyOptions = React.useMemo(() => {
    const list = data ?? [];
    return Array.from(new Set(list.map((r) => r.company)))
      .sort((a, b) => a.localeCompare(b, "ru"))
      .map((c) => ({ value: c, label: c }));
  }, [data]);

  const rows = React.useMemo(() => {
    let list = data ?? [];
    if (companyFilter.length) list = list.filter((r) => companyFilter.includes(r.company));
    if (statusFilter.length) list = list.filter((r) => statusFilter.includes(r.status));
    list = [...list].sort((a, b) => {
      const av = a[sort.field];
      const bv = b[sort.field];
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "ru");
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data, companyFilter, statusFilter, sort]);

  const compatibleValues = useCompatibleFilterOptions(data, [
    {
      key: "company",
      value: companyFilter,
      setValue: setCompanyFilter,
      matches: (row, value) => !value.length || value.includes(row.company),
      values: (row) => [row.company],
    },
    {
      key: "status",
      value: statusFilter,
      setValue: setStatusFilter,
      matches: (row, value) => !value.length || value.includes(row.status),
      values: (row) => [row.status],
    },
  ]);

  const filteredRevenue = React.useMemo(
    () => rows.reduce((s, r) => s + (r.revenue ?? 0), 0),
    [rows]
  );

  function handleSort(field: string, dir: SortDir) {
    setSort({ field: field as SortField, dir });
  }

  async function handleArchive(row: Row) {
    const res = await fetch(`/api/clients/${row.id}/archive`, { method: "POST" });
    if (!res.ok) return toast.error("Не удалось архивировать");
    toast.success(`Клиент «${row.name}» архивирован`);
    mutate();
  }
  async function handleUnarchive(row: Row) {
    const res = await fetch(`/api/clients/${row.id}/archive`, { method: "DELETE" });
    if (!res.ok) return toast.error("Не удалось вернуть из архива");
    toast.success(`Клиент «${row.name}» снова активен`);
    mutate();
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Клиенты"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4 mr-1" /> Добавить клиента
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterResetButton active={hasActiveFilters} onClick={resetFilters} />
        <MultiSelectFilter
          label="Компания"
          options={companyOptions.filter((option) => compatibleValues.company?.has(option.value))}
          value={companyFilter}
          onChange={setCompanyFilter}
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

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-3 px-3 py-2 rounded-lg bg-neutral-50 border border-neutral-200 shrink-0">
          <span className="text-xs text-neutral-500">{rows.length} клиентов</span>
          <span className="text-xs text-neutral-500">Выручка:</span>
          <span className="text-xs font-semibold tabular-nums text-neutral-900">{formatMoneyRub(filteredRevenue)}</span>
        </div>
      )}

      <Table className={compactTable} containerRef={scrollRef} containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto">
          <TableHeader>
            <TableRow>
              <SortableHead field="name" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort} className={cn(compactHead, "w-[240px] max-w-[240px]")}>
                Клиент
              </SortableHead>
              <TableHead className={cn(compactHead, "w-52 max-w-52")}>Проекты клиента</TableHead>
              <TableHead className={cn(compactHead, "w-36")}>Статус проектов</TableHead>
              <SortableHead
                field="revenue"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
                className={cn(compactHead, "text-right w-32")}
              >
                Выручка
              </SortableHead>
              <SortableHead field="createdAt" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort} className={cn(compactHead, "w-28")}>
                Создан
              </SortableHead>
              <TableHead className={stickyActionsHead} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-neutral-500 py-8">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-neutral-500 py-8">
                  Нет клиентов
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className={r.status === "archived" ? "bg-neutral-100 text-neutral-400" : ""}>
                  <TableCell className={cn(compactCell, compactCellClip, "font-medium whitespace-normal")}>{r.name}</TableCell>
                  <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
                    <ExpandableListCell
                      items={r.projects.map((p) => p.name)}
                      renderItem={(name) => {
                        const p = r.projects.find((x) => x.name === name);
                        return p ? (
                          <Link
                            href={`/admin/projects/${p.id}`}
                            className="hover:underline text-blue-600"
                          >
                            {name}
                          </Link>
                        ) : name;
                      }}
                    />
                  </TableCell>
                  <TableCell className={compactCell}>
                    <StatusBadge
                      tone={PROJECTS_STATUS_TONE[r.projectsStatus]}
                      label={PROJECTS_STATUS_LABEL[r.projectsStatus]}
                    />
                  </TableCell>
                  <TableCell className={cn(compactCell, "text-right tabular-nums font-semibold")}>{formatMoney(r.revenue)}</TableCell>
                  <TableCell className={compactCell}>{formatDate(r.createdAt)}</TableCell>
                  <TableCell className={cn(stickyActionsCell, r.status === "archived" && "bg-neutral-100 text-neutral-400")}>
                    <div className={stickyActionsInner}>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)} title="Редактировать">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {r.status === "active" ? (
                        <Button size="sm" variant="ghost" onClick={() => setArchiveTarget(r)} title="Архивировать">
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setUnarchiveTarget(r)} title="Вернуть из архива">
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

      {editing && (
        <ClientEditDialog
          row={editing === "new" ? null : editing}
          existingDepartments={existingDepartments}
          departmentUsage={departmentUsage}
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
        title="Архивировать клиента?"
        description={`«${archiveTarget?.name}» исчезнет из выпадающих списков при создании проектов. Существующие проекты клиента останутся активными — их можно архивировать отдельно.`}
        confirmLabel="Архивировать"
        destructive
        onConfirm={async () => {
          if (archiveTarget) await handleArchive(archiveTarget);
        }}
      />
      <ConfirmDialog
        open={!!unarchiveTarget}
        onOpenChange={(o) => !o && setUnarchiveTarget(null)}
        title="Вернуть клиента из архива?"
        description={`«${unarchiveTarget?.name}» снова станет доступен при создании проектов.`}
        confirmLabel="Вернуть"
        onConfirm={async () => {
          if (unarchiveTarget) await handleUnarchive(unarchiveTarget);
        }}
      />
    </div>
  );
}

function ClientEditDialog({
  row,
  existingDepartments,
  departmentUsage,
  onClose,
  onSaved,
}: {
  row: Row | null;
  existingDepartments: string[];
  departmentUsage: Record<string, number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [company, setCompany] = React.useState(row?.company ?? "");
  const [department, setDepartment] = React.useState(row?.department ?? "");
  const [extraDepartments, setExtraDepartments] = React.useState<string[]>([]);
  const [hiddenDepartments, setHiddenDepartments] = React.useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = React.useState(false);

  const departmentOptions = React.useMemo(() => {
    const set = new Set<string>([
      ...CLIENT_DEPARTMENTS,
      ...existingDepartments,
      ...extraDepartments,
    ]);
    if (row?.department) set.add(row.department);
    return Array.from(set)
      .filter((d) => !hiddenDepartments.has(d))
      .sort((a, b) => a.localeCompare(b, "ru"));
  }, [existingDepartments, extraDepartments, hiddenDepartments, row?.department]);

  React.useEffect(() => {
    setCompany(row?.company ?? "");
    setDepartment(row?.department ?? "");
    setExtraDepartments([]);
    setHiddenDepartments(new Set());
  }, [row]);

  function handleAddDepartment(name: string) {
    setExtraDepartments((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setDepartment(name);
  }

  function handleRemoveDepartment(name: string) {
    const usage = departmentUsage[name] ?? 0;
    if (usage > 0) {
      toast.error("Нельзя удалить: департамент привязан к клиентам. Смените департамент у клиентов.");
      return;
    }
    setHiddenDepartments((prev) => new Set([...prev, name]));
    setExtraDepartments((prev) => prev.filter((d) => d !== name));
    if (department === name) setDepartment("");
  }

  const preview = department.trim() && company.trim() ? `${department.trim()} – ${company.trim()}` : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!company.trim() || !department.trim()) return toast.error("Заполните Компанию и Департамент");
    setSubmitting(true);
    const isNew = !row;
    const res = await fetch(isNew ? "/api/clients" : `/api/clients/${row.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: company.trim(), department: department.trim() }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Не удалось сохранить");
      return;
    }
    toast.success(isNew ? "Клиент создан" : "Клиент обновлён");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? "Редактировать клиента" : "Новый клиент"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="department">Департамент</Label>
            <DepartmentCombobox
              id="department"
              value={department}
              onValueChange={setDepartment}
              options={departmentOptions}
              onAddOption={handleAddDepartment}
              onRemoveOption={handleRemoveDepartment}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company">Компания</Label>
            <Input
              id="company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Например: Базис"
              required
            />
          </div>
          {preview && (
            <div className="rounded-md bg-neutral-50 border border-neutral-200 px-3 py-2 text-sm">
              <span className="text-neutral-500">Имя клиента: </span>
              <span className="font-medium">{preview}</span>
            </div>
          )}
          {row && (
            <EntityActivityHistory entityType="Client" entityId={row.id} />
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
