import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { toLocalDateString } from "@/lib/iso-weeks";

export type NamedWorkOption = { id: string; name: string };

export type PersonalWorkEditValues = {
  id: string;
  projectId: string;
  project: NamedWorkOption;
  workTypeId: string;
  workType: NamedWorkOption;
  executionYear: number;
  executionMonth: number;
  techTask: string | null;
  volume: number | null;
  rate: number | null;
  amount: number;
  plannedPayAt: string | null;
  paymentId: string | null;
  link: string | null;
  report: string | null;
  workStatus: string;
  responsibleExecutorId: string | null;
  responsibleExecutor: NamedWorkOption | null;
  comment: string | null;
};

export type PersonalWorkReviewPatch = Partial<Pick<PersonalWorkEditValues,
  "workStatus" | "responsibleExecutorId" | "comment"
>>;

export const WORK_STATUS_LABELS: Record<string, string> = {
  submitted: "Работа выставлена",
  checked: "Работа проверена",
  paid: "Работа оплачена",
  rework: "Нужно доработать",
};

/** «Оплачена» проставляется выплатой, не вручную. */
export const WORK_STATUS_SETTABLE = ["rework", "submitted", "checked"] as const;

export function canEditPersonalWork(status: string, isAdmin: boolean, isOwner: boolean) {
  return isAdmin || (isOwner && status !== "checked" && status !== "paid");
}

/** Парсит число с учётом русской запятой и пробелов-разрядов. */
export function parseDecimal(raw: string): number {
  return parseFloat(raw.replace(/[\s\u00A0]/g, "").replace(",", "."));
}

export function personalWorkFields(work: PersonalWorkEditValues) {
  const date = work.plannedPayAt;
  return {
    projectId: work.projectId,
    workTypeId: work.workTypeId,
    executionYear: work.executionYear,
    executionMonth: work.executionMonth,
    techTask: work.techTask ?? "",
    volume: String(work.volume ?? ""),
    rate: String(work.rate ?? ""),
    amount: String(work.amount),
    plannedPayAt: date && !/^\d{4}-\d{2}-\d{2}$/.test(date) ? toLocalDateString(new Date(date)) : date,
    link: work.link,
    report: work.report,
    workStatus: work.workStatus,
    responsibleExecutorId: work.responsibleExecutorId,
    comment: work.comment,
  };
}

type Fields = ReturnType<typeof personalWorkFields>;
export type PersonalWorkDraft = Partial<Fields>;

/** Only user edits become PATCH fields. A manual total is independent of volume × rate until either factor changes. */
export function editPersonalWorkField<K extends keyof Fields>(
  original: Fields, edits: PersonalWorkDraft, field: K, value: Fields[K], amountEditable: boolean,
): PersonalWorkDraft {
  const next = { ...edits };
  function set<F extends keyof Fields>(key: F, val: Fields[F]) {
    if (val === original[key]) delete next[key];
    else next[key] = val;
  }
  set(field, value);
  if (amountEditable && (field === "volume" || field === "rate")) {
    const product = parseDecimal(next.volume ?? original.volume) * parseDecimal(next.rate ?? original.rate);
    if (Number.isFinite(product)) set("amount", String(product));
  }
  return next;
}

export function personalWorkReviewPatch(edits: PersonalWorkDraft, allowStatus: boolean): PersonalWorkReviewPatch {
  const { workStatus, responsibleExecutorId, comment } = edits;
  return {
    ...(allowStatus && WORK_STATUS_SETTABLE.some((status) => status === workStatus) && { workStatus }),
    ...(responsibleExecutorId !== undefined && { responsibleExecutorId }),
    ...(comment !== undefined && { comment }),
  };
}

export function personalWorkSourcePatch(work: PersonalWorkEditValues, edits: PersonalWorkDraft, isAdmin: boolean) {
  const { amount, rate, volume, plannedPayAt, workStatus, ...rest } = edits;
  const patch: Partial<Pick<PersonalWorkEditValues, keyof Fields>> = {
    ...rest,
    ...personalWorkReviewPatch({ workStatus }, isAdmin && !work.paymentId),
  };
  if (!work.paymentId && plannedPayAt !== undefined) patch.plannedPayAt = plannedPayAt;
  for (const [key, raw] of [["volume", volume], ["rate", rate]] as const) {
    if (raw === undefined) continue;
    const n = raw === "" ? null : parseDecimal(raw);
    if (n !== null && !Number.isFinite(n)) throw new Error("Введите число в поле объёма или ставки");
    if (n !== work[key]) patch[key] = n;
  }
  if (amount !== undefined && work.workStatus !== "paid") {
    const n = parseDecimal(amount);
    if (!Number.isFinite(n) || n <= 0) throw new Error("Введите положительную сумму");
    if (n !== work.amount) patch.amount = n;
  }
  return patch;
}

export function MoneyInput({ id, value, onChange, placeholder, disabled, className }: {
  id?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean; className?: string;
}) {
  const [typing, setTyping] = useState(false);
  const numVal = parseDecimal(value);
  const display = !typing && value && Number.isFinite(numVal)
    ? numVal.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 20 })
    : value;
  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        setTyping(true);
        onChange(e.target.value.replace(/[\s\u00A0]/g, ""));
      }}
      // Reformatting on focus resets the selection and can append instead of replacing.
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => {
        setTyping(false);
        if (value.includes(",") && !isNaN(numVal)) onChange(String(numVal));
      }}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  );
}

export function DateInput({ id, value, onChange, className, disabled, onEmptyFocus }: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  disabled?: boolean;
  /** Предзаполнение при первом фокусе на пустом поле — вернуть YYYY-MM-DD */
  onEmptyFocus?: () => string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      className="relative w-full"
      onClick={() => {
        if (disabled) return;
        ref.current?.focus();
        try { ref.current?.showPicker(); } catch { /* not supported */ }
      }}
    >
      <input
        id={id}
        ref={ref}
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (disabled || value) return;
          const next = onEmptyFocus?.();
          if (next) onChange(next);
        }}
        className={`w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer ${className ?? ""}`}
      />
    </div>
  );
}
