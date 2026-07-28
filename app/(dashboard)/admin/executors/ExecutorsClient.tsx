"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner" ;
import { Plus, Pencil, Archive, ArchiveRestore, Check, X, ExternalLink, Search } from "lucide-react";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { ConfirmDialog } from "@/components/ui-custom/ConfirmDialog";
import { Input } from "@/components/ui/input";
import {
  ENTITY_STATUSES,
  EXECUTOR_TYPES,
  EXECUTOR_TYPE_FILTER_GROUPS,
  RECIPIENT_TYPES,
} from "@/lib/statuses";
import { normalizeExecutorType } from "@/lib/executor-type";

function displayExecutorName(name: string, type: string) {
  return normalizeExecutorType(type) === "service" ? name.toUpperCase() : name;
}
import { formatDate } from "@/lib/format";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { ExpandableListCell } from "@/components/ui-custom/ExpandableListCell";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner, compactTable, compactHead, compactCell, compactCellClip } from "@/lib/table-styles";
import { ExecutorWizard } from "./ExecutorWizard";
import { hasPersonalSmeta } from "@/lib/executor-personal-estimate";
import { EXECUTOR_COMPANY_STATUSES } from "@/lib/statuses";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";
type Row = {
  id: string;
  name: string;
  companyStatus: string | null;
  type: string;
  workTypeIds: string[];
  workTypeNames: string[];
  projectNames: string[];
  responsibleUserId: string | null;
  responsibleName: string | null;
  defaultBankAccountId: string | null;
  defaultBankAccountName: string | null;
  recipientTypes: string[];
  requisites: string | null;
  contacts: string | null;
  contactEmail: string | null;
  accessEmail: string | null;
  userId: string | null;
  inTgChat: boolean;
  specialty: string | null;
  note: string | null;
  contractFile: string | null;
  ndaFile: string | null;
  status: string;
  lastPaidAt: string | null;
  legalForm: string | null;
};
export type ExecutorRow = Row;

type BankAccountOption = { id: string; name: string; status: string };
type WorkTypeOption = { id: string; name: string; status: string; segment?: string };
type ResponsibleOption = { id: string; fullName: string; isActive: boolean };

const fetcher = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<T>;
  });

type SortField = "name" | "responsibleName" | "lastPaidAt";
type SortDir = "asc" | "desc";

type ExecutorsClientProps = {
  /** admin — полный доступ; manage — PM/постоянный исполнитель (только настройки, без сметы). */
  mode?: "admin" | "manage";
  /** Можно добавлять исполнителей (admin, PM). */
  canAdd?: boolean;
};

