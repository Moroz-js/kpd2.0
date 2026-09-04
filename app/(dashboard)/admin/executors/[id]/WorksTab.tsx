"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, CheckCircle, CircleDollarSign, X, Link2, Layers, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { formatMoney, formatDate, monthFullLabel, monthPrepositionalLabel, MONTHS } from "@/lib/format";
import { WORK_STATUSES, PAYMENT_STATUSES, BADGE_TONE_CLASS } from "@/lib/statuses";
import { sortByNameRu } from "@/lib/sort";
import { nearestPaymentDate, toLocalDateString, getISOWeek, getISOWeekYear, weekLabel } from "@/lib/iso-weeks";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner } from "@/lib/table-styles";
import { RowSelectCheckbox } from "@/components/ui-custom/RowSelectCheckbox";
import { useTableRowSelection } from "@/lib/useTableRowSelection";
import { useComparison } from "@/components/ComparisonProvider";
import { EntityActivityHistory } from "@/components/ui-custom/EntityActivityHistory";
import {
  usePersistedInterfaceState,
  usePersistedScroll,
} from "@/components/PersistedInterfaceState";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import { MoreFilters } from "@/components/ui-custom/MoreFilters";
import { FilterResetButton } from "@/components/ui-custom/FilterResetButton";
import { useCompatibleFilterOptions } from "@/lib/useCompatibleFilterOptions";
import { useUrlSyncedFilters } from "@/lib/useUrlSyncedFilters";
import { getWeekFilterMetadata, getMonthFilterMetadata } from "@/lib/period-filter-options";

type WorkType = { id: string; name: string };
type Project = { id: string; name: string };
type BankAccount = { id: string; name: string };
type ExecutorRef = { id: string; name: string };

type PaymentRow = {
  id: string;
  amount: number;
  paymentStatus: string;
  plannedPayAt: string | null;
  paidAt: string | null;
  bankAccountId: string | null;
  bankAccount: { id: string; name: string } | null;
  comment: string | null;
  filledTechTask: string | null;
  filledAct: string | null;
};
type AllPaymentRow = PaymentRow & { periodYear: number; periodMonth: number };

type WorkRow = {
  id: string;
  projectId: string;
  project: Project;
  workTypeId: string;
  workType: WorkType;
  executionYear: number;
  executionMonth: number;
  techTask: string | null;
  report: string | null;
  link: string | null;
  volume: number | null;
  rate: number | null;
  amount: number;
  plannedPayAt: string | null;
  paidAt: string | null;
  workStatus: string;
  checkedAt: string | null;
  comment: string | null;
  paymentId: string | null;
  payment: PaymentRow | null;
  responsibleExecutorId: string | null;
  responsibleExecutor: ExecutorRef | null;
};

type Props = {
  executorId: string;
  isAdmin: boolean;
  isOwner: boolean;
  bankAccounts: BankAccount[];
};

const WORK_STATUS_LABELS: Record<string, string> = {
  submitted: "Работа выставлена",
  checked: "Работа проверена",
  paid: "Работа оплачена",
  rework: "Нужно доработать",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  planned: "Выплата запланирована",
  paid: "Выплата оплачена",
};

/** Статусы работы, доступные для ручной смены (без «Оплачено»). */
const WORK_STATUS_SETTABLE: [string, string][] = [
  ["rework", "Нужно доработать"],
  ["submitted", "Работа выставлена"],
  ["checked", "Работа проверена"],
];

