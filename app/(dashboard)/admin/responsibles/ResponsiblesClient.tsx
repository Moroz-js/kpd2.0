"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { Archive, ArchiveRestore } from "lucide-react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { ConfirmDialog } from "@/components/ui-custom/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner, compactTable, compactHead, compactCell, compactCellClip } from "@/lib/table-styles";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";

type Row = {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  projectCount: number;
  projects: { id: string; name: string; status: string | null }[];
  createdAt: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<Row[]>);

type SortField = "fullName" | "projectCount";
type SortDir = "asc" | "desc";

export function ResponsiblesClient() {
  const { data, isLoading, mutate } = useSWR<Row[]>("/api/responsibles", fetcher);
  const [statusFilter, setStatusFilter] = React.useState<string[]>(["active"]);
  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }>({
    field: "fullName",
    dir: "asc",
  });
  const [archiveTarget, setArchiveTarget] = React.useState<Row | null>(null);
  const [unarchiveTarget, setUnarchiveTarget] = React.useState<Row | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  usePersistedInterfaceState(
    "responsibles",
    { statusFilter, sort },
    (stored) => {
      if (stored.statusFilter) setStatusFilter(stored.statusFilter);
      if (stored.sort) setSort(stored.sort);
    }
  );
  usePersistedScroll(scrollRef, "responsibles-table");

  const rows = React.useMemo(() => {
    let list = data ?? [];
    if (statusFilter.length) {
      list = list.filter((r) =>
        statusFilter.includes(r.isActive ? "active" : "archived")
      );
    }
    list = [...list].sort((a, b) => {
      const av = a[sort.field];
      const bv = b[sort.field];
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "ru");
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data, statusFilter, sort]);

  function handleSort(field: string, dir: SortDir) {
    setSort({ field: field as SortField, dir });
  }

  async function handleArchive(row: Row) {
    const res = await fetch(`/api/responsibles/${row.id}/archive`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? "Не удалось архивировать");
      return;
    }
    toast.success(`«${row.fullName}» архивирован`);
    mutate();
  }
  async function handleUnarchive(row: Row) {
    const res = await fetch(`/api/responsibles/${row.id}/archive`, { method: "DELETE" });
    if (!res.ok) return toast.error("Не удалось вернуть из архива");
    toast.success(`«${row.fullName}» снова активен`);
    mutate();
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] min-h-0">
      <PageHeader title="Руководители проекта" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <MultiSelectFilter
          label="Статус"
          options={[
            { value: "active", label: "Активный" },
            { value: "archived", label: "Архивный" },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      </div>

      <Table className={compactTable} containerRef={scrollRef} containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto">
          <TableHeader>
            <TableRow>
              <SortableHead field="fullName" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort} className={cn(compactHead, "w-[220px] max-w-[220px]")}>
                Имя
              </SortableHead>
              <TableHead className={cn(compactHead, "w-28")}>Статус</TableHead>
              <SortableHead
                field="projectCount"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
                className={cn(compactHead, "text-right w-24")}
              >
                Кол-во проектов
              </SortableHead>
              <TableHead className={cn(compactHead, "w-[320px] max-w-[320px]")}>Проекты как руководитель</TableHead>
              <TableHead className={stickyActionsHead} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-neutral-500 py-8">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-neutral-500 py-8">
                  Нет руководителей проектов
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className={!r.isActive ? "bg-neutral-50 text-neutral-400" : ""}>
                  <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
                    <div className="font-medium truncate">{r.fullName}</div>
                    <div className="text-xs text-neutral-500 truncate">{r.email}</div>
                  </TableCell>
                  <TableCell className={compactCell}>
                    <StatusBadge
                      tone={r.isActive ? "green" : "slate"}
                      label={r.isActive ? "Активный" : "Архивный"}
                    />
                  </TableCell>
                  <TableCell className={cn(compactCell, "text-right tabular-nums")}>{r.projectCount}</TableCell>
                  <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
                    {r.projects.length === 0
                      ? <span className="text-neutral-400">—</span>
                      : r.projects.map((p) => (
                          <Link
                            key={p.id}
                            href={`/admin/projects/${p.id}`}
                            className={cn(
                              "block truncate hover:underline",
                              p.status === "archived" ? "text-neutral-400" : "text-blue-600"
                            )}
                          >
                            {p.name}
                          </Link>
                        ))
                    }
                  </TableCell>
                  <TableCell className={cn(stickyActionsCell, !r.isActive && "bg-neutral-50")}>
                    <div className={stickyActionsInner}>
                      {r.isActive ? (
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

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        title="Архивировать руководителя проекта?"
        description={`«${archiveTarget?.fullName}» станет недоступен для назначения на новые проекты. Текущие проекты сохранятся.`}
        confirmLabel="Архивировать"
        destructive
        onConfirm={async () => {
          if (archiveTarget) await handleArchive(archiveTarget);
        }}
      />
      <ConfirmDialog
        open={!!unarchiveTarget}
        onOpenChange={(o) => !o && setUnarchiveTarget(null)}
        title="Вернуть руководителя проекта из архива?"
        description={`«${unarchiveTarget?.fullName}» снова станет доступен в активных списках.`}
        confirmLabel="Вернуть"
        onConfirm={async () => {
          if (unarchiveTarget) await handleUnarchive(unarchiveTarget);
        }}
      />
    </div>
  );
}


