"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { ConfirmDialog } from "@/components/ui-custom/ConfirmDialog";
import { ENTITY_STATUSES, WORK_TYPE_SEGMENTS, PROJECT_TYPES } from "@/lib/statuses";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { DepartmentCombobox } from "@/components/ui-custom/DepartmentCombobox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner, compactTable, compactHead, compactCell, compactCellClip } from "@/lib/table-styles";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";

type Row = {
  id: string;
  name: string;
  segment: string;
  status: string;
  projectNames: string[];
  projectCount: number;
  projectTypes: string[];
  estimateSources: string[];
  issuedWorkCount: number;
  isUnused: boolean;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<Row[]>);

type SortField = "name" | "segment" | "status";
type SortDir = "asc" | "desc";

const SOURCE_LABEL: Record<string, string> = {
  personal: "Личная смета",
  "other-expense": "Прочие траты",
};

export function WorkTypesClient() {
  const { data, isLoading, mutate } = useSWR<Row[]>("/api/work-types", fetcher);

  const [segmentFilter, setSegmentFilter] = React.useState<string[]>([]);
  const [projectTypeFilter, setProjectTypeFilter] = React.useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<string[]>(["active"]);
  const [usageFilter, setUsageFilter] = React.useState<string[]>([]);
  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }>({
    field: "name",
    dir: "asc",
  });

  const [editing, setEditing] = React.useState<Row | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<Row | null>(null);
  const [unarchiveTarget, setUnarchiveTarget] = React.useState<Row | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  usePersistedInterfaceState(
    "work-types",
    {
      segmentFilter,
      projectTypeFilter,
      sourceFilter,
      statusFilter,
      usageFilter,
      sort,
    },
    (stored) => {
      if (stored.segmentFilter) setSegmentFilter(stored.segmentFilter);
      if (stored.projectTypeFilter) setProjectTypeFilter(stored.projectTypeFilter);
      if (stored.sourceFilter) setSourceFilter(stored.sourceFilter);
      if (stored.statusFilter) setStatusFilter(stored.statusFilter);
      if (stored.usageFilter) setUsageFilter(stored.usageFilter);
      if (stored.sort) setSort(stored.sort);
    }
  );
  usePersistedScroll(scrollRef, "work-types-table");

  const segmentUsage = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of data ?? []) {
      if (!r.segment) continue;
      counts[r.segment] = (counts[r.segment] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  const existingSegments = React.useMemo(() => {
    const list = data ?? [];
    return Array.from(new Set(list.map((r) => r.segment).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "ru")
    );
  }, [data]);

  const segmentFilterOptions = React.useMemo(() => {
    const set = new Set<string>([...WORK_TYPE_SEGMENTS, ...existingSegments]);
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "ru"))
      .map((s) => ({ value: s, label: s }));
  }, [existingSegments]);

  const rows = React.useMemo(() => {
    let list = data ?? [];
    if (segmentFilter.length) list = list.filter((r) => segmentFilter.includes(r.segment));
    if (statusFilter.length) list = list.filter((r) => statusFilter.includes(r.status));
    if (projectTypeFilter.length) {
      list = list.filter((r) => r.projectTypes.some((t) => projectTypeFilter.includes(t)));
    }
    if (sourceFilter.length) {
      list = list.filter((r) => r.estimateSources.some((s) => sourceFilter.includes(s)));
    }
    if (usageFilter.length) {
      list = list.filter((r) => usageFilter.includes(r.isUnused ? "unused" : "used"));
    }
    list = [...list].sort((a, b) => {
      // Unused always at bottom
      if (a.isUnused !== b.isUnused) return a.isUnused ? 1 : -1;
      const av = a[sort.field];
      const bv = b[sort.field];
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "ru");
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data, segmentFilter, statusFilter, projectTypeFilter, sourceFilter, usageFilter, sort]);

  function handleSort(field: string, dir: SortDir) {
    setSort({ field: field as SortField, dir });
  }

  async function handleArchive(row: Row) {
    const res = await fetch(`/api/work-types/${row.id}/archive`, { method: "POST" });
    if (!res.ok) return toast.error("Не удалось архивировать");
    toast.success(`Вид работ «${row.name}» архивирован`);
    mutate();
  }
  async function handleUnarchive(row: Row) {
    const res = await fetch(`/api/work-types/${row.id}/archive`, { method: "DELETE" });
    if (!res.ok) return toast.error("Не удалось вернуть из архива");
    toast.success(`Вид работ «${row.name}» снова активен`);
    mutate();
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] min-h-0">
      <PageHeader
        title="Виды работ"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4 mr-1" /> Добавить вид работ
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <MultiSelectFilter
          label="Сегмент"
          options={segmentFilterOptions}
          value={segmentFilter}
          onChange={setSegmentFilter}
        />
        <MultiSelectFilter
          label="Типы проектов"
          options={Object.entries(PROJECT_TYPES).map(([value, label]) => ({ value, label }))}
          value={projectTypeFilter}
          onChange={setProjectTypeFilter}
        />
        <MultiSelectFilter
          label="Типы смет"
          options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))}
          value={sourceFilter}
          onChange={setSourceFilter}
        />
        <MultiSelectFilter
          label="Статус"
          options={Object.entries(ENTITY_STATUSES).map(([value, { label }]) => ({ value, label }))}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <MultiSelectFilter
          label="Использование"
          options={[
            { value: "used", label: "Использовался" },
            { value: "unused", label: "Не использовался" },
          ]}
          value={usageFilter}
          onChange={setUsageFilter}
        />
      </div>

      <Table className={compactTable} containerRef={scrollRef} containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto">
          <TableHeader>
            <TableRow>
              <SortableHead field="name" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort} className={cn(compactHead, "w-[320px] max-w-[320px]")}>
                Вид работ
              </SortableHead>
              <SortableHead field="segment" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort} className={cn(compactHead, "w-40")}>
                Сегмент
              </SortableHead>
              <SortableHead field="status" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort} className={cn(compactHead, "w-28")}>
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
                  Нет видов работ
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className={cn(compactCell, compactCellClip, "font-medium whitespace-normal")}>
                    <span className={r.isUnused ? "text-neutral-400" : ""}>{r.name}</span>
                    {r.isUnused && <span className="ml-1 text-xs text-neutral-400 font-normal">(не используется)</span>}
                  </TableCell>
                  <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>{r.segment}</TableCell>
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
        <WorkTypeEditDialog
          row={editing === "new" ? null : editing}
          existingSegments={existingSegments}
          segmentUsage={segmentUsage}
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
        title="Архивировать вид работ?"
        description={`Вид работ «${archiveTarget?.name}» станет недоступен для выбора в новых работах. Существующие записи сохранятся.`}
        confirmLabel="Архивировать"
        destructive
        onConfirm={async () => {
          if (archiveTarget) await handleArchive(archiveTarget);
        }}
      />
      <ConfirmDialog
        open={!!unarchiveTarget}
        onOpenChange={(o) => !o && setUnarchiveTarget(null)}
        title="Вернуть вид работ из архива?"
        description={`«${unarchiveTarget?.name}» снова станет доступен в активных списках.`}
        confirmLabel="Вернуть"
        onConfirm={async () => {
          if (unarchiveTarget) await handleUnarchive(unarchiveTarget);
        }}
      />
    </div>
  );
}

