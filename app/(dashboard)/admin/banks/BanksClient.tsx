"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { FilterResetButton } from "@/components/ui-custom/FilterResetButton";
import { EntityActivityHistory } from "@/components/ui-custom/EntityActivityHistory";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { ConfirmDialog } from "@/components/ui-custom/ConfirmDialog";
import { ENTITY_STATUSES } from "@/lib/statuses";
import { BANK_COUNTRIES, type BankCountry } from "@/lib/banks";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import {
  stickyActionsHead,
  stickyActionsCell,
  stickyActionsInner,
  compactTable,
  compactHead,
  compactCell,
  compactCellClip,
} from "@/lib/table-styles";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";
import { useUrlSyncedFilters } from "@/lib/useUrlSyncedFilters";
import { useCompatibleFilterOptions } from "@/lib/useCompatibleFilterOptions";

type Row = {
  id: string;
  name: string;
  country: string;
  status: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<Row[]>);

type SortField = "name" | "country" | "status";
type SortDir = "asc" | "desc";

export function BanksClient() {
  const { data, isLoading, mutate } = useSWR<Row[]>("/api/banks", fetcher);

  const [countryFilter, setCountryFilter] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<string[]>(["active"]);
  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }>({
    field: "name",
    dir: "asc",
  });
  const hasActiveFilters = countryFilter.length > 0 || statusFilter.length > 0;
  const resetFilters = () => {
    setCountryFilter([]);
    setStatusFilter([]);
  };
  const urlFilters = useUrlSyncedFilters([
    {
      stateKey: "countryFilter",
      param: "country",
      kind: "array",
      value: countryFilter,
      defaultValue: [],
      setValue: setCountryFilter,
    },
    {
      stateKey: "statusFilter",
      param: "status",
      kind: "array",
      value: statusFilter,
      defaultValue: [],
      setValue: setStatusFilter,
    },
  ]);

  const [editing, setEditing] = React.useState<Row | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<Row | null>(null);
  const [unarchiveTarget, setUnarchiveTarget] = React.useState<Row | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  usePersistedInterfaceState(
    "banks",
    { countryFilter, statusFilter, sort },
    (stored) => {
      urlFilters.restorePersisted(stored);
      if (stored.sort) setSort(stored.sort);
    }
  );
  usePersistedScroll(scrollRef, "banks-table", {
    enabled: !isLoading && !!data,
    signature: { countryFilter, statusFilter, sort },
  });

  const rows = React.useMemo(() => {
    let list = data ?? [];
    if (countryFilter.length) list = list.filter((r) => countryFilter.includes(r.country));
    if (statusFilter.length) list = list.filter((r) => statusFilter.includes(r.status));
    list = [...list].sort((a, b) => {
      const av = a[sort.field];
      const bv = b[sort.field];
      const cmp = String(av).localeCompare(String(bv), "ru");
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data, countryFilter, statusFilter, sort]);

  const compatibleValues = useCompatibleFilterOptions(data, [
    {
      key: "country",
      value: countryFilter,
      setValue: setCountryFilter,
      matches: (row, value) => !value.length || value.includes(row.country),
      values: (row) => [row.country],
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
    const res = await fetch(`/api/banks/${row.id}/archive`, { method: "POST" });
    if (!res.ok) return toast.error("Не удалось архивировать");
    toast.success(`Банк «${row.name}» архивирован`);
    mutate();
  }
  async function handleUnarchive(row: Row) {
    const res = await fetch(`/api/banks/${row.id}/archive`, { method: "DELETE" });
    if (!res.ok) return toast.error("Не удалось вернуть из архива");
    toast.success(`Банк «${row.name}» снова активен`);
    mutate();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => setEditing("new")}>
          <Plus className="mr-1 h-4 w-4" /> Добавить банк
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <FilterResetButton active={hasActiveFilters} onClick={resetFilters} />
          <MultiSelectFilter
            label="Страна"
            options={Object.entries(BANK_COUNTRIES)
              .map(([value, label]) => ({ value, label }))
              .filter((option) => compatibleValues.country?.has(option.value))}
            value={countryFilter}
            onChange={setCountryFilter}
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
      </div>

      <Table
        className={compactTable}
        containerRef={scrollRef}
        containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto"
      >
        <TableHeader>
          <TableRow>
            <SortableHead
              field="name"
              sortBy={sort.field}
              sortDir={sort.dir}
              onSort={handleSort}
              className={cn(compactHead, "w-[320px] max-w-[320px]")}
            >
              Банк
            </SortableHead>
            <SortableHead
              field="country"
              sortBy={sort.field}
              sortDir={sort.dir}
              onSort={handleSort}
              className={cn(compactHead, "w-40")}
            >
              Страна
            </SortableHead>
            <SortableHead
              field="status"
              sortBy={sort.field}
              sortDir={sort.dir}
              onSort={handleSort}
              className={cn(compactHead, "w-28")}
            >
              Статус
            </SortableHead>
            <TableHead className={stickyActionsHead} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-neutral-500 py-8">
                Загрузка...
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-neutral-500 py-8">
                Нет банков
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className={cn(compactCell, compactCellClip, "font-medium whitespace-normal")}>
                  {r.name}
                </TableCell>
                <TableCell className={cn(compactCell, compactCellClip)}>
                  {BANK_COUNTRIES[r.country as BankCountry] ?? r.country}
                </TableCell>
                <TableCell className={compactCell}>
                  <StatusBadge dict={ENTITY_STATUSES} value={r.status} />
                </TableCell>
                <TableCell className={stickyActionsCell}>
                  <div className={stickyActionsInner}>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)} title="Редактировать">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {r.status === "active" ? (
                      <Button size="sm" variant="ghost" onClick={() => setArchiveTarget(r)} title="Архивировать">
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

      {editing && (
        <BankEditDialog
          row={editing === "new" ? null : editing}
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
        title="Архивировать банк?"
        description={`Банк «${archiveTarget?.name}» станет недоступен в карточке контрагента. Уже сохранённые реквизиты не изменятся.`}
        confirmLabel="Архивировать"
        destructive
        onConfirm={async () => {
          if (archiveTarget) await handleArchive(archiveTarget);
        }}
      />
      <ConfirmDialog
        open={!!unarchiveTarget}
        onOpenChange={(o) => !o && setUnarchiveTarget(null)}
        title="Вернуть банк из архива?"
        description={`«${unarchiveTarget?.name}» снова появится в списках.`}
        confirmLabel="Вернуть"
        onConfirm={async () => {
          if (unarchiveTarget) await handleUnarchive(unarchiveTarget);
        }}
      />
    </div>
  );
}

function BankEditDialog({
  row,
  onClose,
  onSaved,
}: {
  row: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(row?.name ?? "");
  const [country, setCountry] = React.useState(row?.country ?? "ru");
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Введите название");
    if (!country) return toast.error("Выберите страну");
    setSubmitting(true);
    const isNew = !row;
    const res = await fetch(isNew ? "/api/banks" : `/api/banks/${row.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), country }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Не удалось сохранить");
      return;
    }
    toast.success(isNew ? "Банк создан" : "Банк обновлён");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? "Редактировать банк" : "Новый банк"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bank-name">Название</Label>
            <Input
              id="bank-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Тинькофф"
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Страна</Label>
            <SearchableSelect
              value={country}
              onValueChange={setCountry}
              options={Object.entries(BANK_COUNTRIES).map(([value, label]) => ({
                value,
                label,
              }))}
              placeholder="Страна"
            />
          </div>
          {row && <EntityActivityHistory entityType="Bank" entityId={row.id} />}
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
