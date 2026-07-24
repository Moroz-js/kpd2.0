"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatMoney, formatMoneyRub } from "@/lib/format";
import { getISOWeek, getISOWeekYear, weekLabel, toLocalDateString } from "@/lib/iso-weeks";
import { CHARGE_STATUSES, BADGE_TONE_CLASS } from "@/lib/statuses";
import {
  Table, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { stickyActionsHead, stickyActionsCell, stickyActionsInner, compactTable, compactHead, compactCell, compactCellClip } from "@/lib/table-styles";
import { VirtualizedTableBody } from "@/components/ui-custom/VirtualizedTableBody";
import { MultiSelectFilter } from "@/components/ui-custom/MultiSelectFilter";
import {
  GroupBySelect,
  GroupHeaderRow,
  buildGroupedFlatList,
  compareGroupKeys,
  compareGroupLabels,
  type FlatGroupItem,
} from "@/components/ui-custom/TableGrouping";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { RowSelectCheckbox } from "@/components/ui-custom/RowSelectCheckbox";
import { SortableHead } from "@/components/ui-custom/SortableHead";
import { useTableRowSelection } from "@/lib/useTableRowSelection";
import { sortByNameRu } from "@/lib/sort";

const ACTIONS_COL_WIDTH = 96;
/** table-fixed: фиксированные ширины, иначе текст залезает под sticky-действия */
const CHARGES_COL_WIDTHS = [
  48, 140, 100, 128, 148, 168, 84, 84, 84, 84, 72, 60, 84, 192, 100, 100, 168, ACTIONS_COL_WIDTH,
] as const;
const CHARGES_TABLE_MIN_WIDTH = CHARGES_COL_WIDTHS.reduce((s, w) => s + w, 0);

const [COL_CHECKBOX, COL_BANK, COL_AMOUNT] = CHARGES_COL_WIDTHS;

const stickyColStyle = (left: number, width: number): React.CSSProperties => ({
  left,
  width,
  minWidth: width,
  maxWidth: width,
});

const stickyCheckboxHead =
  "sticky z-30 box-border bg-neutral-100 px-0 [&:has([role=checkbox])]:pr-0";
const stickyCheckboxCell =
  "sticky z-10 box-border bg-white px-0 [&:has([role=checkbox])]:pr-0";
const stickyBankHead = "sticky z-[31] box-border bg-neutral-100";
const stickyBankCell = "sticky z-[11] box-border bg-white";
const stickyAmountHead =
  "sticky z-[32] box-border bg-neutral-100 border-r border-neutral-200 -ml-px";
const stickyAmountCell =
  "sticky z-[12] box-border bg-white border-r border-neutral-200 -ml-px";

function chargeCountLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} начисление`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} начисления`;
  return `${n} начислений`;
}

function clipText(text: string, title?: string) {
  return (
    <div className="truncate" title={title ?? (text !== "—" ? text : undefined)}>
      {text}
    </div>
  );
}

// ─── Типы ─────────────────────────────────────────────────────────────────────

type BankAccount = { id: string; name: string; currency: string };
type Order = {
  id: string;
  orderNumber: string;
  description: string | null;
  project: {
    id: string; name: string;
    client: { id: string; name: string } | null;
  };
};

type Charge = {
  id: string;
  chargeNumber: string;
  bankAccountId: string | null; bankAccount: BankAccount | null;
  invoiceNumber: string;
  orderId: string | null; order: Order | null;
  amount: number;
  issuedPlanAt: string | null;
  issuedAt: string | null;
  paidPlanAt: string | null;
  paidAt: string | null;
  paymentPurpose: string | null;
  status: string;
  createdAt: string;
};

type Props = {
  bankAccounts: BankAccount[];
  orders: Order[];
};

// ─── Вычисляемые поля ─────────────────────────────────────────────────────────

function planDate(charge: Charge): Date | null {
  return charge.paidPlanAt ? new Date(charge.paidPlanAt) : null;
}

function payWeekPF(charge: Charge): number | null {
  const d = charge.paidAt ?? charge.paidPlanAt;
  if (!d) return null;
  return getISOWeek(new Date(d));
}

function payYearPF(charge: Charge): number | null {
  const d = charge.paidAt ?? charge.paidPlanAt;
  if (!d) return null;
  return getISOWeekYear(new Date(d));
}

/** ISO year+week, недели 1–9 с ведущим нулём (`2026-01`). */
function payWeekKey(charge: Charge): string {
  const w = payWeekPF(charge);
  const y = payYearPF(charge);
  if (w === null || y === null) return "__empty__";
  return `${y}-${String(w).padStart(2, "0")}`;
}

function payWeekGroupLabel(charge: Charge): string {
  const w = payWeekPF(charge);
  const y = payYearPF(charge);
  if (w === null || y === null) return "Не указано";
  return `${weekLabel(w)} ${y}`;
}

const CHARGE_GROUP_OPTIONS = [
  { value: "bank", label: "По банковскому счёту" },
  { value: "week", label: "По неделе" },
  { value: "project", label: "По проекту" },
] as const;