function WorkTypeEditDialog({
  row,
  existingSegments,
  segmentUsage,
  onClose,
  onSaved,
}: {
  row: Row | null;
  existingSegments: string[];
  segmentUsage: Record<string, number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(row?.name ?? "");
  const [segment, setSegment] = React.useState(row?.segment ?? "");
  const [extraSegments, setExtraSegments] = React.useState<string[]>([]);
  const [hiddenSegments, setHiddenSegments] = React.useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = React.useState(false);

  const segmentOptions = React.useMemo(() => {
    const set = new Set<string>([...WORK_TYPE_SEGMENTS, ...existingSegments, ...extraSegments]);
    if (row?.segment) set.add(row.segment);
    return Array.from(set)
      .filter((s) => !hiddenSegments.has(s))
      .sort((a, b) => a.localeCompare(b, "ru"));
  }, [existingSegments, extraSegments, hiddenSegments, row?.segment]);

  React.useEffect(() => {
    setName(row?.name ?? "");
    setSegment(row?.segment ?? "");
    setExtraSegments([]);
    setHiddenSegments(new Set());
  }, [row]);

  function handleAddSegment(name: string) {
    setExtraSegments((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setSegment(name);
  }

  function handleRemoveSegment(name: string) {
    const usage = segmentUsage[name] ?? 0;
    if (usage > 0) {
      toast.error("Нельзя удалить: сегмент привязан к видам работ. Смените сегмент у записей.");
      return;
    }
    setHiddenSegments((prev) => new Set([...prev, name]));
    setExtraSegments((prev) => prev.filter((s) => s !== name));
    if (segment === name) setSegment("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Введите название");
    if (!segment.trim()) return toast.error("Выберите сегмент");
    setSubmitting(true);
    const isNew = !row;
    const res = await fetch(isNew ? "/api/work-types" : `/api/work-types/${row.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), segment: segment.trim() }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Не удалось сохранить");
      return;
    }
    toast.success(isNew ? "Вид работ создан" : "Вид работ обновлён");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? "Редактировать вид работ" : "Новый вид работ"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Название</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Дизайн посадочной страницы"
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="segment">Сегмент</Label>
            <DepartmentCombobox
              id="segment"
              value={segment}
              onValueChange={setSegment}
              options={segmentOptions}
              onAddOption={handleAddSegment}
              onRemoveOption={handleRemoveSegment}
              placeholder="Выберите или введите сегмент..."
            />
          </div>
          {row && (row.projectTypes.length > 0 || row.estimateSources.length > 0) && (
            <div className="rounded-md bg-neutral-50 border border-neutral-200 px-3 py-2 text-xs space-y-1">
              {row.projectTypes.length > 0 && (
                <div>
                  <span className="text-neutral-500">Типы проектов: </span>
                  {row.projectTypes
                    .map((t) => PROJECT_TYPES[t as keyof typeof PROJECT_TYPES] ?? t)
                    .join(", ")}
                </div>
              )}
              {row.estimateSources.length > 0 && (
                <div>
                  <span className="text-neutral-500">Типы смет: </span>
                  {row.estimateSources.map((s) => SOURCE_LABEL[s] ?? s).join(", ")}
                </div>
              )}
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