function StatusBadge({ status, type }: { status: string; type: "work" | "payment" }) {
  const dict = type === "work" ? WORK_STATUSES : PAYMENT_STATUSES;
  const entry = dict[status as keyof typeof dict];
  if (!entry) return <span className="text-[10px] text-neutral-400">—</span>;
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-tight whitespace-nowrap ${BADGE_TONE_CLASS[entry.tone]}`}
    >
      {type === "work" ? WORK_STATUS_LABELS[status] : PAYMENT_STATUS_LABELS[status]}
    </span>
  );
}

/** Ключ недели оплаты для сортировки (year*100 + isoWeek). null → в конец. */
function payWeekSortKey(dateStr: string | null): number {
  if (!dateStr) return Number.MAX_SAFE_INTEGER;
  const d = new Date(dateStr);
  return getISOWeekYear(d) * 100 + getISOWeek(d);
}

/** Ключ месяца оплаты для сортировки (year*100 + month). null → в конец. */
function payMonthSortKey(dateStr: string | null): number {
  if (!dateStr) return Number.MAX_SAFE_INTEGER;
  const d = new Date(dateStr);
  return d.getFullYear() * 100 + (d.getMonth() + 1);
}

function payWeekText(dateStr: string | null): string {
  if (!dateStr) return "—";
  return weekLabel(getISOWeek(new Date(dateStr)));
}

/** Ключ ISO-недели оплаты `YYYY-WW` для фильтра (в отличие от payWeekText — без года не различает недели разных лет). */
function payWeekFilterKey(dateStr: string | null): string {
  if (!dateStr) return "__empty__";
  const d = new Date(dateStr);
  return `${getISOWeekYear(d)}-${String(getISOWeek(d)).padStart(2, "0")}`;
}

function payWeekFilterLabel(dateStr: string | null): string {
  if (!dateStr) return "Не указано";
  const d = new Date(dateStr);
  return `${weekLabel(getISOWeek(d))} ${getISOWeekYear(d)}`;
}

/** «по 1 работе» / «по 2 работам» / «по 11 работам» / «по 21 работе». */
function worksCountLabel(n: number): string {
  const word = n % 10 === 1 && n % 100 !== 11 ? "работе" : "работам";
  return `по ${n} ${word}`;
}

const PAID_STATUSES_WORK = new Set(["paid"]);
const PAID_STATUSES_PAYMENT = new Set(["paid"]);

type WorkDiffField =
  | "executionYear"
  | "executionMonth"
  | "projectTask"
  | "workType"
  | "volume"
  | "rate"
  | "responsible"
  | "amount"
  | "plannedPayAt"
  | "paidAt"
  | "workStatus";

type PaymentDiffField =
  | "summary"
  | "amount"
  | "plannedPayAt"
  | "paidAt"
  | "paymentStatus"
  | "bankAccount";

type DiffField<T extends string> = T | "__row__";

function changedFields<T extends string>(
  current: Record<T, unknown>,
  other: Record<T, unknown> | null
): Set<DiffField<T>> {
  if (!other) return new Set<DiffField<T>>(["__row__"]);
  const result = new Set<DiffField<T>>();
  for (const key of Object.keys(current) as T[]) {
    if (!Object.is(current[key], other[key])) result.add(key);
  }
  return result;
}

function workVisibleValues(w: WorkRow): Record<WorkDiffField, unknown> {
  return {
    executionYear: w.executionYear,
    executionMonth: w.executionMonth,
    projectTask: `${w.project.name}\0${w.techTask ?? ""}`,
    workType: w.workType.name,
    volume: w.volume,
    rate: w.rate,
    responsible: w.responsibleExecutor?.name ?? "",
    amount: w.amount,
    plannedPayAt: w.plannedPayAt,
    paidAt: w.paidAt,
    workStatus: w.workStatus,
  };
}

function paymentVisibleValues(
  p: AllPaymentRow,
  rows: Iterable<WorkRow>
): Record<PaymentDiffField, unknown> {
  let linkedCount = 0;
  for (const work of rows) {
    if (work.paymentId === p.id) linkedCount += 1;
  }
  return {
    summary: `${linkedCount}\0${p.comment ?? ""}`,
    amount: p.amount,
    plannedPayAt: p.plannedPayAt,
    paidAt: p.paidAt,
    paymentStatus: p.paymentStatus,
    bankAccount: p.bankAccount?.name ?? "",
  };
}

export function WorksTab({ executorId, isAdmin, isOwner, bankAccounts: bankAccountsProp }: Props) {
  const { onlyChanges, panel, sourceA, sourceB } = useComparison();
  const bankAccounts = React.useMemo(() => sortByNameRu(bankAccountsProp), [bankAccountsProp]);
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [allPayments, setAllPayments] = useState<AllPaymentRow[]>([]);
  const [compareWorks, setCompareWorks] = useState<Map<string, WorkRow> | null>(null);
  const [comparePayments, setComparePayments] = useState<Map<string, AllPaymentRow> | null>(null);
  const [permanentExecutors, setPermanentExecutors] = useState<ExecutorRef[]>([]);
  const [loading, setLoading] = useState(true);

  // Фильтры
  const [filterYear, setFilterYear] = useState<string[]>([]);
  const [filterMonth, setFilterMonth] = useState<string[]>([]);
  const [filterProject, setFilterProject] = useState<string[]>([]);
  const [filterWeek, setFilterWeek] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterBank, setFilterBank] = useState<string[]>([]);
  const [filterRowType, setFilterRowType] = useState<string[]>([]);
  const [hidePaidGroups, setHidePaidGroups] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasActiveFilters =
    filterMonth.length > 0 ||
    filterProject.length > 0 ||
    filterWeek.length > 0 ||
    filterStatus.length > 0 ||
    filterBank.length > 0 ||
    filterRowType.length > 0 ||
    hidePaidGroups;
  const resetFilters = () => {
    setFilterMonth([]);
    setFilterProject([]);
    setFilterWeek([]);
    setFilterStatus([]);
    setFilterBank([]);
    setFilterRowType([]);
    setHidePaidGroups(false);
  };
  const urlFilters = useUrlSyncedFilters([
    { stateKey: "filterYear", param: "year", kind: "array", value: filterYear, defaultValue: [], setValue: setFilterYear },
    { stateKey: "filterMonth", param: "month", kind: "array", value: filterMonth, defaultValue: [], setValue: setFilterMonth },
    { stateKey: "filterProject", param: "project", kind: "array", value: filterProject, defaultValue: [], setValue: setFilterProject },
    { stateKey: "filterWeek", param: "week", kind: "array", value: filterWeek, defaultValue: [], setValue: setFilterWeek },
    { stateKey: "filterStatus", param: "status", kind: "array", value: filterStatus, defaultValue: [], setValue: setFilterStatus },
    { stateKey: "filterBank", param: "bank", kind: "array", value: filterBank, defaultValue: [], setValue: setFilterBank },
    { stateKey: "filterRowType", param: "rowType", kind: "array", value: filterRowType, defaultValue: [], setValue: setFilterRowType },
    { stateKey: "hidePaidGroups", param: "hidePaid", kind: "boolean", value: hidePaidGroups, defaultValue: false, setValue: setHidePaidGroups },
  ]);

  usePersistedInterfaceState(
    `executor:${executorId}:works`,
    {
      filterYear,
      filterMonth,
      filterProject,
      filterWeek,
      filterStatus,
      filterBank,
      filterRowType,
      hidePaidGroups,
    },
    (stored) => {
      urlFilters.restorePersisted(stored);
    }
  );
  usePersistedScroll(scrollRef, `executor:${executorId}:works`, {
    enabled: !loading,
    signature: {
      filterYear,
      filterMonth,
      filterProject,
      filterWeek,
      filterStatus,
      filterBank,
      filterRowType,
      hidePaidGroups,
    },
  });

  // Диалоги
  const [createWorkOpen, setCreateWorkOpen] = useState(false);
  const [createPaymentOpen, setCreatePaymentOpen] = useState(false);
  const [editWork, setEditWork] = useState<WorkRow | null>(null);
  const [editPayment, setEditPayment] = useState<AllPaymentRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "work" | "payment"; id: string; label: string } | null>(null);
  const [markPaidTarget, setMarkPaidTarget] = useState<AllPaymentRow | null>(null);

  // Bulk / выбор работ (чекбоксы + shift + «выбрать всё»)
  const [bulkStatus, setBulkStatus] = useState<string>("");
  const [bulkDate, setBulkDate] = useState<string>("");
  const [forming, setForming] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  // Подсветка группы «выплата + её работы» при наведении
  const [hoverPaymentId, setHoverPaymentId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const [worksRes, paymentsRes] = await Promise.all([
      fetch(`/api/executors/${executorId}/works`),
      fetch(`/api/executors/${executorId}/payments`),
    ]);
    if (!worksRes.ok || !paymentsRes.ok) throw new Error();
    const [worksData, paymentsData] = await Promise.all([worksRes.json(), paymentsRes.json()]) as [WorkRow[], AllPaymentRow[]];
    setWorks(worksData);
    setAllPayments(paymentsData);
    return { works: worksData, payments: paymentsData };
  }, [executorId]);

  const load = useCallback(async () => {
    setLoading(true);
    try { await fetchData(); } catch { toast.error("Не удалось загрузить данные"); }
    finally { setLoading(false); }
  }, [fetchData]);

  const silentLoad = useCallback(() => fetchData().catch(() => {}), [fetchData]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!panel) return;
    const otherSource = panel === "A" ? sourceB : sourceA;
    const controller = new AbortController();
    const otherQs = `?source=${encodeURIComponent(otherSource || "live")}`;
    Promise.all([
      fetch(`/api/executors/${executorId}/works${otherQs}`, { signal: controller.signal }),
      fetch(`/api/executors/${executorId}/payments${otherQs}`, { signal: controller.signal }),
    ])
      .then(async ([worksRes, paymentsRes]) => {
        if (!worksRes.ok || !paymentsRes.ok) throw new Error();
        const [worksData, paymentsData] = (await Promise.all([
          worksRes.json(),
          paymentsRes.json(),
        ])) as [WorkRow[], AllPaymentRow[]];
        setCompareWorks(new Map(worksData.map((w) => [w.id, w])));
        setComparePayments(new Map(paymentsData.map((p) => [p.id, p])));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setCompareWorks(null);
        setComparePayments(null);
        console.error(err);
      });
    return () => controller.abort();
  }, [panel, sourceA, sourceB, executorId]);

  useEffect(() => {
    fetch("/api/executors/active-permanent")
      .then((r) => r.json())
      .then((d: ExecutorRef[]) => setPermanentExecutors(d))
      .catch(() => {});
  }, []);

  const canCreate = isAdmin || isOwner;

  const allYears = [
    ...new Set([
      ...works.map((w) => w.executionYear),
      ...allPayments.map((p) => p.periodYear),
    ]),
  ].sort();

  const projectOptions = Array.from(new Map(works.map((w) => [w.projectId, w.project])).entries())
    .sort((a, b) => a[1].name.localeCompare(b[1].name, "ru"));

  const weekOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const w of works) {
      const key = payWeekFilterKey(w.paidAt ?? w.plannedPayAt);
      if (key !== "__empty__" && !map.has(key)) map.set(key, payWeekFilterLabel(w.paidAt ?? w.plannedPayAt));
    }
    for (const p of allPayments) {
      const key = payWeekFilterKey(p.paidAt ?? p.plannedPayAt);
      if (key !== "__empty__" && !map.has(key)) map.set(key, payWeekFilterLabel(p.paidAt ?? p.plannedPayAt));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, label]) => {
        const [year, week] = value.split("-").map(Number);
        return { value, label, ...getWeekFilterMetadata([{ year, week }]) };
      });
  }, [works, allPayments]);

  const monthOptions = React.useMemo(() => {
    // Серость месяца — в контексте выбранного года выполнения, а не всех лет вперемешку.
    const yearScoped = filterYear.length
      ? works.filter((w) => filterYear.includes(String(w.executionYear)))
      : works;
    return MONTHS
      .filter((month) => works.some((w) => String(w.executionMonth) === month.value))
      .map((month) => ({
        ...month,
        ...getMonthFilterMetadata(
          yearScoped
            .filter((w) => String(w.executionMonth) === month.value)
            .map((w) => ({ year: w.executionYear, month: w.executionMonth }))
        ),
      }));
  }, [works, filterYear]);

  // ── Фильтры (§7) ──────────────────────────────────────────────────────────
  // Месяц/Год выполнения и Проект — только для работ; Источник перевода — только выплаты.
  const workOnlyFilterActive =
    filterYear.length > 0 || filterMonth.length > 0 || filterProject.length > 0;
  const paymentOnlyFilterActive = filterBank.length > 0;
  type FilterCandidate = {
    kind: "works" | "payments";
    year?: string;
    month?: string;
    project?: string;
    week?: string;
    status: "paid" | "unpaid";
    bank?: string;
  };
  const filterCandidates = React.useMemo<FilterCandidate[]>(
    () => [
      ...works.map((work) => ({
        kind: "works" as const,
        year: String(work.executionYear),
        month: String(work.executionMonth),
        project: work.projectId,
        week: payWeekFilterKey(work.paidAt ?? work.plannedPayAt),
        status: PAID_STATUSES_WORK.has(work.workStatus) ? "paid" as const : "unpaid" as const,
      })),
      ...allPayments.map((payment) => ({
        kind: "payments" as const,
        week: payWeekFilterKey(payment.paidAt ?? payment.plannedPayAt),
        status: PAID_STATUSES_PAYMENT.has(payment.paymentStatus) ? "paid" as const : "unpaid" as const,
        bank: payment.bankAccountId ?? undefined,
      })),
    ],
    [works, allPayments]
  );
  const compatibleValues = useCompatibleFilterOptions(filterCandidates, [
    {
      key: "year", value: filterYear, setValue: setFilterYear,
      matches: (row, values) => !values.length || (row.kind === "works" && values.includes(row.year ?? "")),
      values: (row) => row.year ? [row.year] : [],
      protectedFromAutoClear: true,
    },
    {
      key: "month", value: filterMonth, setValue: setFilterMonth,
      matches: (row, values) => !values.length || (row.kind === "works" && values.includes(row.month ?? "")),
      values: (row) => row.month ? [row.month] : [],
    },
    {
      key: "project", value: filterProject, setValue: setFilterProject,
      matches: (row, values) => !values.length || (row.kind === "works" && values.includes(row.project ?? "")),
      values: (row) => row.project ? [row.project] : [],
    },
    {
      key: "week", value: filterWeek, setValue: setFilterWeek,
      matches: (row, values) => !values.length || values.includes(row.week ?? "__empty__"),
      values: (row) => row.week && row.week !== "__empty__" ? [row.week] : [],
    },
    {
      key: "status", value: filterStatus, setValue: setFilterStatus,
      matches: (row, values) => !values.length || values.includes(row.status),
      values: (row) => [row.status],
    },
    {
      key: "bank", value: filterBank, setValue: setFilterBank,
      matches: (row, values) => !values.length || (row.kind === "payments" && values.includes(row.bank ?? "")),
      values: (row) => row.bank ? [row.bank] : [],
    },
    {
      key: "rowType", value: filterRowType, setValue: setFilterRowType,
      matches: (row, values) => !values.length || values.includes(row.kind),
      values: (row) => [row.kind],
    },
  ]);

  const workDiffFields = useCallback(
    (w: WorkRow): Set<DiffField<WorkDiffField>> => {
      if (!panel || !compareWorks) return new Set();
      const other = compareWorks.get(w.id);
      return changedFields(workVisibleValues(w), other ? workVisibleValues(other) : null);
    },
    [panel, compareWorks]
  );

  const paymentDiffFields = useCallback(
    (p: AllPaymentRow): Set<DiffField<PaymentDiffField>> => {
      if (!panel || !comparePayments) return new Set();
      const other = comparePayments.get(p.id);
      return changedFields(
        paymentVisibleValues(p, works),
        other
          ? paymentVisibleValues(other, compareWorks?.values() ?? [])
          : null
      );
    },
    [panel, comparePayments, compareWorks, works]
  );

  const workChanged = useCallback(
    (w: WorkRow): boolean => {
      if (!panel || !compareWorks) return true;
      return workDiffFields(w).size > 0;
    },
    [panel, compareWorks, workDiffFields]
  );

  const paymentChanged = useCallback(
    (p: AllPaymentRow): boolean => {
      if (!panel || !comparePayments) return true;
      return paymentDiffFields(p).size > 0;
    },
    [panel, comparePayments, paymentDiffFields]
  );

  const workPasses = useCallback(
    (w: WorkRow): boolean => {
      if (filterYear.length && !filterYear.includes(String(w.executionYear))) return false;
      if (filterMonth.length && !filterMonth.includes(String(w.executionMonth))) return false;
      if (filterProject.length && !filterProject.includes(w.projectId)) return false;
      if (filterWeek.length && !filterWeek.includes(payWeekFilterKey(w.paidAt ?? w.plannedPayAt))) return false;
      const status = PAID_STATUSES_WORK.has(w.workStatus) ? "paid" : "unpaid";
      if (filterStatus.length && !filterStatus.includes(status)) return false;
      if (onlyChanges && !workChanged(w)) {
        const parent = w.paymentId ? allPayments.find((p) => p.id === w.paymentId) : null;
        if (!parent || !paymentChanged(parent)) return false;
      }
      return true;
    },
    [filterYear, filterMonth, filterProject, filterWeek, filterStatus, onlyChanges, workChanged, paymentChanged, allPayments]
  );

  const paymentPasses = useCallback(
    (p: AllPaymentRow): boolean => {
      if (filterWeek.length && !filterWeek.includes(payWeekFilterKey(p.paidAt ?? p.plannedPayAt))) return false;
      const status = PAID_STATUSES_PAYMENT.has(p.paymentStatus) ? "paid" : "unpaid";
      if (filterStatus.length && !filterStatus.includes(status)) return false;
      if (filterBank.length && !filterBank.includes(p.bankAccountId ?? "")) return false;
      if (onlyChanges && !paymentChanged(p)) {
        // Показать выплату, если изменилась хотя бы одна её работа
        const linked = works.filter((w) => w.paymentId === p.id);
        if (!linked.some((w) => workChanged(w))) return false;
      }
      return true;
    },
    [filterWeek, filterStatus, filterBank, onlyChanges, paymentChanged, workChanged, works]
  );

  // ── Группировка (§6) ────────────────────────────────────────────────────────
  type Group = { payment: AllPaymentRow; works: WorkRow[] };

  const worksByPayment = new Map<string, WorkRow[]>();
  for (const w of works) {
    if (!w.paymentId) continue;
    const arr = worksByPayment.get(w.paymentId) ?? [];
    arr.push(w);
    worksByPayment.set(w.paymentId, arr);
  }

  // Все выплаты идут в groups (с работами или без), затем непривязанные работы отдельно
  const groups: Group[] = [];
  const unlinkedPayments: AllPaymentRow[] = []; // оставляем для совместимости с фильтрами
  for (const p of allPayments) {
    const linked = worksByPayment.get(p.id) ?? [];
    groups.push({ payment: p, works: linked });
  }
  groups.sort(
    (a, b) =>
      payWeekSortKey(a.payment.paidAt ?? a.payment.plannedPayAt) -
      payWeekSortKey(b.payment.paidAt ?? b.payment.plannedPayAt)
  );

  const unlinkedWorks = works
    .filter((w) => !w.paymentId)
    .sort((a, b) =>
      a.executionYear !== b.executionYear
        ? a.executionYear - b.executionYear
        : a.executionMonth - b.executionMonth
    );

  // Проверенные непривязанные работы — для формирования выплат (§4)
  const checkedUnlinked = works.filter((w) => w.workStatus === "checked" && !w.paymentId);

  // «К выплате»: только работы со статусом «Проверено» без оплаченной выплаты
  const unpaidTotal = works
    .filter((w) => {
      if (w.workStatus !== "checked") return false;
      if (w.paymentId && w.payment?.paymentStatus === "paid") return false;
      return true;
    })
    .reduce((sum, w) => sum + w.amount, 0);

  const showWorkRows =
    !paymentOnlyFilterActive &&
    (filterRowType.length === 0 || filterRowType.includes("works"));
  const showPaymentRows =
    !workOnlyFilterActive &&
    (filterRowType.length === 0 || filterRowType.includes("payments"));

  const orderedWorkIds = React.useMemo(() => {
    if (!showWorkRows) return [] as string[];
    const ids: string[] = [];
    const visible = groups
      .filter((g) => !(hidePaidGroups && PAID_STATUSES_PAYMENT.has(g.payment.paymentStatus)))
      .filter((g) => !showPaymentRows || paymentPasses(g.payment))
      .map((g) => ({ payment: g.payment, works: g.works.filter(workPasses) }))
      .filter((g) => !showWorkRows || g.works.length > 0);
    for (const g of visible) {
      for (const w of g.works) ids.push(w.id);
    }
    for (const w of unlinkedWorks.filter(workPasses)) ids.push(w.id);
    return ids;
  }, [
    showWorkRows,
    groups,
    unlinkedWorks,
    hidePaidGroups,
    showPaymentRows,
    showWorkRows,
    paymentPasses,
    workPasses,
  ]);
  const visibleWorksTotal = React.useMemo(() => {
    const amountById = new Map(works.map((work) => [work.id, work.amount]));
    return Array.from(new Set(orderedWorkIds)).reduce(
      (sum, id) => sum + (amountById.get(id) ?? 0),
      0
    );
  }, [orderedWorkIds, works]);

  const { selectedIds, handleRowSelect, toggleAll, clearSelection } =
    useTableRowSelection(orderedWorkIds);
  const workIndexById = React.useMemo(() => {
    const map = new Map<string, number>();
    orderedWorkIds.forEach((id, i) => map.set(id, i));
    return map;
  }, [orderedWorkIds]);

  const selectedArray = Array.from(selectedIds);
  const selectedWorks = works.filter((w) => selectedIds.has(w.id));
  const selectedAllCheckedUnlinked =
    selectedWorks.length > 0 && selectedWorks.every((w) => w.workStatus === "checked" && !w.paymentId);

  // ── Действия ────────────────────────────────────────────────────────────────
  async function handleCheck(work: WorkRow) {
    const now = new Date().toISOString();
    setWorks((prev) => prev.map((w) => (w.id === work.id ? { ...w, workStatus: "checked", checkedAt: now } : w)));
    try {
      const r = await fetch(`/api/executors/${executorId}/works/${work.id}/check`, { method: "POST" });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? "Ошибка"); }
      toast.success("Работа проверена");
      silentLoad();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
      silentLoad();
    }
  }

  async function handleDeleteWork(id: string) {
    try {
      const r = await fetch(`/api/executors/${executorId}/works/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      toast.success("Работа удалена");
      setDeleteTarget(null);
      silentLoad();
    } catch { toast.error("Не удалось удалить работу"); }
  }

  async function handleDeletePayment(id: string) {
    try {
      const r = await fetch(`/api/executors/${executorId}/payments/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      toast.success("Выплата удалена");
      setDeleteTarget(null);
      silentLoad();
    } catch { toast.error("Не удалось удалить выплату"); }
  }

  async function handleBulkApply() {
    const patch: { workStatus?: string; plannedPayAt?: string | null } = {};
    if (bulkStatus) patch.workStatus = bulkStatus;
    if (bulkDate !== "") patch.plannedPayAt = bulkDate || null;
    if (Object.keys(patch).length === 0) return;
    const res = await fetch(`/api/executors/${executorId}/works/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedArray, patch }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return toast.error((d as { error?: string }).error ?? "Не удалось применить изменения");
    }
    const { updated } = await res.json();
    toast.success(`Обновлено работ: ${updated}`);
    clearSelection();
    setBulkStatus("");
    setBulkDate("");
    silentLoad();
  }

  async function handleDuplicate(ids: string[], openEditor: boolean) {
    if (ids.length === 0) return;
    setDuplicating(true);
    try {
      const res = await fetch(`/api/executors/${executorId}/works/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Не удалось дублировать");
      }
      const data = await res.json() as { created: number; ids: string[] };
      toast.success(data.created === 1 ? "Работа продублирована" : `Продублировано работ: ${data.created}`);
      clearSelection();
      if (openEditor && data.ids.length === 1) {
        const { works: freshWorks } = await fetchData();
        const created = freshWorks.find((w) => w.id === data.ids[0]);
        if (created) setEditWork(created);
      } else {
        silentLoad();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось дублировать");
    } finally {
      setDuplicating(false);
    }
  }

  async function formPayment(body: { scope: "all-checked" } | { workIds: string[] }) {
    setForming(true);
    try {
      const r = await fetch(`/api/executors/${executorId}/payments/from-works`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error((d as { error?: string }).error ?? "Ошибка"); }
      toast.success("Выплата сформирована");
      clearSelection();
      silentLoad();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setForming(false);
    }
  }

  async function handleMarkPaid(paymentId: string, paidAt: string, bankAccountId: string | null) {
    setMarkPaidTarget(null);
    try {
      const r = await fetch(`/api/executors/${executorId}/payments/${paymentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentStatus: "paid", paidAt, bankAccountId: bankAccountId || null }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error((d as { error?: string }).error ?? "Ошибка"); }
      toast.success("Выплата оплачена, работы переведены в «Оплачено»");
      silentLoad();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось обновить выплату");
      silentLoad();
    }
  }

  async function patchWork(workId: string, patch: Record<string, unknown>, optimistic?: (w: WorkRow) => WorkRow) {
    if (optimistic) setWorks((prev) => prev.map((w) => (w.id === workId ? optimistic(w) : w)));
    const r = await fetch(`/api/executors/${executorId}/works/${workId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      silentLoad();
      throw new Error((d as { error?: string }).error ?? "Ошибка");
    }
    silentLoad();
  }

  async function patchWorkPlannedDate(workId: string, date: string | null) {
    await patchWork(workId, { plannedPayAt: date }, (w) => ({ ...w, plannedPayAt: date }));
  }

  async function patchWorkAmount(workId: string, amount: number) {
    await patchWork(workId, { amount }, (w) => ({ ...w, amount }));
  }

  async function patchWorkResponsible(workId: string, responsibleExecutorId: string) {
    const exec = permanentExecutors.find((e) => e.id === responsibleExecutorId) ?? null;
    try {
      await patchWork(workId, { responsibleExecutorId }, (w) => ({
        ...w,
        responsibleExecutorId,
        responsibleExecutor: exec,
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function patchPaymentPlannedDate(paymentId: string, date: string | null) {
    setAllPayments((prev) => prev.map((p) => (p.id === paymentId ? { ...p, plannedPayAt: date } : p)));
    setWorks((prev) => prev.map((w) => (w.paymentId === paymentId ? { ...w, plannedPayAt: date } : w)));
    const r = await fetch(`/api/executors/${executorId}/payments/${paymentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plannedPayAt: date }),
    });
    if (!r.ok) { silentLoad(); throw new Error(); }
    silentLoad();
  }

  // ── Рендер ───────────────────────────────────────────────────────────────────
  /** table-fixed + colgroup — колонки не растягиваются от длинного ТЗ/URL */
  const COL_WIDTHS = [32, 72, 90, 118, 140, 80, 110, 160, 100, 56, 64, 140, 56, 72, 96] as const;
  const COL_COUNT = COL_WIDTHS.length;
  const TABLE_MIN_WIDTH = COL_WIDTHS.reduce((s, w) => s + w, 0);
  const cellClip = "overflow-hidden max-w-0";
  const th = "border-b border-neutral-200 px-1.5 py-1 text-left text-[10px] leading-tight font-medium text-neutral-600 bg-neutral-100 whitespace-nowrap";
  const thr = th + " text-right";
  const td = "border-b border-neutral-100 px-1.5 py-1 text-[10px] leading-tight align-middle";
  const tdr = td + " text-right tabular-nums";
  const changedCell = "bg-amber-100/80 font-medium text-amber-950";

  function comparisonRowClass<T>(
    id: string,
    compareRows: Map<string, T> | null
  ): string | undefined {
    if (!panel || !compareRows || compareRows.has(id)) return undefined;
    return panel === "B"
      ? "outline outline-1 -outline-offset-1 outline-green-400"
      : "outline outline-1 -outline-offset-1 outline-red-400";
  }

  function WorkCells({ w }: { w: WorkRow }) {
    const canEditWork = isAdmin || (isOwner && w.workStatus !== "checked" && w.workStatus !== "paid");
    const dateEditable = !w.paymentId && (isAdmin || (isOwner && w.workStatus !== "paid"));
    const respEditable = isAdmin || isOwner;
    const active = !!w.paymentId && hoverPaymentId === w.paymentId;
    const diff = workDiffFields(w);
    return (
      <>
        <td className="border-b border-neutral-100 px-1 py-1 w-8 text-center align-middle">
          <RowSelectCheckbox
            checked={selectedIds.has(w.id)}
            rowIndex={workIndexById.get(w.id) ?? 0}
            rowId={w.id}
            onSelect={handleRowSelect}
          />
        </td>
        <td className={cn(td, "whitespace-nowrap", diff.has("executionMonth") && changedCell)}>{monthFullLabel(w.executionMonth)}</td>
        <td className={cn(tdr, diff.has("amount") && changedCell)}>
          <InlineAmountInput value={w.amount} disabled={!canEditWork} onSave={(n) => patchWorkAmount(w.id, n)} />
        </td>
        <td className={cn(td, diff.has("plannedPayAt") && changedCell)}>
          <InlineDateInput
            value={w.plannedPayAt ? toLocalDateString(new Date(w.plannedPayAt)) : ""}
            disabled={!dateEditable}
            onSave={(d) => patchWorkPlannedDate(w.id, d)}
          />
        </td>
        <td className={cn(td, "min-w-[140px]", diff.has("workStatus") && changedCell)}><StatusBadge status={w.workStatus} type="work" /></td>
        <td className={cn(td, "whitespace-nowrap text-neutral-500", w.workStatus === "paid" && !w.paidAt && "bg-red-100 text-red-700", diff.has("paidAt") && changedCell)}>{formatDate(w.paidAt)}</td>
        <td className={cn(td, cellClip, "text-neutral-600")} title={w.payment?.bankAccount?.name ?? undefined}>
          <div className="truncate">{w.payment?.bankAccount?.name ?? "—"}</div>
        </td>
        <td className={cn(td, cellClip, diff.has("projectTask") && changedCell)}>
          <div className="truncate" title={w.project.name}>{w.project.name}</div>
          {w.techTask ? (
            <TooltipProvider delay={200}>
              <Tooltip>
                <TooltipTrigger className="block w-full min-w-0 max-w-full overflow-hidden text-left">
                  <div className="truncate text-neutral-400">{w.techTask}</div>
                </TooltipTrigger>
                <TooltipContent hideArrow side="bottom" className="block max-w-sm max-h-96 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all text-xs bg-white text-neutral-800 border border-neutral-200 shadow-md">
                  {w.techTask}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <div className="text-neutral-300">—</div>
          )}
        </td>
        <td className={cn(td, cellClip, "text-neutral-600", diff.has("workType") && changedCell)} title={w.workType.name}>
          <div className="truncate">{w.workType.name}</div>
        </td>
        <td className={cn(tdr, diff.has("volume") && changedCell)}>{w.volume != null ? w.volume.toLocaleString("ru-RU") : "—"}</td>
        <td className={cn(tdr, diff.has("rate") && changedCell)}>{w.rate != null ? formatMoney(w.rate) : "—"}</td>
        <td className={cn(td, "min-w-[120px]", diff.has("responsible") && changedCell)}>
          {respEditable ? (
            <SearchableSelect
              value={w.responsibleExecutorId ?? ""}
              onValueChange={(value) => patchWorkResponsible(w.id, value)}
              options={permanentExecutors.map((executor) => ({ value: executor.id, label: executor.name }))}
              placeholder={w.responsibleExecutor?.name ?? "—"}
              triggerClassName="h-6 px-1.5 text-[10px]"
            />
          ) : (
            <span className="text-neutral-600">{w.responsibleExecutor?.name ?? "—"}</span>
          )}
        </td>
        <td className={cn(td, diff.has("executionYear") && changedCell)}>{w.executionYear}</td>
        <td className={cn(td, "whitespace-nowrap")}>{payWeekText(w.paidAt ?? w.plannedPayAt)}</td>
        <td className={cn(td, stickyActionsCell, active && "bg-blue-100")}>
          <div className={stickyActionsInner}>
            {canCreate && (
              <button
                title="Дублировать"
                className="p-0.5 text-neutral-500 hover:text-neutral-800"
                disabled={duplicating}
                onClick={() => handleDuplicate([w.id], true)}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            )}
            {isAdmin && w.workStatus !== "checked" && w.workStatus !== "paid" && !w.paymentId && (
              <button title="Проверить" className="p-0.5 text-blue-600 hover:text-blue-800" onClick={() => handleCheck(w)}>
                <CheckCircle className="h-3.5 w-3.5" />
              </button>
            )}
            {canEditWork && <button title="Редактировать" className="p-0.5 text-neutral-500 hover:text-neutral-800" onClick={() => setEditWork(w)}><Pencil className="h-3.5 w-3.5" /></button>}
            {canEditWork && <button title="Удалить" className="p-0.5 text-red-400 hover:text-red-600" onClick={() => setDeleteTarget({ type: "work", id: w.id, label: w.techTask || "работу" })}><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        </td>
      </>
    );
  }

  function PaymentCells({ p }: { p: AllPaymentRow }) {
    const active = hoverPaymentId === p.id;
    const linkedCount = worksByPayment.get(p.id)?.length ?? 0;
    const worksLabel = linkedCount ? worksCountLabel(linkedCount) : "без работ";
    const paymentSubtitle = p.comment ? `${worksLabel} · ${p.comment}` : worksLabel;
    const diff = paymentDiffFields(p);
    const paymentDate = p.paidAt ?? p.plannedPayAt;
    const paymentMonth = paymentDate
      ? monthPrepositionalLabel(new Date(paymentDate).getMonth() + 1)
      : null;
    return (
      <>
        <td className="border-b border-neutral-100 px-1 py-1 w-8" />
        <td className={cn(td, cellClip)} title={paymentMonth ? `Выплачено в ${paymentMonth}` : undefined}>
          <div className="truncate">{paymentMonth ? `Выплачено в ${paymentMonth}` : "—"}</div>
        </td>
        <td className={cn(tdr, "font-semibold text-green-800", diff.has("amount") && changedCell)}>{formatMoney(p.amount)}</td>
        <td className={cn(td, diff.has("plannedPayAt") && changedCell)}>
          <InlineDateInput
            value={p.plannedPayAt ? toLocalDateString(new Date(p.plannedPayAt)) : ""}
            disabled={!isAdmin}
            onSave={(d) => patchPaymentPlannedDate(p.id, d)}
          />
        </td>
        <td className={cn(td, "min-w-[140px]", diff.has("paymentStatus") && changedCell)}><StatusBadge status={p.paymentStatus} type="payment" /></td>
        <td className={cn(td, "whitespace-nowrap", diff.has("paidAt") && changedCell)}>{formatDate(p.paidAt)}</td>
        <td className={cn(td, cellClip, "text-neutral-600", diff.has("bankAccount") && changedCell)} title={p.bankAccount?.name ?? undefined}>
          <div className="truncate">{p.bankAccount?.name ?? "—"}</div>
        </td>
        <td className={cn(td, "align-middle", diff.has("summary") && changedCell)} colSpan={5}>
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 font-semibold text-green-800 shrink-0">
              <CircleDollarSign className="h-3.5 w-3.5" /> Выплата
            </span>
            <span className="text-neutral-500 truncate" title={paymentSubtitle}>
              {paymentSubtitle}
            </span>
          </div>
        </td>
        <td className={td}>{p.periodYear}</td>
        <td className={cn(td, "whitespace-nowrap")}>{payWeekText(p.paidAt ?? p.plannedPayAt)}</td>
        <td className={cn(td, stickyActionsCell, active && "bg-blue-100")}>
          {isAdmin && (
            <div className={stickyActionsInner}>
              {p.paymentStatus !== "paid" && <button title="Оплатить" className="p-0.5 text-green-600 hover:text-green-800" onClick={() => setMarkPaidTarget(p)}><CircleDollarSign className="h-3.5 w-3.5" /></button>}
              <button title="Параметры выплаты" className="p-0.5 text-neutral-500 hover:text-neutral-800" onClick={() => setEditPayment(p)}><Pencil className="h-3.5 w-3.5" /></button>
              <button title="Удалить" className="p-0.5 text-red-400 hover:text-red-600" onClick={() => setDeleteTarget({ type: "payment", id: p.id, label: `выплату ${formatMoney(p.amount)} ₽` })}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </td>
      </>
    );
  }

  // Группа (выплата + работы): неделя/статус/источник применяются к выплате,
  // год/месяц/проект — к работам внутри группы. Под «оконными» фильтрами работ
  // (год/месяц/проект) группа без подходящих работ скрывается целиком.
  const visibleGroups = groups
    .filter((g) => !(hidePaidGroups && PAID_STATUSES_PAYMENT.has(g.payment.paymentStatus)))
    .filter((g) => !showPaymentRows || paymentPasses(g.payment))
    .map((g) => ({ payment: g.payment, works: g.works.filter(workPasses) }))
    .filter((g) => !showWorkRows || g.works.length > 0);

  const visibleUnlinkedWorks = unlinkedWorks.filter(workPasses);
  const visibleUnlinkedPayments = unlinkedPayments.filter(paymentPasses);

  // §6: непривязанные работы и выплаты — вперемешку, по месяцу.
  // Работа → месяц выполнения; выплата → месяц даты оплаты (или плановой даты).
  type UnlinkedItem =
    | { kind: "work"; sortKey: number; work: WorkRow }
    | { kind: "payment"; sortKey: number; payment: AllPaymentRow };
  // Секция "Без выплаты" — только непривязанные работы, по месяцу выполнения
  const unlinkedItems: UnlinkedItem[] = showWorkRows
    ? visibleUnlinkedWorks.map<UnlinkedItem>((w) => ({
        kind: "work",
        sortKey: w.executionYear * 100 + w.executionMonth,
        work: w,
      }))
    : [];

  const isEmpty =
    visibleGroups.filter((g) => (showWorkRows && g.works.length > 0) || showPaymentRows).length === 0 &&
    (!showWorkRows || visibleUnlinkedWorks.length === 0);

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Toolbar */}
      <div className="shrink-0 flex flex-wrap items-center gap-2">
        {canCreate && (
          <Button size="sm" onClick={() => setCreateWorkOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Работа
          </Button>
        )}
        {isAdmin && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={forming || checkedUnlinked.length === 0}
              onClick={() => formPayment({ scope: "all-checked" })}
            >
              <Layers className="h-3.5 w-3.5 mr-1" /> Выплата на все проверенные
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={forming || !selectedAllCheckedUnlinked}
              onClick={() => formPayment({ workIds: selectedArray })}
            >
              <Link2 className="h-3.5 w-3.5 mr-1" /> Выплата на выбранные
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCreatePaymentOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Добавить выплату
            </Button>
          </>
        )}

        <div className="ml-auto flex gap-2 flex-wrap items-center">
          <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer select-none">
            <Checkbox checked={hidePaidGroups} onCheckedChange={(v) => setHidePaidGroups(Boolean(v))} />
            Спрятать оплаченные группы
          </label>
          <FilterResetButton active={hasActiveFilters} onClick={resetFilters} />
          <MultiSelectFilter
            label="Тип строк"
            options={[
              { value: "works", label: "Только работы" },
              { value: "payments", label: "Только выплаты" },
            ].filter((option) => compatibleValues.rowType?.has(option.value))}
            value={filterRowType}
            onChange={setFilterRowType}
          />
          <MultiSelectFilter
            label="Неделя оплаты"
            options={weekOptions.filter((option) => compatibleValues.week?.has(option.value))}
            value={filterWeek}
            onChange={setFilterWeek}
          />
          <MultiSelectFilter
            label="Месяц"
            options={monthOptions
              .filter((month) => compatibleValues.month?.has(month.value))}
            value={filterMonth}
            onChange={setFilterMonth}
          />
          <MultiSelectFilter
            label="Проект"
            options={projectOptions
              .map(([id, project]) => ({ value: id, label: project.name }))
              .filter((option) => compatibleValues.project?.has(option.value))}
            value={filterProject}
            onChange={setFilterProject}
            popoverClassName="w-80"
          />
          <MultiSelectFilter
            label="Статус"
            options={[
              { value: "unpaid", label: "Неоплаченные" },
              { value: "paid", label: "Оплаченные" },
            ].filter((option) => compatibleValues.status?.has(option.value))}
            value={filterStatus}
            onChange={setFilterStatus}
          />
          <MultiSelectFilter
            label="Источник перевода"
            options={bankAccounts
              .map((bankAccount) => ({ value: bankAccount.id, label: bankAccount.name }))
              .filter((option) => compatibleValues.bank?.has(option.value))}
            value={filterBank}
            onChange={setFilterBank}
            popoverClassName="w-80"
          />
          <MoreFilters activeCount={filterYear.length}>
            <MultiSelectFilter
              label="Год"
              options={allYears
                .map((year) => ({ value: String(year), label: `${year} год` }))
                .filter((option) => compatibleValues.year?.has(option.value))}
              value={filterYear}
              onChange={setFilterYear}
            />
          </MoreFilters>
        </div>
      </div>

      {/* Bulk toolbar */}
      {selectedIds.size > 0 && (
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
          <span className="text-xs font-medium text-blue-700">{selectedIds.size} работ выбрано</span>
          {isAdmin && (
            <Select value={bulkStatus} onValueChange={(v) => v && setBulkStatus(v)}>
              <SelectTrigger className="h-7 w-44 text-xs bg-white">
                <SelectValue>{bulkStatus ? (WORK_STATUS_LABELS[bulkStatus] ?? "Статус") : "Статус не менять"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {WORK_STATUS_SETTABLE.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <label className="flex items-center gap-1.5 text-xs text-blue-700 whitespace-nowrap">
            Дата оплаты план
            <Input type="date" className="h-7 text-xs w-36 bg-white" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} />
          </label>
          <Button size="sm" className="h-7" onClick={handleBulkApply} disabled={!bulkStatus && !bulkDate}>Применить</Button>

          {canCreate && (
            <>
              <div aria-hidden className="mx-1 h-5 w-px shrink-0 self-center bg-blue-200" />
              <Button
                size="sm"
                variant="outline"
                className="h-7 bg-white"
                disabled={duplicating}
                onClick={() => handleDuplicate(selectedArray, false)}
              >
                <Copy className="h-3.5 w-3.5 mr-1" /> Дублировать
              </Button>
            </>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-7 ml-auto"
            onClick={() => clearSelection()}
          >
            <X className="h-3.5 w-3.5 mr-1" /> Снять
          </Button>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 min-w-0 overflow-auto rounded-md border bg-white"
      >
        {loading ? (
          <div className="text-sm text-neutral-400 py-8 text-center">Загрузка...</div>
        ) : isEmpty ? (
          <div className="text-sm text-neutral-400 py-8 text-center">
            {workOnlyFilterActive || paymentOnlyFilterActive || filterWeek.length > 0 || filterStatus.length > 0 || filterRowType.length > 0
              ? "Нет данных по фильтрам"
              : "Работ ещё нет. Создайте первую работу."}
          </div>
        ) : (
          <table className="table-fixed w-full text-[10px] border-separate border-spacing-0" style={{ minWidth: TABLE_MIN_WIDTH }}>
            <colgroup>
              {COL_WIDTHS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr>
                <th colSpan={2} className="border-b border-neutral-200 bg-neutral-50" />
                <th className="border-b border-neutral-200 bg-neutral-50 px-1.5 py-1 text-right align-middle">
                  <span className="block text-[9px] leading-tight font-medium text-neutral-500 whitespace-normal">
                    Сумма на странице
                  </span>
                  <span className="block text-[10px] leading-tight font-semibold text-neutral-900 tabular-nums whitespace-nowrap">
                    {formatMoney(visibleWorksTotal)} ₽
                  </span>
                </th>
                <th colSpan={9} className="border-b border-neutral-200 bg-neutral-50" />
                <th colSpan={2} className="border-b border-neutral-200 bg-neutral-50 px-1.5 py-1 text-right align-middle">
                  <span className="text-[10px] leading-tight font-medium text-neutral-600 whitespace-nowrap">
                    К выплате:{" "}
                  </span>
                  <span className="text-[10px] leading-tight font-semibold text-neutral-900 tabular-nums whitespace-nowrap">
                    {formatMoney(unpaidTotal)} ₽
                  </span>
                </th>
                <th className={cn("border-b border-neutral-200", stickyActionsHead)} />
              </tr>
              <tr>
                <th className={cn(th, "w-8 text-center")}>
                  {orderedWorkIds.length > 0 && (
                    <Checkbox
                      checked={orderedWorkIds.every((id) => selectedIds.has(id))}
                      onCheckedChange={() => toggleAll(orderedWorkIds)}
                    />
                  )}
                </th>
                <th className={th}>Месяц</th>
                <th className={thr}>Сумма</th>
                <th className={th}>Дата оплаты план</th>
                <th className={th}>Статус</th>
                <th className={th}>Дата оплаты факт</th>
                <th className={th}>Источник перевода</th>
                <th className={th}>Проект / ТЗ</th>
                <th className={th}>Вид работ</th>
                <th className={thr}>Объём</th>
                <th className={thr}>Ставка</th>
                <th className={th}>Ответственный</th>
                <th className={th}>Год</th>
                <th className={th}>Неделя оплаты</th>
                <th className={cn(th, stickyActionsHead)} />
              </tr>
            </thead>
            <tbody>
              {/* Группы: выплата + её работы (работы сверху).
                  При наведении на любую строку группы подсвечивается вся группа. */}
              {visibleGroups.map((g) => {
                const active = hoverPaymentId === g.payment.id;
                return (
                <React.Fragment key={g.payment.id}>
                  {showWorkRows && g.works.map((w) => (
                    <tr
                      key={w.id}
                      onMouseEnter={() => setHoverPaymentId(g.payment.id)}
                      onMouseLeave={() => setHoverPaymentId(null)}
                      className={cn(
                        "border-l-2 transition-colors",
                        active ? "bg-blue-100 border-l-blue-500" : "bg-blue-50 hover:bg-blue-100 border-l-blue-300",
                        comparisonRowClass(w.id, compareWorks)
                      )}
                    >
                      <WorkCells w={w} />
                    </tr>
                  ))}
                  {showPaymentRows && (
                  <tr
                    onMouseEnter={() => setHoverPaymentId(g.payment.id)}
                    onMouseLeave={() => setHoverPaymentId(null)}
                    className={cn(
                      "border-l-2 border-b-2 border-b-neutral-200 transition-colors font-medium",
                      active ? "bg-emerald-100 border-l-emerald-600" : "bg-emerald-50 hover:bg-emerald-100 border-l-emerald-400",
                      comparisonRowClass(g.payment.id, comparePayments)
                    )}
                  >
                    <PaymentCells p={g.payment} />
                  </tr>
                  )}
                </React.Fragment>
                );
              })}

              {/* Непривязанные работы и выплаты — вперемешку, по месяцу (§6) */}
              {unlinkedItems.length > 0 && (
                <tr><td colSpan={COL_COUNT} className="bg-neutral-50 px-2 py-1 text-[10px] font-semibold text-neutral-500 border-t-2 border-t-neutral-300">Без выплаты</td></tr>
              )}
              {unlinkedItems.map((item) =>
                item.kind === "work" ? (
                  <tr
                    key={item.work.id}
                    className={cn("hover:bg-neutral-50", comparisonRowClass(item.work.id, compareWorks))}
                  >
                    <WorkCells w={item.work} />
                  </tr>
                ) : (
                  <tr
                    key={item.payment.id}
                    className={cn(
                      "bg-emerald-50/60 hover:bg-emerald-100 font-medium",
                      comparisonRowClass(item.payment.id, comparePayments)
                    )}
                  >
                    <PaymentCells p={item.payment} />
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </div>

      {createWorkOpen && (
        <CreateWorkDialog
          executorId={executorId}
          onClose={() => setCreateWorkOpen(false)}
          onCreated={() => { setCreateWorkOpen(false); silentLoad(); }}
        />
      )}

      {createPaymentOpen && (
        <CreatePaymentDialog
          executorId={executorId}
          bankAccounts={bankAccounts}
          onClose={() => setCreatePaymentOpen(false)}
          onCreated={() => { setCreatePaymentOpen(false); silentLoad(); }}
        />
      )}

      {editWork && (
        <EditWorkDialog
          executorId={executorId}
          work={editWork}
          isAdmin={isAdmin}
          permanentExecutors={permanentExecutors}
          onClose={() => setEditWork(null)}
          onSaved={async () => {
            // Ждём обновления данных до закрытия — иначе при быстром повторном
            // открытии той же записи форма показывает не обновлённый кэш.
            await silentLoad();
            setEditWork(null);
          }}
        />
      )}

      {editPayment && (
        <EditPaymentDialog
          executorId={executorId}
          payment={editPayment}
          bankAccounts={bankAccounts}
          linkedWorks={worksByPayment.get(editPayment.id) ?? []}
          availableWorks={checkedUnlinked}
          onClose={() => setEditPayment(null)}
          onSaved={async () => {
            await silentLoad();
            setEditPayment(null);
          }}
        />
      )}

      {markPaidTarget && (
        <MarkPaidDialog
          payment={markPaidTarget}
          bankAccounts={bankAccounts}
          onClose={() => setMarkPaidTarget(null)}
          onConfirm={(paidAt, bankAccountId) => handleMarkPaid(markPaidTarget.id, paidAt, bankAccountId)}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить {deleteTarget?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "payment"
                ? "Выплата будет удалена, связанные работы вернутся в статус «Проверено»."
                : "Работа будет удалена безвозвратно. Если работа привязана к выплате — сумма выплаты пересчитается."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (!deleteTarget) return;
                if (deleteTarget.type === "work") handleDeleteWork(deleteTarget.id);
                else handleDeletePayment(deleteTarget.id);
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Filter Select ───────────────────────────────────────────────────────────

function FilterSelect({
  label, value, onChange, options, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v === "__all__" ? "" : (v ?? ""))}>
      <SelectTrigger className="h-8 w-36 text-xs">
        <SelectValue>{value ? (options.find((o) => o.value === value)?.label ?? label) : placeholder}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{placeholder}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ─── Decimal / Money input ────────────────────────────────────────────────────

/** Парсит число с учётом русской запятой и пробелов-разрядов. */
function parseDecimal(raw: string): number {
  const normalized = raw.replace(/[\s\u00A0]/g, "").replace(",", ".");
  return parseFloat(normalized);
}

function MoneyInput({ value, onChange, placeholder, disabled, className }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean; className?: string;
}) {
  const [focused, setFocused] = React.useState(false);
  const numVal = parseDecimal(value);
  const display = !focused && value && !isNaN(numVal)
    ? numVal.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value;
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        // Сохраняем ввод как есть (запятая/точка), без округления;
        // убираем только пробелы разрядов.
        onChange(e.target.value.replace(/[\s\u00A0]/g, ""));
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        // Нормализуем запятую → точку в состоянии, чтобы расчёт и API видели точное число
        if (value.includes(",")) {
          const n = parseDecimal(value);
          if (!isNaN(n)) onChange(String(n));
        }
      }}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  );
}

function DateInput({
  value,
  onChange,
  className,
  onEmptyFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  /** Предзаполнение при первом фокусе на пустом поле — вернуть YYYY-MM-DD */
  onEmptyFocus?: () => string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      className="relative w-full cursor-pointer"
      onClick={() => { ref.current?.focus(); try { ref.current?.showPicker(); } catch { /* ignore */ } }}
    >
      <input
        ref={ref}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (value) return;
          const next = onEmptyFocus?.();
          if (next) onChange(next);
        }}
        className={`w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer ${className ?? ""}`}
      />
    </div>
  );
}

// ─── Inline Amount Input ──────────────────────────────────────────────────────

function InlineAmountInput({ value, disabled, onSave }: { value: number; disabled?: boolean; onSave: (val: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editing) setLocalVal(String(value)); }, [value, editing]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  async function commit() {
    setEditing(false);
    const parsed = parseFloat(localVal.replace(",", "."));
    if (Number.isNaN(parsed) || parsed < 0) { setLocalVal(String(value)); toast.error("Введите корректную сумму"); return; }
    if (parsed === value) return;
    setSaving(true);
    try { await onSave(parsed); } catch (e) { setLocalVal(String(value)); toast.error(e instanceof Error ? e.message : "Не удалось сохранить сумму"); } finally { setSaving(false); }
  }

  if (disabled) return <span className="text-[10px] tabular-nums">{formatMoney(value)}</span>;

  if (editing || saving) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={0}
        step="0.01"
        className="w-full min-w-[4.5rem] max-w-[6rem] ml-auto text-[10px] text-right border border-neutral-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setEditing(false); setLocalVal(String(value)); } }}
        disabled={saving}
      />
    );
  }

  return (
    <button type="button" className="text-[10px] tabular-nums w-full text-right hover:text-blue-600 hover:underline cursor-pointer" onClick={() => { setLocalVal(String(value)); setEditing(true); }}>
      {formatMoney(value)}
    </button>
  );
}

// ─── Inline Date Input ────────────────────────────────────────────────────────

function InlineDateInput({ value, disabled, onSave }: { value: string; disabled?: boolean; onSave: (val: string | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openedEmpty = useRef(false);

  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); try { inputRef.current.showPicker(); } catch { /* ignore */ } } }, [editing]);

  async function handleBlur() {
    setEditing(false);
    // Если открыли пустую ячейку и подставили 5/20 — тоже сохраняем
    if (localVal === value && !openedEmpty.current) return;
    openedEmpty.current = false;
    setSaving(true);
    try { await onSave(localVal || null); } catch { toast.error("Не удалось сохранить дату"); } finally { setSaving(false); }
  }

  if (disabled) return <span className="text-[10px] text-neutral-500">{value ? formatDate(value) : "—"}</span>;

  if (editing || saving) {
    return (
      <input
        ref={inputRef}
        type="date"
        className="w-full min-w-[7rem] text-[10px] border border-neutral-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer"
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); setLocalVal(value); openedEmpty.current = false; } }}
        disabled={saving}
      />
    );
  }

  return (
    <button
      type="button"
      className="text-[10px] text-left w-full hover:text-blue-600 hover:underline cursor-pointer"
      onClick={() => {
        if (!value) {
          openedEmpty.current = true;
          setLocalVal(toLocalDateString(nearestPaymentDate()));
        } else {
          openedEmpty.current = false;
          setLocalVal(value);
        }
        setEditing(true);
      }}
    >
      {value ? <span className="text-neutral-600">{formatDate(value)}</span> : <span className="text-neutral-300 hover:text-blue-400">поставить дату</span>}
    </button>
  );
}

// ─── Create Work Dialog ────────────────────────────────────────────────────────

function CreateWorkDialog({ executorId, onClose, onCreated }: { executorId: string; onClose: () => void; onCreated: () => void }) {
  const now = new Date();
  const [projectId, setProjectId] = useState("");
  const [workTypeId, setWorkTypeId] = useState("");
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [techTask, setTechTask] = useState("");
  const [volume, setVolume] = useState("");
  const [rate, setRate] = useState("");
  const [amount, setAmount] = useState("");
  const [plannedPayAt, setPlannedPayAt] = useState("");
  const [link, setLink] = useState("");
  const [report, setReport] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const [planProjects, setPlanProjects] = useState<Project[]>([]);
  const [planWorkTypes, setPlanWorkTypes] = useState<WorkType[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingWorkTypes, setLoadingWorkTypes] = useState(false);

  useEffect(() => {
    setLoadingProjects(true);
    fetch(`/api/executors/${executorId}/plan-projects`).then((r) => r.json()).then(setPlanProjects).catch(() => {}).finally(() => setLoadingProjects(false));
  }, [executorId]);

  useEffect(() => {
    if (!projectId) { setPlanWorkTypes([]); return; }
    setLoadingWorkTypes(true);
    setWorkTypeId("");
    fetch(`/api/executors/${executorId}/plan-work-types?projectId=${projectId}`).then((r) => r.json()).then(setPlanWorkTypes).catch(() => {}).finally(() => setLoadingWorkTypes(false));
  }, [executorId, projectId]);

  useEffect(() => {
    const v = parseDecimal(volume);
    const r = parseDecimal(rate);
    if (!isNaN(v) && !isNaN(r)) setAmount(String(v * r));
  }, [volume, rate]);

  async function handleSave() {
    if (!projectId || !workTypeId || !techTask || !amount) { toast.error("Заполните обязательные поля"); return; }
    setSaving(true);
    try {
      // Пустое поле = ближайшее 5/20 (как на сервере), чтобы дата точно ушла в БД
      const planDate = plannedPayAt || toLocalDateString(nearestPaymentDate());
      const r = await fetch(`/api/executors/${executorId}/works`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, workTypeId,
          executionYear: parseInt(year), executionMonth: parseInt(month),
          techTask,
          volume: volume ? parseDecimal(volume) : null,
          rate: rate ? parseDecimal(rate) : null,
          amount: parseDecimal(amount),
          plannedPayAt: planDate,
          link: link || null, report: report || null, comment: comment || null,
        }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? "Ошибка"); }
      toast.success("Работа создана");
      onCreated();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setSaving(false); }
  }

  const currentYear = now.getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-x-hidden overflow-y-auto">
        <DialogHeader><DialogTitle>Новая работа</DialogTitle></DialogHeader>
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Год *</Label>
              <Select value={year} onValueChange={(v) => setYear(v ?? "")}>
                <SelectTrigger><SelectValue>{year} год</SelectValue></SelectTrigger>
                <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y} год</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Месяц *</Label>
              <Select value={month} onValueChange={(v) => setMonth(v ?? "")}>
                <SelectTrigger><SelectValue>{MONTHS[parseInt(month) - 1]?.label}</SelectValue></SelectTrigger>
                <SelectContent>{MONTHS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Проект *</Label>
            <SearchableSelect
              value={projectId}
              onValueChange={setProjectId}
              options={planProjects.map((project) => ({ value: project.id, label: project.name }))}
              placeholder={loadingProjects ? "Загрузка..." : "Выберите проект"}
              emptyMessage={loadingProjects ? "Загрузка..." : "Нет проектов в плане расходов"}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Вид работ *</Label>
            <SearchableSelect
              value={workTypeId}
              onValueChange={setWorkTypeId}
              options={planWorkTypes.map((workType) => ({ value: workType.id, label: workType.name }))}
              disabled={!projectId}
              placeholder={!projectId ? "Сначала выберите проект" : loadingWorkTypes ? "Загрузка..." : "Выберите вид работ"}
              emptyMessage={loadingWorkTypes ? "Загрузка..." : "Нет видов работ в плане для этого проекта"}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Техническое задание *</Label>
            <Textarea value={techTask} onChange={(e) => setTechTask(e.target.value)} placeholder="Введите текст ТЗ" rows={4} className="field-sizing-fixed min-w-0 resize-y break-all text-xs" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label>Объём</Label><MoneyInput value={volume} onChange={setVolume} placeholder="0" /></div>
            <div className="space-y-1.5"><Label>Ставка</Label><MoneyInput value={rate} onChange={setRate} placeholder="0" /></div>
            <div className="space-y-1.5"><Label>Сумма *</Label><MoneyInput value={amount} onChange={setAmount} placeholder="0" /></div>
          </div>
          <div className="space-y-1.5"><Label>Дата оплаты план</Label><DateInput value={plannedPayAt} onChange={setPlannedPayAt} onEmptyFocus={() => toLocalDateString(nearestPaymentDate())} /></div>
          <div className="space-y-1.5"><Label>Ссылка</Label><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." /></div>
          <div className="space-y-1.5"><Label>Отчёт</Label><Textarea value={report} onChange={(e) => setReport(e.target.value)} placeholder="Текст отчёта" rows={3} className="field-sizing-fixed min-w-0 resize-y break-words text-xs" /></div>
          <div className="space-y-1.5"><Label>Комментарий</Label><Input value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Сохранение..." : "Создать"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Work Dialog ──────────────────────────────────────────────────────────

function EditWorkDialog({
  executorId, work, isAdmin, permanentExecutors, onClose, onSaved,
}: {
  executorId: string;
  work: WorkRow;
  isAdmin: boolean;
  permanentExecutors: ExecutorRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [projectId, setProjectId] = useState(work.projectId);
  const [workTypeId, setWorkTypeId] = useState(work.workTypeId);
  const [year, setYear] = useState(String(work.executionYear));
  const [month, setMonth] = useState(String(work.executionMonth));
  const [techTask, setTechTask] = useState(work.techTask ?? "");
  const [volume, setVolume] = useState(work.volume != null ? String(work.volume) : "");
  const [rate, setRate] = useState(work.rate != null ? String(work.rate) : "");
  const [amount, setAmount] = useState(String(work.amount));
  const [responsibleExecutorId, setResponsibleExecutorId] = useState(work.responsibleExecutorId ?? "");
  const [plannedPayAt, setPlannedPayAt] = useState(work.plannedPayAt ? toLocalDateString(new Date(work.plannedPayAt)) : "");
  const [link, setLink] = useState(work.link ?? "");
  const [report, setReport] = useState(work.report ?? "");
  const [workStatus, setWorkStatus] = useState(work.workStatus);
  const [comment, setComment] = useState(work.comment ?? "");
  const [saving, setSaving] = useState(false);

  const isLinked = !!work.paymentId;
  const [planProjects, setPlanProjects] = useState<Project[]>([]);
  const [planWorkTypes, setPlanWorkTypes] = useState<WorkType[]>([]);

  useEffect(() => {
    fetch(`/api/executors/${executorId}/plan-projects`).then((r) => r.json()).then(setPlanProjects).catch(() => {});
  }, [executorId]);
  useEffect(() => {
    if (!projectId) { setPlanWorkTypes([]); return; }
    fetch(`/api/executors/${executorId}/plan-work-types?projectId=${projectId}`).then((r) => r.json()).then(setPlanWorkTypes).catch(() => {});
  }, [executorId, projectId]);

  useEffect(() => {
    const v = parseDecimal(volume);
    const r = parseDecimal(rate);
    if (!isNaN(v) && !isNaN(r)) setAmount(String(v * r));
  }, [volume, rate]);

  const currentYear = new Date().getFullYear();
  const years = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

  async function handleSave() {
    setSaving(true);
    try {
      // Без выплаты дата план должна писаться в Work; пустое → ближайшее 5/20
      const planDate = isLinked
        ? undefined
        : (plannedPayAt || toLocalDateString(nearestPaymentDate()));
      const r = await fetch(`/api/executors/${executorId}/works/${work.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, workTypeId,
          executionYear: parseInt(year), executionMonth: parseInt(month),
          techTask,
          volume: volume ? parseDecimal(volume) : null,
          rate: rate ? parseDecimal(rate) : null,
          amount: parseDecimal(amount),
          responsibleExecutorId: responsibleExecutorId || null,
          ...(planDate !== undefined ? { plannedPayAt: planDate } : {}),
          link: link || null, report: report || null,
          ...(isAdmin && !isLinked ? { workStatus } : {}),
          comment: comment || null,
        }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? "Ошибка"); }
      toast.success("Работа обновлена");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-x-hidden overflow-y-auto">
        <DialogHeader><DialogTitle>Редактировать работу</DialogTitle></DialogHeader>
        {isLinked && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            Работа привязана к выплате: статус и даты управляются выплатой.
          </p>
        )}
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Год</Label>
              <Select value={year} onValueChange={(v) => setYear(v ?? "")}>
                <SelectTrigger><SelectValue>{year} год</SelectValue></SelectTrigger>
                <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y} год</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Месяц</Label>
              <Select value={month} onValueChange={(v) => setMonth(v ?? "")}>
                <SelectTrigger><SelectValue>{MONTHS[parseInt(month) - 1]?.label}</SelectValue></SelectTrigger>
                <SelectContent>{MONTHS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Проект</Label>
            <SearchableSelect
              value={projectId}
              onValueChange={setProjectId}
              options={planProjects.map((project) => ({ value: project.id, label: project.name }))}
              placeholder={work.project.name}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Вид работ</Label>
            <SearchableSelect
              value={workTypeId}
              onValueChange={setWorkTypeId}
              options={planWorkTypes.map((workType) => ({ value: workType.id, label: workType.name }))}
              placeholder={work.workType.name}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Ответственный</Label>
            <SearchableSelect
              value={responsibleExecutorId}
              onValueChange={setResponsibleExecutorId}
              options={permanentExecutors.map((executor) => ({ value: executor.id, label: executor.name }))}
              placeholder={work.responsibleExecutor?.name ?? "—"}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Техническое задание</Label>
            <Textarea value={techTask} onChange={(e) => setTechTask(e.target.value)} rows={4} className="field-sizing-fixed min-w-0 resize-y break-all text-xs" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label>Объём</Label><MoneyInput value={volume} onChange={setVolume} /></div>
            <div className="space-y-1.5"><Label>Ставка</Label><MoneyInput value={rate} onChange={setRate} /></div>
            <div className="space-y-1.5"><Label>Сумма</Label><MoneyInput value={amount} onChange={setAmount} /></div>
          </div>
          {!isLinked && (
            <div className="space-y-1.5"><Label>Дата оплаты план</Label><DateInput value={plannedPayAt} onChange={setPlannedPayAt} onEmptyFocus={() => toLocalDateString(nearestPaymentDate())} /></div>
          )}
          {isAdmin && !isLinked && (
            <div className="space-y-1.5">
              <Label>Статус</Label>
              <Select value={workStatus} onValueChange={(v) => setWorkStatus(v ?? "")}>
                <SelectTrigger><SelectValue>{WORK_STATUS_LABELS[workStatus] ?? workStatus}</SelectValue></SelectTrigger>
                <SelectContent>{WORK_STATUS_SETTABLE.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5"><Label>Ссылка</Label><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." /></div>
          <div className="space-y-1.5"><Label>Отчёт</Label><Textarea value={report} onChange={(e) => setReport(e.target.value)} placeholder="Текст отчёта" rows={3} className="field-sizing-fixed min-w-0 resize-y break-words text-xs" /></div>
          <div className="space-y-1.5"><Label>Комментарий</Label><Input value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          {isAdmin && (
            <EntityActivityHistory entityType="Work" entityId={work.id} />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Payment Dialog («Добавить выплату» — без работ, сумма 0) ────────────

function CreatePaymentDialog({ executorId, bankAccounts, onClose, onCreated }: { executorId: string; bankAccounts: BankAccount[]; onClose: () => void; onCreated: () => void }) {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [amount, setAmount] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [plannedPayAt, setPlannedPayAt] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const currentYear = now.getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1];

  async function handleSave() {
    if (!amount || parseDecimal(amount) <= 0) {
      toast.error("Введите сумму больше нуля");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`/api/executors/${executorId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodYear: parseInt(year), periodMonth: parseInt(month),
          amount: amount ? parseDecimal(amount) : 0,
          paymentStatus: "planned",
          bankAccountId: bankAccountId || null,
          plannedPayAt: plannedPayAt || toLocalDateString(nearestPaymentDate()),
          comment: comment || null,
        }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? "Ошибка"); }
      toast.success("Выплата добавлена");
      onCreated();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Добавить выплату</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Год *</Label>
              <Select value={year} onValueChange={(v) => setYear(v ?? "")}>
                <SelectTrigger><SelectValue>{year} год</SelectValue></SelectTrigger>
                <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y} год</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Месяц *</Label>
              <Select value={month} onValueChange={(v) => setMonth(v ?? "")}>
                <SelectTrigger><SelectValue>{MONTHS[parseInt(month) - 1]?.label}</SelectValue></SelectTrigger>
                <SelectContent>{MONTHS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Сумма</Label><MoneyInput value={amount} onChange={setAmount} placeholder="0" /></div>
          <div className="space-y-1.5">
            <Label>Источник оплаты</Label>
            <SearchableSelect
              value={bankAccountId}
              onValueChange={setBankAccountId}
              options={[
                { value: "", label: "— По умолчанию —" },
                ...bankAccounts.map((bankAccount) => ({ value: bankAccount.id, label: bankAccount.name })),
              ]}
            />
          </div>
          <div className="space-y-1.5"><Label>Дата оплаты план</Label><DateInput value={plannedPayAt} onChange={setPlannedPayAt} onEmptyFocus={() => toLocalDateString(nearestPaymentDate())} /></div>
          <div className="space-y-1.5"><Label>Комментарий</Label><Input value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Сохранение..." : "Создать"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Mark Paid Dialog ───────────────────────────────────────────────────────────

function MarkPaidDialog({ payment, bankAccounts, onClose, onConfirm }: { payment: PaymentRow; bankAccounts: BankAccount[]; onClose: () => void; onConfirm: (paidAt: string, bankAccountId: string | null) => void }) {
  const [paidAt, setPaidAt] = useState(toLocalDateString(new Date()));
  const [bankAccountId, setBankAccountId] = useState(payment.bankAccountId ?? "");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Оплатить выплату</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Дата оплаты *</Label><DateInput value={paidAt} onChange={setPaidAt} /></div>
          <div className="space-y-1.5">
            <Label>Источник оплаты</Label>
            <SearchableSelect
              value={bankAccountId}
              onValueChange={setBankAccountId}
              options={[
                { value: "", label: "— По умолчанию —" },
                ...bankAccounts.map((bankAccount) => ({ value: bankAccount.id, label: bankAccount.name })),
              ]}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={!paidAt} onClick={() => onConfirm(paidAt, bankAccountId || null)}>Оплатить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Payment Dialog (параметры выплаты + управление связями) ────────────────

function EditPaymentDialog({
  executorId, payment, bankAccounts, linkedWorks, availableWorks, onClose, onSaved,
}: {
  executorId: string;
  payment: AllPaymentRow;
  bankAccounts: BankAccount[];
  linkedWorks: WorkRow[];
  availableWorks: WorkRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const hasWorks = linkedWorks.length > 0;
  const locked = payment.paymentStatus === "paid";
  const [amount, setAmount] = useState(String(payment.amount));
  const [paymentStatus, setPaymentStatus] = useState(payment.paymentStatus);
  const [bankAccountId, setBankAccountId] = useState(payment.bankAccountId ?? "");
  const [plannedPayAt, setPlannedPayAt] = useState(payment.plannedPayAt ? toLocalDateString(new Date(payment.plannedPayAt)) : "");
  const [paidAt, setPaidAt] = useState(payment.paidAt ? toLocalDateString(new Date(payment.paidAt)) : "");
  const [comment, setComment] = useState(payment.comment ?? "");
  const [filledTechTask, setFilledTechTask] = useState(payment.filledTechTask ?? "");
  const [filledAct, setFilledAct] = useState(payment.filledAct ?? "");
  const [removeIds, setRemoveIds] = useState<Set<string>>(new Set());
  const [addIds, setAddIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  function toggle(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  }

  async function handleSave() {
    setSaving(true);
    try {
      // 1) Управление связями (если есть изменения и не заблокировано)
      if (!locked && (addIds.size > 0 || removeIds.size > 0)) {
        const lr = await fetch(`/api/executors/${executorId}/payments/${payment.id}/works`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ add: Array.from(addIds), remove: Array.from(removeIds) }),
        });
        if (!lr.ok) { const d = await lr.json().catch(() => ({})); throw new Error((d as { error?: string }).error ?? "Ошибка связей"); }
      }
      // 2) Параметры выплаты
      const body: Record<string, unknown> = {
        paymentStatus,
        bankAccountId: bankAccountId || null,
        plannedPayAt: plannedPayAt || toLocalDateString(nearestPaymentDate()),
        paidAt: paidAt || null,
        comment: comment || null,
        filledTechTask: filledTechTask || null,
        filledAct: filledAct || null,
      };
      if (!hasWorks && addIds.size === 0) body.amount = amount ? parseDecimal(amount) : 0;
      const r = await fetch(`/api/executors/${executorId}/payments/${payment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error((d as { error?: string }).error ?? "Ошибка"); }
      toast.success("Выплата обновлена");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] min-w-0 overflow-x-hidden overflow-y-auto">
        <DialogHeader><DialogTitle>Параметры выплаты</DialogTitle></DialogHeader>
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Статус</Label>
              <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v ?? "")}>
                <SelectTrigger><SelectValue>{PAYMENT_STATUS_LABELS[paymentStatus] ?? paymentStatus}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Выплата запланирована</SelectItem>
                  <SelectItem value="paid">Выплата оплачена</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Сумма {hasWorks && <span className="text-neutral-400">(= сумма работ)</span>}</Label>
              <MoneyInput value={hasWorks ? String(linkedWorks.reduce((s, w) => s + w.amount, 0)) : amount} onChange={setAmount} disabled={hasWorks} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Источник перевода</Label>
            <SearchableSelect
              value={bankAccountId}
              onValueChange={setBankAccountId}
              options={[
                { value: "", label: "— По умолчанию —" },
                ...bankAccounts.map((bankAccount) => ({ value: bankAccount.id, label: bankAccount.name })),
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Дата оплаты план</Label>
              <DateInput value={plannedPayAt} onChange={setPlannedPayAt} onEmptyFocus={() => toLocalDateString(nearestPaymentDate())} />
            </div>
            <div className="space-y-1.5">
              <Label>Дата оплаты</Label>
              <DateInput
                value={paidAt}
                onChange={setPaidAt}
                onEmptyFocus={() => toLocalDateString(new Date())}
              />
            </div>
          </div>
          <div className="space-y-1.5"><Label>Комментарий</Label><Input value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Заполненное ТЗ (URL)</Label><Input value={filledTechTask} onChange={(e) => setFilledTechTask(e.target.value)} placeholder="https://..." /></div>
          <div className="space-y-1.5"><Label>Заполненный акт (URL)</Label><Input value={filledAct} onChange={(e) => setFilledAct(e.target.value)} placeholder="https://..." /></div>

          {/* Управление связями */}
          <div className="min-w-0 space-y-2 border-t pt-3">
            <div className="text-xs font-semibold text-neutral-700">Привязанные работы</div>
            {locked && <p className="text-xs text-amber-700">Чтобы изменить список привязанных работ, смените статус выплаты на «запланирована» (если она ещё не оплачена).</p>}
            {linkedWorks.length === 0 ? (
              <p className="text-xs text-neutral-400">Нет привязанных работ.</p>
            ) : (
              <div className="min-w-0 space-y-1 overflow-hidden">
                {linkedWorks.map((w) => (
                  <label key={w.id} className="flex min-w-0 items-start gap-2 text-xs">
                    <Checkbox className="mt-0.5 shrink-0" checked={removeIds.has(w.id)} disabled={locked} onCheckedChange={() => toggle(removeIds, w.id, setRemoveIds)} />
                    <span className="shrink-0 text-red-600">отвязать</span>
                    <span className="min-w-0 flex-1 break-all">{w.project.name} · {w.techTask || "—"}</span>
                    <span className="shrink-0 tabular-nums">{formatMoney(w.amount)}</span>
                  </label>
                ))}
              </div>
            )}
            {!locked && availableWorks.length > 0 && (
              <>
                <div className="pt-1 text-xs font-semibold text-neutral-700">Добавить проверенные работы</div>
                <div className="max-h-40 min-w-0 space-y-1 overflow-x-hidden overflow-y-auto">
                  {availableWorks.map((w) => (
                    <label key={w.id} className="flex min-w-0 items-start gap-2 text-xs">
                      <Checkbox className="mt-0.5 shrink-0" checked={addIds.has(w.id)} onCheckedChange={() => toggle(addIds, w.id, setAddIds)} />
                      <span className="min-w-0 flex-1 break-all">{w.project.name} · {w.techTask || "—"}</span>
                      <span className="shrink-0 tabular-nums">{formatMoney(w.amount)}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <EntityActivityHistory entityType="Payment" entityId={payment.id} />
        </div>
        <DialogFooter className="min-w-0">
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