type SortField = "status" | "week" | "issuedPlanAt" | "issuedAt" | "paidPlanAt" | "paidAt";
type SortDir = "asc" | "desc";

const CHARGE_STATUS_ORDER = Object.keys(CHARGE_STATUSES);

function cmpDateNullsLast(a: string | null, b: string | null, dir: SortDir): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const cmp = new Date(a).getTime() - new Date(b).getTime();
  return dir === "asc" ? cmp : -cmp;
}

function compareCharges(a: Charge, b: Charge, field: SortField, dir: SortDir): number {
  switch (field) {
    case "status": {
      const ai = CHARGE_STATUS_ORDER.indexOf(a.status);
      const bi = CHARGE_STATUS_ORDER.indexOf(b.status);
      const cmp = (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
      return dir === "asc" ? cmp : -cmp;
    }
    case "week": {
      const ak = payWeekKey(a);
      const bk = payWeekKey(b);
      if (ak === "__empty__" && bk === "__empty__") return 0;
      if (ak === "__empty__") return 1;
      if (bk === "__empty__") return -1;
      const cmp = ak.localeCompare(bk);
      return dir === "asc" ? cmp : -cmp;
    }
    case "issuedPlanAt":
      return cmpDateNullsLast(a.issuedPlanAt, b.issuedPlanAt, dir);
    case "issuedAt":
      return cmpDateNullsLast(a.issuedAt, b.issuedAt, dir);
    case "paidPlanAt":
      return cmpDateNullsLast(a.paidPlanAt, b.paidPlanAt, dir);
    case "paidAt":
      return cmpDateNullsLast(a.paidAt, b.paidAt, dir);
  }
}

function orderPrimaryLabel(o: Order): string {
  return `№${o.orderNumber} ${o.project.name}`;
}

function OrderSelectLabel({ order }: { order: Order }) {
  return (
    <div className="min-w-0 py-0.5">
      <div className="truncate">{orderPrimaryLabel(order)}</div>
      {order.description ? (
        <div className="truncate text-xs text-neutral-500">{order.description}</div>
      ) : null}
    </div>
  );
}

// ─── Условное форматирование ──────────────────────────────────────────────────

function cellRed(condition: boolean) {
  return condition ? "bg-red-100 text-red-700" : "";
}

function cellEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && !value.trim()) return true;
  if (typeof value === "number" && value === 0) return true;
  return false;
}

function isOverdueH(charge: Charge): boolean {
  const d = planDate(charge);
  if (!d) return false;
  return d < new Date() && charge.status !== "paid";
}

function isMissingM(charge: Charge): boolean {
  return !charge.paidAt && (charge.status === "paid" || isOverdueH(charge));
}

// ─── Компоненты ───────────────────────────────────────────────────────────────