export function ExecutorsClient({ mode = "admin", canAdd = true }: ExecutorsClientProps = {}) {
  const isManage = mode === "manage";
  const detailBase = isManage ? "/executor/executors" : "/admin/executors";
  const { data, isLoading, mutate } = useSWR<Row[]>("/api/executors", fetcher);
  const { data: bankAccounts } = useSWR<BankAccountOption[]>("/api/bank-accounts", fetcher);
  const { data: workTypes } = useSWR<WorkTypeOption[]>("/api/work-types", fetcher);
  const { data: responsibles } = useSWR<ResponsibleOption[]>("/api/responsibles", fetcher);

  const [typeFilter, setTypeFilter] = React.useState<string[]>([]);
  const [workTypeFilter, setWorkTypeFilter] = React.useState<string[]>([]);
  const [projectFilter, setProjectFilter] = React.useState<string[]>([]);
  const [responsibleFilter, setResponsibleFilter] = React.useState<string[]>([]);
  const [bankFilter, setBankFilter] = React.useState<string[]>([]);
  const [recipientFilter, setRecipientFilter] = React.useState<string[]>([]);
  const [companyStatusFilter, setCompanyStatusFilter] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<string[]>(["active"]);
  const [nameSearch, setNameSearch] = React.useState("");
  const [sort, setSort] = React.useState<{ field: SortField; dir: SortDir }>({
    field: "name",
    dir: "asc",
  });

  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [archiveTarget, setArchiveTarget] = React.useState<Row | null>(null);
  const [archivePrecheck, setArchivePrecheck] = React.useState<{
    openWorks: number;
    pendingPayments: number;
  } | null>(null);
  const [unarchiveTarget, setUnarchiveTarget] = React.useState<Row | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  usePersistedInterfaceState(
    `executors:${mode}`,
    {
      typeFilter,
      workTypeFilter,
      projectFilter,
      responsibleFilter,
      bankFilter,
      recipientFilter,
      companyStatusFilter,
      statusFilter,
      nameSearch,
      sort,
    },
    (stored) => {
      if (stored.typeFilter) setTypeFilter(stored.typeFilter);
      if (stored.workTypeFilter) setWorkTypeFilter(stored.workTypeFilter);
      if (stored.projectFilter) setProjectFilter(stored.projectFilter);
      if (stored.responsibleFilter) setResponsibleFilter(stored.responsibleFilter);
      if (stored.bankFilter) setBankFilter(stored.bankFilter);
      if (stored.recipientFilter) setRecipientFilter(stored.recipientFilter);
      if (stored.companyStatusFilter) setCompanyStatusFilter(stored.companyStatusFilter);
      if (stored.statusFilter) setStatusFilter(stored.statusFilter);
      if (stored.nameSearch !== undefined) setNameSearch(stored.nameSearch);
      if (stored.sort) setSort(stored.sort);
    }
  );
  usePersistedScroll(scrollRef, `executors-table:${mode}`);

  const projectOptions = React.useMemo(() => {
    const list = data ?? [];
    const set = new Set<string>();
    for (const r of list) for (const n of r.projectNames) set.add(n);
    const sorted = Array.from(set)
      .sort((a, b) => a.localeCompare(b, "ru"))
      .map((p) => ({ value: p, label: p }));
    return [{ value: "__empty__", label: "Пусто" }, ...sorted];
  }, [data]);

  const rows = React.useMemo(() => {
    let list = data ?? [];

    const q = nameSearch.trim().toLowerCase();
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));

    if (typeFilter.length) {
      const flatTypes = new Set<string>();
      for (const group of typeFilter) {
        const dbTypes =
          EXECUTOR_TYPE_FILTER_GROUPS[group as keyof typeof EXECUTOR_TYPE_FILTER_GROUPS] ?? [];
        for (const t of dbTypes) flatTypes.add(t);
      }
      list = list.filter((r) => flatTypes.has(normalizeExecutorType(r.type)));
    }

    if (workTypeFilter.length) {
      list = list.filter((r) => {
        if (workTypeFilter.includes("__empty__") && r.workTypeIds.length === 0) return true;
        return r.workTypeIds.some((id) => workTypeFilter.includes(id));
      });
    }

    if (projectFilter.length) {
      list = list.filter((r) => {
        if (projectFilter.includes("__empty__") && r.projectNames.length === 0) return true;
        return r.projectNames.some((n) => projectFilter.includes(n));
      });
    }

    if (responsibleFilter.length) {
      list = list.filter((r) => responsibleFilter.includes(r.responsibleUserId ?? "__none__"));
    }

    if (bankFilter.length) {
      list = list.filter((r) => bankFilter.includes(r.defaultBankAccountId ?? "__none__"));
    }

    if (recipientFilter.length) {
      list = list.filter((r) => {
        if (recipientFilter.includes("__none__") && r.recipientTypes.length === 0) return true;
        return r.recipientTypes.some((t) => recipientFilter.includes(t));
      });
    }

    if (companyStatusFilter.length) {
      list = list.filter((r) => {
        if (companyStatusFilter.includes("__none__") && !r.companyStatus) return true;
        if (!r.companyStatus) return false;
        const values = r.companyStatus.split(",").map((s) => s.trim());
        return companyStatusFilter.some((f) => f !== "__none__" && values.includes(f));
      });
    }

    if (statusFilter.length) list = list.filter((r) => statusFilter.includes(r.status));

    list = [...list].sort((a, b) => {
      const av = a[sort.field];
      const bv = b[sort.field];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av ?? "").localeCompare(String(bv ?? ""), "ru");
      const primary = sort.dir === "asc" ? cmp : -cmp;
      if (primary !== 0) return primary;
      return String(a.responsibleName ?? "").localeCompare(String(b.responsibleName ?? ""), "ru");
    });
    return list;
  }, [
    data,
    nameSearch,
    typeFilter,
    workTypeFilter,
    projectFilter,
    responsibleFilter,
    bankFilter,
    recipientFilter,
    companyStatusFilter,
    statusFilter,
    sort,
  ]);

  function handleSort(field: string, dir: SortDir) {
    setSort({ field: field as SortField, dir });
  }

  async function openArchiveTarget(row: Row) {
    setArchiveTarget(row);
    setArchivePrecheck(null);
    try {
      const r = await fetch(`/api/executors/${row.id}/archive`);
      if (r.ok) {
        const check = (await r.json()) as { openWorks: number; pendingPayments: number };
        setArchivePrecheck(check);
      }
    } catch {
      // ignore — покажем generic confirm
    }
  }

  async function handleArchive(row: Row) {
    const res = await fetch(`/api/executors/${row.id}/archive`, { method: "POST" });
    if (!res.ok) return toast.error("Не удалось архивировать");
    toast.success(`«${row.name}» архивирован, доступ снят`);
    mutate();
  }

  async function handleUnarchive(row: Row) {
    const res = await fetch(`/api/executors/${row.id}/archive`, { method: "DELETE" });
    if (!res.ok) return toast.error("Не удалось вернуть из архива");
    toast.success(`«${row.name}» снова активен`);
    mutate();
  }

  const responsibleOpts = React.useMemo(() => {
    if (!responsibles) return [];
    const opts = [...responsibles]
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"))
      .map((r) => ({ value: r.id, label: r.fullName }));
    return [{ value: "__none__", label: "Пусто" }, ...opts];
  }, [responsibles]);

  const bankOpts = React.useMemo(() => {
    if (!bankAccounts) return [];
    const opts = [...bankAccounts]
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((b) => ({ value: b.id, label: b.name }));
    return [{ value: "__none__", label: "Пусто" }, ...opts];
  }, [bankAccounts]);

  const workTypeOpts = React.useMemo(() => {
    if (!workTypes) return [];
    const sorted = [...workTypes].sort((a, b) =>
      (a.segment ?? "").localeCompare(b.segment ?? "", "ru") ||
      a.name.localeCompare(b.name, "ru")
    );
    return [{ value: "__empty__", label: "Пусто", group: "" }, ...sorted.map((w) => ({ value: w.id, label: w.name, group: w.segment }))];
  }, [workTypes]);

  const recipientOpts = React.useMemo(
    () => [
      { value: "__none__", label: "Пусто" },
      ...RECIPIENT_TYPES.map((r) => ({ value: r, label: r })),
    ],
    []
  );

  const companyStatusOpts = React.useMemo(
    () => [
      { value: "__none__", label: "Пусто" },
      ...Object.entries(EXECUTOR_COMPANY_STATUSES).map(([value, label]) => ({ value, label })),
    ],
    []
  );

  const typeFilterOpts = React.useMemo(
    () =>
      Object.keys(EXECUTOR_TYPE_FILTER_GROUPS).map((label) => ({
        value: label,
        label,
      })),
    []
  );

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] min-h-0">
      <PageHeader
        title="Исполнители"
        actions={
          canAdd ? (
            <Button onClick={() => setWizardOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Добавить исполнителя
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400 pointer-events-none" />
          <Input
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="h-8 pl-8 text-xs"
          />
        </div>
        <MultiSelectFilter label="Тип" options={typeFilterOpts} value={typeFilter} onChange={setTypeFilter} />
        <MultiSelectFilter
          label="Статус в компании"
          options={companyStatusOpts}
          value={companyStatusFilter}
          onChange={setCompanyStatusFilter}
        />
        <MultiSelectFilter
          label="Виды работ"
          options={workTypeOpts}
          value={workTypeFilter}
          onChange={setWorkTypeFilter}
        />
        <MultiSelectFilter
          label="Проекты"
          options={projectOptions}
          value={projectFilter}
          onChange={setProjectFilter}
        />
        <MultiSelectFilter
          label="Ответственный"
          options={responsibleOpts}
          value={responsibleFilter}
          onChange={setResponsibleFilter}
        />
        <MultiSelectFilter
          label="Источник оплаты"
          options={bankOpts}
          value={bankFilter}
          onChange={setBankFilter}
        />
        <MultiSelectFilter
          label="Тип получателя"
          options={recipientOpts}
          value={recipientFilter}
          onChange={setRecipientFilter}
        />
        <MultiSelectFilter
          label="Статус"
          options={Object.entries(ENTITY_STATUSES).map(([value, { label }]) => ({ value, label }))}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      </div>

      <Table
        className={cn(compactTable, "min-w-[1520px]")}
        containerRef={scrollRef}
        containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto"
      >
          <TableHeader>
            <TableRow>
              <SortableHead field="name" sortBy={sort.field} sortDir={sort.dir} onSort={handleSort} className={cn(compactHead, "w-[160px] max-w-[160px]")}>
                Исполнитель
              </SortableHead>
              <TableHead className={cn(compactHead, "w-20 min-w-20 px-1")}>
                <span className="block text-left">
                  Статус
                  <br />
                  <span className="whitespace-nowrap">в компании</span>
                </span>
              </TableHead>
              <TableHead className={cn(compactHead, "w-24")}>Тип</TableHead>
              <TableHead className={cn(compactHead, "w-40 max-w-40")}>Виды работ</TableHead>
              <TableHead className={cn(compactHead, "w-28 max-w-28")}>Специальность</TableHead>
              <TableHead className={cn(compactHead, "w-44 max-w-44")}>Проекты</TableHead>
              <SortableHead
                field="responsibleName"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
                className={cn(compactHead, "w-32 max-w-32")}
              >
                Ответственный
              </SortableHead>
              <TableHead className={cn(compactHead, "w-32 max-w-32")}>Источник оплаты</TableHead>
              <TableHead className={cn(compactHead, "w-36 max-w-36")}>Тип получателя</TableHead>
              <TableHead className={cn(compactHead, "w-20")}>В чате ТГ</TableHead>
              <TableHead className={cn(compactHead, "w-24")}>Статус</TableHead>
              <SortableHead
                field="lastPaidAt"
                sortBy={sort.field}
                sortDir={sort.dir}
                onSort={handleSort}
                className={cn(compactHead, "w-28")}
              >
                Последняя выплата
              </SortableHead>
              <TableHead className={cn("w-28", stickyActionsHead)} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-neutral-500 py-8">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-neutral-500 py-8">
                  Нет исполнителей
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className={r.status === "archived" ? "bg-neutral-100 text-neutral-400" : ""}>
                  <TableCell className={cn(compactCell, compactCellClip, "font-medium whitespace-normal")}>
                    <div className="flex items-center gap-1 min-w-0">
                      {isManage ? (
                        <Link
                          href={`${detailBase}/${r.id}`}
                          className="truncate hover:underline text-neutral-900"
                          title="Открыть настройки исполнителя"
                        >
                          {displayExecutorName(r.name, r.type)}
                        </Link>
                      ) : hasPersonalSmeta(r) ? (
                        <>
                          <Link
                            href={`/admin/executors/${r.id}`}
                            className="truncate hover:underline text-neutral-900"
                          >
                            {displayExecutorName(r.name, r.type)}
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 w-5 p-0 shrink-0"
                            title="Открыть смету в новом окне"
                            onClick={() => window.open(`/admin/executors/${r.id}`, "_blank")}
                          >
                            <ExternalLink className="h-3 w-3 text-neutral-500" />
                          </Button>
                        </>
                      ) : (
                        <span className="truncate">{displayExecutorName(r.name, r.type)}</span>
                      )}
                    </div>
                    {r.accessEmail && (
                      <div className="text-xs text-neutral-500 truncate">{r.accessEmail}</div>
                    )}
                  </TableCell>
                  <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
                    {r.companyStatus
                      ? r.companyStatus.split(",").map((s) => EXECUTOR_COMPANY_STATUSES[s.trim() as keyof typeof EXECUTOR_COMPANY_STATUSES] ?? s).join(", ")
                      : "—"}
                  </TableCell>
                  <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
                    {EXECUTOR_TYPES[normalizeExecutorType(r.type)] ?? r.type}
                  </TableCell>
                  <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
                    <ExpandableListCell items={r.workTypeNames} className="max-w-full" />
                  </TableCell>
                  <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
                    {r.specialty ?? "—"}
                  </TableCell>
                  <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
                    <ExpandableListCell items={r.projectNames} className="max-w-full" />
                  </TableCell>
                  <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>{r.responsibleName ?? "—"}</TableCell>
                  <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>{r.defaultBankAccountName ?? "—"}</TableCell>
                  <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
                    <ExpandableListCell items={r.recipientTypes} className="max-w-full" />
                  </TableCell>
                  <TableCell className={cn(compactCell, "text-center")}>
                    {r.inTgChat ? (
                      <Check className="h-4 w-4 text-green-600 inline" />
                    ) : (
                      <X className="h-4 w-4 text-neutral-300 inline" />
                    )}
                  </TableCell>
                  <TableCell className={compactCell}>
                    <StatusBadge dict={ENTITY_STATUSES} value={r.status} />
                  </TableCell>
                  <TableCell className={compactCell}>
                    {r.lastPaidAt ? formatDate(r.lastPaidAt) : "—"}
                  </TableCell>
                  <TableCell className={cn(stickyActionsCell, r.status === "archived" && "bg-neutral-100")}>
                    <div className={stickyActionsInner}>
                      <Link
                        href={`${detailBase}/${r.id}?tab=settings`}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                        title="Настройки"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Link>
                      {!isManage && (
                        <>
                          {r.status === "active" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openArchiveTarget(r)}
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
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

      {wizardOpen && (
        <ExecutorWizard
          bankAccounts={bankAccounts ?? []}
          responsibles={responsibles ?? []}
          canGrantAccess={!isManage}
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            setWizardOpen(false);
            mutate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(o) => {
          if (!o) {
            setArchiveTarget(null);
            setArchivePrecheck(null);
          }
        }}
        title="Архивировать исполнителя?"
        description={
          archivePrecheck && (archivePrecheck.openWorks > 0 || archivePrecheck.pendingPayments > 0)
            ? `У исполнителя ${archivePrecheck.openWorks} открытых работ и ${archivePrecheck.pendingPayments} незакрытых выплат. Архивировать всё равно? Доступ к смете будет снят, история сохранится.`
            : `«${archiveTarget?.name}» исчезнет из активных списков. Доступ к смете будет снят. История сохранится.`
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
        title="Вернуть исполнителя из архива?"
        description={`«${unarchiveTarget?.name}» снова станет доступен. Доступ к смете нужно будет включить отдельно.`}
        confirmLabel="Вернуть"
        onConfirm={async () => {
          if (unarchiveTarget) await handleUnarchive(unarchiveTarget);
        }}
      />
    </div>
  );
}