function ChargeStatusBadge({ status }: { status: string }) {
  const entry = CHARGE_STATUSES[status as keyof typeof CHARGE_STATUSES];
  if (!entry) return <span className="text-xs text-neutral-400">—</span>;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0 text-xs font-medium whitespace-nowrap ${BADGE_TONE_CLASS[entry.tone]}`}>
      {entry.label}
    </span>
  );
}

function InlineDateCell({ value, onSave, highlight }: { value: string; onSave: (v: string) => void; highlight?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);

  useEffect(() => {
    if (!editing) setV(value);
  }, [value, editing]);

  function commit() {
    setEditing(false);
    onSave(v);
  }

  if (!editing) {
    return (
      <span
        className="inline-flex cursor-pointer hover:bg-neutral-100 rounded px-1 py-0.5 text-xs text-neutral-600"
        onClick={() => {
          setV(value);
          setEditing(true);
          setTimeout(() => { try { ref.current?.showPicker(); } catch { /**/ } }, 50);
        }}
      >
        {value ? value.slice(5).split("-").reverse().join(".") : <span className={highlight ? "font-medium" : "text-neutral-300"}>—</span>}
      </span>
    );
  }
  // Инпут шире узкой колонки — поверх соседних ячеек с непрозрачным фоном,
  // иначе «просвечивает» и визуально наезжает на соседние даты.
  return (
    <div className="relative h-6 min-w-0">
      <input
        ref={ref}
        autoFocus
        type="date"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setV(value);
            setEditing(false);
          }
        }}
        onClick={() => { try { ref.current?.showPicker(); } catch { /**/ } }}
        className="absolute left-0 top-1/2 z-30 h-7 w-[8.5rem] -translate-y-1/2 cursor-pointer rounded border border-blue-300 bg-white px-1 py-0.5 text-xs outline-none shadow-md"
      />
    </div>
  );
}

function InlinePurposeCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  function handleSave() {
    setOpen(false);
    if (draft !== value) onSave(draft);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex max-w-full rounded px-1 py-0.5 text-left text-xs text-neutral-600 hover:bg-neutral-100"
          />
        }
      >
        <span className="line-clamp-2 min-w-0 break-words">
          {value || <span className="text-neutral-300">— задать —</span>}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start" side="bottom">
        <div className="space-y-2">
          <Label className="text-xs text-neutral-600">Назначение платежа</Label>
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            className="min-h-[120px] resize-y text-xs"
            placeholder="Текст назначения..."
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(value);
                setOpen(false);
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(value);
                setOpen(false);
              }}
            >
              Отмена
            </Button>
            <Button type="button" size="sm" onClick={handleSave}>
              Сохранить
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const MONTH_LABELS = [
  "Январь","Февраль","Март","Апрель","Май","Июнь",
  "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь",
];

type ChargeTableRowProps = {
  row: Charge;
  rowIndex: number;
  checked: boolean;
  onSelect: (index: number, id: string, shiftKey: boolean) => void;
  onEdit: (row: Charge) => void;
  onDelete: (row: Charge) => void;
  onPatchStatus: (id: string, status: string) => void;
  onPatchDate: (id: string, field: "issuedPlanAt" | "issuedAt" | "paidPlanAt" | "paidAt", value: string) => void;
  onPatchPurpose: (id: string, purpose: string) => void;
};

const ChargeTableRow = React.memo(function ChargeTableRow({
  row,
  rowIndex,
  checked,
  onSelect,
  onEdit,
  onDelete,
  onPatchStatus,
  onPatchDate,
  onPatchPurpose,
}: ChargeTableRowProps) {
  const pd = planDate(row);
  const overdueH = isOverdueH(row);
  const missingM = isMissingM(row);
  const bankEmpty = cellEmpty(row.bankAccount?.name);

  return (
    <TableRow className={checked ? "bg-blue-50" : ""}>
      <TableCell
        className={cn(stickyCheckboxCell, checked && "bg-blue-50")}
        style={stickyColStyle(0, COL_CHECKBOX)}
      >
        <div className="flex items-center justify-center">
          <RowSelectCheckbox
            checked={checked}
            rowIndex={rowIndex}
            rowId={row.id}
            onSelect={onSelect}
          />
        </div>
      </TableCell>
      <TableCell
        className={cn(
          compactCell,
          compactCellClip,
          stickyBankCell,
          cellRed(bankEmpty),
          "whitespace-normal",
          checked && "bg-blue-50",
          bankEmpty && checked && "bg-red-100",
        )}
        style={stickyColStyle(COL_CHECKBOX, COL_BANK)}
      >
        {clipText(row.bankAccount?.name ?? "—", row.bankAccount?.name ?? undefined)}
      </TableCell>
      <TableCell
        className={cn(
          compactCell,
          stickyAmountCell,
          "text-right tabular-nums font-semibold",
          cellRed(cellEmpty(row.amount)),
          checked && "bg-blue-50",
          cellEmpty(row.amount) && checked && "bg-red-100",
        )}
        style={stickyColStyle(COL_CHECKBOX + COL_BANK, COL_AMOUNT)}
      >
        {row.amount ? (
          <span className="inline-flex items-center gap-1">
            {formatMoney(row.amount)}
            {row.bankAccount?.currency && (
              <span className="text-[10px] font-normal text-neutral-400 tracking-wide">
                {row.bankAccount.currency}
              </span>
            )}
          </span>
        ) : "—"}
      </TableCell>
      <TableCell className={compactCell}>
        <Select value={row.status} onValueChange={(v) => v && onPatchStatus(row.id, v)}>
          <SelectTrigger className="h-6 w-auto min-w-[104px] border-0 bg-transparent shadow-none p-0 focus:ring-0 [&>svg]:hidden">
            <SelectValue>
              <ChargeStatusBadge status={row.status} />
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CHARGE_STATUSES).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className={cn(compactCell, compactCellClip, "whitespace-normal")}>
        {clipText(row.order?.project?.client?.name ?? "—", row.order?.project?.client?.name ?? undefined)}
      </TableCell>
      <TableCell className={cn(compactCell, compactCellClip, cellRed(cellEmpty(row.order?.project?.name)), "whitespace-normal")}>
        {clipText(row.order?.project?.name ?? "—", row.order?.project?.name ?? undefined)}
      </TableCell>
      <TableCell className={compactCell}>
        <InlineDateCell
          value={row.issuedPlanAt ? row.issuedPlanAt.slice(0, 10) : ""}
          onSave={(v) => onPatchDate(row.id, "issuedPlanAt", v)}
        />
      </TableCell>
      <TableCell className={compactCell}>
        <InlineDateCell
          value={row.issuedAt ? row.issuedAt.slice(0, 10) : ""}
          onSave={(v) => onPatchDate(row.id, "issuedAt", v)}
        />
      </TableCell>
      <TableCell className={cn(compactCell, cellRed(overdueH))}>
        <InlineDateCell
          value={row.paidPlanAt ? row.paidPlanAt.slice(0, 10) : ""}
          onSave={(v) => onPatchDate(row.id, "paidPlanAt", v)}
        />
      </TableCell>
      <TableCell className={compactCell}>{pd ? MONTH_LABELS[pd.getMonth()] : "—"}</TableCell>
      <TableCell className={compactCell}>{pd ? weekLabel(getISOWeek(pd)) : "—"}</TableCell>
      <TableCell className={compactCell}>{pd ? pd.getFullYear() : "—"}</TableCell>
      <TableCell className={cn(compactCell, cellRed(missingM))}>
        <InlineDateCell
          value={row.paidAt ? row.paidAt.slice(0, 10) : ""}
          onSave={(v) => onPatchDate(row.id, "paidAt", v)}
          highlight={missingM}
        />
      </TableCell>
      <TableCell className={cn(compactCell, compactCellClip, "align-top whitespace-normal")}>
        <InlinePurposeCell
          value={row.paymentPurpose ?? ""}
          onSave={(v) => onPatchPurpose(row.id, v)}
        />
      </TableCell>
      <TableCell className={cn(compactCell, compactCellClip, `tabular-nums whitespace-normal ${cellRed(cellEmpty(row.order?.orderNumber))}`)}>
        {clipText(row.order ? row.order.orderNumber : "—", row.order?.orderNumber)}
      </TableCell>
      <TableCell className={cn(compactCell, compactCellClip, "tabular-nums whitespace-normal")}>
        {clipText(row.chargeNumber, row.chargeNumber)}
      </TableCell>
      <TableCell className={cn(compactCell, compactCellClip, cellRed(cellEmpty(row.invoiceNumber)), "whitespace-normal")}>
        {clipText(row.invoiceNumber || "—", row.invoiceNumber || undefined)}
      </TableCell>
      <TableCell className={cn(stickyActionsCell, "w-[96px] min-w-[96px] max-w-[96px]", checked && "bg-blue-50")}>
        <div className={stickyActionsInner}>
          <button title="Редактировать" className="p-0.5 text-neutral-500 hover:text-neutral-800" onClick={() => onEdit(row)}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button title="Удалить" className="p-0.5 text-red-400 hover:text-red-600" onClick={() => onDelete(row)}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </TableCell>
    </TableRow>
  );
});

// ─── Главный компонент ────────────────────────────────────────────────────────

export function ChargesClient({ bankAccounts: bankAccountsProp, orders }: Props) {
  const bankAccounts = React.useMemo(() => sortByNameRu(bankAccountsProp), [bankAccountsProp]);
  const [rows, setRows] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Charge | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Charge | null>(null);

  // Фильтры
  const [fBankAccount, setFBankAccount] = useState<string[]>([]);
  const [fOrder, setFOrder] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fClient, setFClient] = useState<string[]>([]);
  const [fProject, setFProject] = useState<string[]>([]);
  const [fWeek, setFWeek] = useState<string[]>([]);
  const [hidePaid, setHidePaid] = useState(false);
  const [groupBy, setGroupBy] = useState<"" | "bank" | "week" | "project">("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir } | null>(null);

  const [bulkStatus, setBulkStatus] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    const r = await fetch("/api/charges");
    if (!r.ok) throw new Error();
    return r.json() as Promise<Charge[]>;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await fetchData()); } catch { toast.error("Не удалось загрузить данные"); }
    finally { setLoading(false); }
  }, [fetchData]);

  const silentLoad = useCallback(() => { fetchData().then(setRows).catch(() => {}); }, [fetchData]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => {
    if (fBankAccount.length && (!r.bankAccountId || !fBankAccount.includes(r.bankAccountId))) return false;
    if (fOrder.length && (!r.orderId || !fOrder.includes(r.orderId))) return false;
    if (fStatus.length && !fStatus.includes(r.status)) return false;
    if (fClient.length) {
      const clientId = r.order?.project?.client?.id ?? "__empty__";
      if (!fClient.includes(clientId)) return false;
    }
    if (fProject.length) {
      const projectId = r.order?.project?.id ?? "__empty__";
      if (!fProject.includes(projectId)) return false;
    }
    if (fWeek.length) {
      if (!fWeek.includes(payWeekKey(r))) return false;
    }
    return true;
  });

  const visible = React.useMemo(() => {
    let list = hidePaid ? filtered.filter((r) => r.status !== "paid") : filtered;
    list = [...list];
    if (sort) {
      list.sort((a, b) => compareCharges(a, b, sort.field, sort.dir));
    } else {
      list.sort((a, b) => b.chargeNumber.localeCompare(a.chargeNumber, "ru"));
    }
    return list;
  }, [filtered, hidePaid, sort]);

  function handleSort(field: string, dir: SortDir) {
    setSort((prev) => {
      // SortableHead: desc → asc; для 3-шагового цикла трактуем как сброс.
      if (prev?.field === field && prev.dir === "desc" && dir === "asc") return null;
      return { field: field as SortField, dir };
    });
  }

  const orderedRowIds = React.useMemo(() => visible.map((r) => r.id), [visible]);
  const rowIndexById = React.useMemo(() => {
    const map = new Map<string, number>();
    visible.forEach((r, i) => map.set(r.id, i));
    return map;
  }, [visible]);
  const { selectedIds, handleRowSelect, toggleAll, clearSelection } = useTableRowSelection(orderedRowIds);

  const selectedSum = React.useMemo(
    () => rows.filter((r) => selectedIds.has(r.id)).reduce((s, r) => s + (r.amount ?? 0), 0),
    [rows, selectedIds]
  );

  const flatItems = React.useMemo((): FlatGroupItem<Charge>[] | null => {
    if (!groupBy) return null;
    const getKey = (r: Charge): string => {
      if (groupBy === "bank") return r.bankAccountId ?? "__empty__";
      if (groupBy === "week") return payWeekKey(r);
      return r.order?.project?.id ?? "__empty__";
    };
    const getLabel = (r: Charge): string => {
      if (groupBy === "bank") return r.bankAccount?.name ?? "Не указано";
      if (groupBy === "week") return payWeekGroupLabel(r);
      return r.order?.project?.name ?? "Не указано";
    };
    const groupDir: SortDir =
      sort?.field === "week" && groupBy === "week"
        ? sort.dir
        : groupBy === "week"
          ? "desc"
          : "asc";
    return buildGroupedFlatList(
      visible,
      getKey,
      getLabel,
      (r) => r.amount ?? 0,
      collapsedGroups,
      {
        compareRows: (a, b) =>
          sort
            ? compareCharges(a, b, sort.field, sort.dir)
            : b.chargeNumber.localeCompare(a.chargeNumber, "ru"),
        compareGroups: (a, b) =>
          groupBy === "week"
            ? compareGroupKeys(a.key, b.key, groupDir)
            : compareGroupLabels(a.label, b.label, groupDir),
      }
    );
  }, [visible, groupBy, collapsedGroups, sort]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleGroupByChange = useCallback((v: string) => {
    setGroupBy((v === "bank" || v === "week" || v === "project" ? v : "") as "" | "bank" | "week" | "project");
    setCollapsedGroups(new Set());
  }, []);

  const clientOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    // Полный список клиентов берём из заказов (стабильный источник),
    // чтобы лейбл резолвился даже когда таблица начислений отфильтрована/пуста.
    for (const o of orders) {
      if (o.project?.client) map.set(o.project.client.id, o.project.client.name);
    }
    if (rows.some((r) => !r.order?.project?.client)) map.set("__empty__", "Пусто");
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "ru"))
      .map(([value, label]) => ({ value, label }));
  }, [orders, rows]);

  const projectOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orders) {
      if (o.project) map.set(o.project.id, o.project.name);
    }
    if (rows.some((r) => !r.order?.project)) map.set("__empty__", "Пусто");
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "ru"))
      .map(([value, label]) => ({ value, label }));
  }, [orders, rows]);

  const weekOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      const key = payWeekKey(r);
      if (key === "__empty__") continue;
      if (!map.has(key)) map.set(key, payWeekGroupLabel(r));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, label]) => ({ value, label }));
  }, [rows]);

  async function patchInlineStatus(id: string, status: string) {
    const res = await fetch(`/api/charges/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) return toast.error("Не удалось изменить статус");
    setRows(prev => prev.map(r => r.id === id ? { ...r, status } : r));
  }

  async function patchInlineDate(
    id: string,
    field: "issuedPlanAt" | "issuedAt" | "paidPlanAt" | "paidAt",
    value: string
  ) {
    const row = rows.find((r) => r.id === id);
    const prev = row?.[field] ? row[field]!.slice(0, 10) : "";
    if (prev === value) return;
    const iso = value ? new Date(value).toISOString() : null;
    setRows((prevRows) => prevRows.map((r) => (r.id === id ? { ...r, [field]: iso } : r)));
    try {
      const res = await fetch(`/api/charges/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: iso }),
      });
      if (!res.ok) {
        toast.error("Не удалось изменить дату");
        silentLoad();
        return;
      }
      const updated = await res.json() as Charge;
      setRows((prevRows) => prevRows.map((r) => (r.id === id ? updated : r)));
    } catch {
      toast.error("Не удалось изменить дату");
      silentLoad();
    }
  }

  async function patchInlinePurpose(id: string, paymentPurpose: string) {
    const res = await fetch(`/api/charges/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentPurpose: paymentPurpose || null }),
    });
    if (!res.ok) return toast.error("Не удалось изменить назначение");
    setRows(prev => prev.map(r => r.id === id ? { ...r, paymentPurpose: paymentPurpose || null } : r));
  }

  async function handleBulkApply() {
    if (!bulkStatus) return toast.error("Выберите статус");
    const ids = Array.from(selectedIds);
    const res = await fetch("/api/charges/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, patch: { status: bulkStatus } }),
    });
    if (!res.ok) return toast.error("Ошибка массового обновления");
    const { updated } = await res.json() as { updated: number };
    toast.success(`Обновлено ${updated} начислений`);
    setRows(prev => prev.map(r => selectedIds.has(r.id) ? { ...r, status: bulkStatus } : r));
    clearSelection();
    setBulkStatus("");
  }

  async function handleDelete(row: Charge) {
    setDeleteTarget(null);
    setRows(prev => prev.filter(r => r.id !== row.id));
    try {
      const res = await fetch(`/api/charges/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Начисление удалено");
    } catch {
      toast.error("Не удалось удалить");
      silentLoad();
    }
  }

  const onEditCb = useCallback((row: Charge) => setEditTarget(row), []);
  const onDeleteCb = useCallback((row: Charge) => setDeleteTarget(row), []);
  const onPatchStatusCb = useCallback((id: string, status: string) => patchInlineStatus(id, status), []);
  const onPatchDateCb = useCallback(
    (id: string, field: "issuedPlanAt" | "issuedAt" | "paidPlanAt" | "paidAt", value: string) =>
      patchInlineDate(id, field, value),
    []
  );
  const onPatchPurposeCb = useCallback((id: string, purpose: string) => patchInlinePurpose(id, purpose), []);

  const renderRow = React.useCallback(
    (index: number) => {
      if (flatItems) {
        const item = flatItems[index];
        if (!item) return null;
        if (item.kind === "group") {
          return (
            <GroupHeaderRow
              key={`g:${item.key}`}
              label={item.label}
              count={item.count}
              sum={item.sum}
              collapsed={item.collapsed}
              onToggle={() => toggleGroup(item.key)}
              colSpan={18}
              stickyFirstCell
            />
          );
        }
        const row = item.row;
        const rowIndex = rowIndexById.get(row.id) ?? 0;
        return (
          <ChargeTableRow
            key={row.id}
            row={row}
            rowIndex={rowIndex}
            checked={selectedIds.has(row.id)}
            onSelect={handleRowSelect}
            onEdit={onEditCb}
            onDelete={onDeleteCb}
            onPatchStatus={onPatchStatusCb}
            onPatchDate={onPatchDateCb}
            onPatchPurpose={onPatchPurposeCb}
          />
        );
      }
      const row = visible[index];
      if (!row) return null;
      return (
        <ChargeTableRow
          key={row.id}
          row={row}
          rowIndex={index}
          checked={selectedIds.has(row.id)}
          onSelect={handleRowSelect}
          onEdit={onEditCb}
          onDelete={onDeleteCb}
          onPatchStatus={onPatchStatusCb}
          onPatchDate={onPatchDateCb}
          onPatchPurpose={onPatchPurposeCb}
        />
      );
    },
    [
      flatItems,
      visible,
      rowIndexById,
      selectedIds,
      handleRowSelect,
      toggleGroup,
      onEditCb,
      onDeleteCb,
      onPatchStatusCb,
      onPatchDateCb,
      onPatchPurposeCb,
    ]
  );

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-3rem)] min-h-0">
      <PageHeader title="Начисления" />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Новое начисление
        </Button>

        <div className="ml-auto flex flex-wrap gap-2">
          <GroupBySelect
            value={groupBy}
            onChange={handleGroupByChange}
            options={[...CHARGE_GROUP_OPTIONS]}
          />
          <MultiSelectFilter
            label="Счёт получения"
            options={bankAccounts.map(b => ({ value: b.id, label: b.name }))}
            value={fBankAccount}
            onChange={setFBankAccount}
          />
          <MultiSelectFilter
            label="Клиент"
            options={clientOptions}
            value={fClient}
            onChange={setFClient}
          />
          <MultiSelectFilter
            label="Проект"
            options={projectOptions}
            value={fProject}
            onChange={setFProject}
          />
          <MultiSelectFilter
            label="Заказ"
            options={orders.map(o => ({ value: o.id, label: `№${o.orderNumber}${o.description ? ` ${o.description}` : ""}` }))}
            value={fOrder}
            onChange={setFOrder}
          />
          <MultiSelectFilter
            label="Статус"
            options={Object.entries(CHARGE_STATUSES).map(([v, s]) => ({ value: v, label: s.label }))}
            value={fStatus}
            onChange={setFStatus}
          />
          <MultiSelectFilter
            label="Неделя оплаты"
            options={weekOptions}
            value={fWeek}
            onChange={setFWeek}
          />
          <label className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-700 cursor-pointer select-none">
            <Checkbox checked={hidePaid} onCheckedChange={(v) => setHidePaid(v === true)} />
            Свернуть оплаченные
          </label>
        </div>
      </div>

      {/* Bulk toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-blue-50 border-blue-200 px-3 py-2">
          <span className="text-xs text-blue-700 font-medium tabular-nums">
            {chargeCountLabel(selectedIds.size)} на {formatMoneyRub(selectedSum)}
          </span>
          <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v ?? "")}>
            <SelectTrigger className="h-7 text-xs w-40 bg-white">
              <SelectValue>{bulkStatus ? (CHARGE_STATUSES[bulkStatus as keyof typeof CHARGE_STATUSES]?.label ?? bulkStatus) : "— статус —"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CHARGE_STATUSES).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-7" onClick={handleBulkApply} disabled={!bulkStatus}>
            Применить
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-neutral-500" onClick={() => clearSelection()}>
            Сбросить
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
      {loading ? (
        <div className="text-xs text-neutral-400 py-8 text-center">Загрузка...</div>
      ) : visible.length === 0 ? (
        <div className="text-xs text-neutral-400 py-8 text-center">Нет данных</div>
      ) : (
        <Table
          className={cn(compactTable, "w-full border-separate border-spacing-0")}
          style={{ minWidth: CHARGES_TABLE_MIN_WIDTH }}
          containerClassName="rounded-md border bg-white flex-1 min-h-0 min-w-0 overflow-auto"
          containerRef={scrollRef}
        >
            <colgroup>
              {CHARGES_COL_WIDTHS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className={cn(stickyCheckboxHead)} style={stickyColStyle(0, COL_CHECKBOX)}>
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={visible.length > 0 && selectedIds.size === visible.length}
                      onCheckedChange={() => toggleAll(orderedRowIds)}
                    />
                  </div>
                </TableHead>
                <TableHead className={cn(compactHead, stickyBankHead)} style={stickyColStyle(COL_CHECKBOX, COL_BANK)}>
                  Счёт получения
                </TableHead>
                <TableHead className={cn(compactHead, stickyAmountHead, "text-right")} style={stickyColStyle(COL_CHECKBOX + COL_BANK, COL_AMOUNT)}>
                  Сумма
                </TableHead>
                <SortableHead
                  field="status"
                  sortBy={sort?.field ?? ""}
                  sortDir={sort?.dir ?? "asc"}
                  onSort={handleSort}
                  className={compactHead}
                >
                  <span className="flex items-center gap-1">
                    Статус
                    <Pencil className="h-3 w-3 text-neutral-400" />
                  </span>
                </SortableHead>
                <TableHead className={compactHead}>Клиент</TableHead>
                <TableHead className={compactHead}>Проект</TableHead>
                <SortableHead
                  field="issuedPlanAt"
                  sortBy={sort?.field ?? ""}
                  sortDir={sort?.dir ?? "asc"}
                  onSort={handleSort}
                  className={compactHead}
                >
                  <span className="flex items-center gap-1">
                    Выст. план
                    <Pencil className="h-3 w-3 text-neutral-400" />
                  </span>
                </SortableHead>
                <SortableHead
                  field="issuedAt"
                  sortBy={sort?.field ?? ""}
                  sortDir={sort?.dir ?? "asc"}
                  onSort={handleSort}
                  className={compactHead}
                >
                  <span className="flex items-center gap-1">
                    Выст. факт
                    <Pencil className="h-3 w-3 text-neutral-400" />
                  </span>
                </SortableHead>
                <SortableHead
                  field="paidPlanAt"
                  sortBy={sort?.field ?? ""}
                  sortDir={sort?.dir ?? "asc"}
                  onSort={handleSort}
                  className={compactHead}
                >
                  <span className="flex items-center gap-1">
                    Опл. план
                    <Pencil className="h-3 w-3 text-neutral-400" />
                  </span>
                </SortableHead>
                <TableHead className={compactHead}>Месяц</TableHead>
                <SortableHead
                  field="week"
                  sortBy={sort?.field ?? ""}
                  sortDir={sort?.dir ?? "asc"}
                  onSort={handleSort}
                  className={compactHead}
                >
                  Неделя
                </SortableHead>
                <TableHead className={compactHead}>Год</TableHead>
                <SortableHead
                  field="paidAt"
                  sortBy={sort?.field ?? ""}
                  sortDir={sort?.dir ?? "asc"}
                  onSort={handleSort}
                  className={compactHead}
                >
                  <span className="flex items-center gap-1">
                    Опл. факт
                    <Pencil className="h-3 w-3 text-neutral-400" />
                  </span>
                </SortableHead>
                <TableHead className={compactHead}>
                  <span className="flex items-center gap-1">
                    Назначение
                    <Pencil className="h-3 w-3 text-neutral-400" />
                  </span>
                </TableHead>
                <TableHead className={compactHead}>Номер заказа</TableHead>
                <TableHead className={compactHead}>Номер начисления</TableHead>
                <TableHead className={compactHead}>Номер счёта</TableHead>
                <TableHead className={stickyActionsHead} />
              </TableRow>
            </TableHeader>
            <VirtualizedTableBody
              scrollRef={scrollRef}
              rowCount={flatItems ? flatItems.length : visible.length}
              colSpan={18}
              renderRow={renderRow}
            />
          </Table>
      )}
      </div>

      {createOpen && (
        <ChargeFormDialog bankAccounts={bankAccounts} orders={orders}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); silentLoad(); toast.success("Начисление создано"); }} />
      )}

      {editTarget && (
        <ChargeFormDialog bankAccounts={bankAccounts} orders={orders}
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            silentLoad();
            toast.success("Сохранено");
          }} />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить начисление {deleteTarget?.chargeNumber}?</AlertDialogTitle>
            <AlertDialogDescription>Это действие необратимо.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteTarget && handleDelete(deleteTarget)}>
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Форма создания / редактирования ─────────────────────────────────────────

function ChargeFormDialog({
  bankAccounts, orders, initial, onClose, onSaved,
}: {
  bankAccounts: BankAccount[];
  orders: Order[];
  initial?: Charge;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [bankAccountId, setBankAccountId] = useState(initial?.bankAccountId ?? "");
  const [orderId, setOrderId] = useState(initial?.orderId ?? "");
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : "");
  const [issuedPlanAt, setIssuedPlanAt] = useState(initial?.issuedPlanAt ? toLocalDateString(new Date(initial.issuedPlanAt)) : "");
  const [issuedAt, setIssuedAt] = useState(initial?.issuedAt ? toLocalDateString(new Date(initial.issuedAt)) : "");
  const [paidPlanAt, setPaidPlanAt] = useState(initial?.paidPlanAt ? toLocalDateString(new Date(initial.paidPlanAt)) : "");
  const [paidAt, setPaidAt] = useState(initial?.paidAt ? toLocalDateString(new Date(initial.paidAt)) : "");
  const [paymentPurpose, setPaymentPurpose] = useState(initial?.paymentPurpose ?? "");
  const [status, setStatus] = useState(initial?.status ?? "planned");
  const [saving, setSaving] = useState(false);

  const isEdit = !!initial;

  const paidAtChangedRef = useRef(false);

  // Авто-синхронизация статуса при изменении paidAt (не при открытии диалога)
  useEffect(() => {
    if (!paidAtChangedRef.current) { paidAtChangedRef.current = true; return; }
    if (!paidAt) {
      if (status === "paid") setStatus("to_pay");
    } else {
      setStatus("paid");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidAt]);

  async function handleSave() {
    if (!bankAccountId) {
      toast.error("Выберите счёт получения");
      return;
    }
    if (!orderId) {
      toast.error("Выберите заказ");
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Введите сумму");
      return;
    }
    if (isEdit && status === "paid" && !paidAt) {
      toast.error("Укажите дату оплаты факт для статуса «Оплачено»");
      return;
    }
    setSaving(true);
    try {
      const url = isEdit ? `/api/charges/${initial!.id}` : "/api/charges";
      const method = isEdit ? "PATCH" : "POST";
      const payload: Record<string, unknown> = {
        bankAccountId: bankAccountId || null,
        orderId: orderId || null,
        amount: amount ? parseFloat(amount) : null,
        issuedPlanAt: issuedPlanAt || null,
        paidPlanAt: paidPlanAt || null,
        paymentPurpose: paymentPurpose || null,
        status,
      };
      if (isEdit) {
        payload.issuedAt = issuedAt || null;
        payload.paidAt = paidAt || null;
      }
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? "Ошибка"); }
      const saved = await r.json();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  const selectedOrder = orders.find(o => o.id === orderId);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Редактировать ${initial!.chargeNumber}` : "Новое начисление"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 min-w-0">
            <Label>Счёт получения</Label>
            <Select value={bankAccountId} onValueChange={(v) => setBankAccountId(v ?? "")}>
              <SelectTrigger>
                <SelectValue>{bankAccounts.find(b => b.id === bankAccountId)?.name ?? "Выберите"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">—</SelectItem>
                {bankAccounts.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2 min-w-0">
            <Label>Заказ</Label>
            <Select value={orderId} onValueChange={(v) => setOrderId(v ?? "")}>
              <SelectTrigger>
                <SelectValue>
                  {selectedOrder ? <OrderSelectLabel order={selectedOrder} /> : "Выберите заказ"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">—</SelectItem>
                {orders.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    <OrderSelectLabel order={o} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label>Сумма</Label>
            <Input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label>Статус</Label>
            <Select value={status} onValueChange={(v) => setStatus(v ?? "planned")}>
              <SelectTrigger><SelectValue>{CHARGE_STATUSES[status as keyof typeof CHARGE_STATUSES]?.label ?? status}</SelectValue></SelectTrigger>
              <SelectContent>
                {Object.entries(CHARGE_STATUSES).map(([v, s]) => <SelectItem key={v} value={v}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label>Выставлен — план</Label>
            <Input type="date" className="h-8 text-xs" value={issuedPlanAt} onChange={(e) => setIssuedPlanAt(e.target.value)} />
          </div>
          {isEdit && (
            <div className="space-y-1.5 min-w-0">
              <Label>Выставлен — факт</Label>
              <Input type="date" className="h-8 text-xs" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5 min-w-0">
            <Label>Оплачен — план</Label>
            <Input type="date" className="h-8 text-xs" value={paidPlanAt} onChange={(e) => setPaidPlanAt(e.target.value)} />
          </div>
          {isEdit && (
            <div className="space-y-1.5 min-w-0">
              <Label>Оплачен — факт</Label>
              <Input type="date" className="h-8 text-xs" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5 col-span-2 min-w-0">
            <Label>Назначение платежа</Label>
            <Textarea
              value={paymentPurpose}
              onChange={(e) => setPaymentPurpose(e.target.value)}
              placeholder="Текст назначения..."
              rows={4}
              className="min-h-[100px] resize-y"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Сохранение..." : isEdit ? "Сохранить" : "Создать"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
