import { nearestPaymentDate, toLocalDateString } from "@/lib/iso-weeks";
import { hasOtherExpensePayment } from "@/lib/other-expense-payment";
import { WORK_STATUSES_SETTABLE, type WorkStatusSettable } from "@/lib/statuses";

export type ExpenseRef = { id: string; name: string };
export type OtherExpenseEditValues = {
  id: string;
  projectId: string; project: ExpenseRef;
  executorId: string; executor: ExpenseRef;
  workTypeId: string; workType: ExpenseRef;
  responsibleExecutorId: string | null; responsibleExecutor: ExpenseRef | null;
  bankAccountId: string | null; bankAccount: ExpenseRef | null;
  executionYear: number;
  executionMonth: number;
  description: string;
  amount: number;
  paymentAmount: number | null;
  preferredPayMethod: string | null;
  plannedPayAt: string | null;
  workStatus: string;
  paymentStatus: string | null;
  comment: string | null;
};

export type ExpenseMode = "source" | "review" | "view";
export type ReviewPatch = Partial<Pick<OtherExpenseEditValues, "workStatus" | "responsibleExecutorId" | "comment">>;

export function expenseDraft(initial?: OtherExpenseEditValues, now = new Date()) {
  return {
    projectId: initial?.projectId ?? "",
    executorId: initial?.executorId ?? "",
    workTypeId: initial?.workTypeId ?? "",
    responsibleExecutorId: initial?.responsibleExecutorId ?? "",
    bankAccountId: initial?.bankAccountId ?? "",
    executionYear: String(initial?.executionYear ?? now.getFullYear()),
    executionMonth: String(initial?.executionMonth ?? now.getMonth() + 1),
    description: initial?.description ?? "",
    amount: initial ? String(initial.amount) : "",
    // Before a payout exists the native editor previews the work amount; no payout is written by this preview.
    paymentAmount: initial?.paymentAmount != null ? String(initial.paymentAmount)
      : initial && !hasOtherExpensePayment(initial.paymentStatus) ? String(initial.amount) : "",
    preferredPayMethod: initial?.preferredPayMethod ?? "",
    plannedPayAt: initial ? initial.plannedPayAt?.slice(0, 10) ?? "" : toLocalDateString(nearestPaymentDate(now)),
    workStatus: initial?.workStatus ?? "submitted",
    paymentStatus: initial?.paymentStatus ?? "",
    comment: initial?.comment ?? "",
  };
}
export type ExpenseDraft = ReturnType<typeof expenseDraft>;

export function responsibleLocked(initial?: OtherExpenseEditValues) {
  return initial?.workStatus === "checked" || initial?.workStatus === "paid";
}

export function plannedDateEditable(initial?: OtherExpenseEditValues) {
  return !initial || initial.workStatus === "submitted" || initial.workStatus === "checked";
}

export function statusOptions(
  mode: ExpenseMode, initial?: OtherExpenseEditValues, canRework = false,
): readonly WorkStatusSettable[] {
  if (!initial || mode === "view") return [];
  if (hasOtherExpensePayment(initial.paymentStatus)) {
    // Only a source editor can roll back a check and delete its planned payout together.
    return mode === "source" && canRework && initial.workStatus === "checked" && initial.paymentStatus === "planned"
      ? WORK_STATUSES_SETTABLE : [];
  }
  if (mode === "review") return initial.workStatus === "paid" ? [] : WORK_STATUSES_SETTABLE;
  return canRework ? ["submitted", "rework"] : ["submitted"];
}

export function reviewPatch(initial: OtherExpenseEditValues, changes: Partial<ExpenseDraft>): ReviewPatch {
  const patch: ReviewPatch = {};
  if (changes.comment !== undefined && changes.comment !== (initial.comment ?? "")) {
    patch.comment = changes.comment || null;
  }
  if (!responsibleLocked(initial) && changes.responsibleExecutorId !== undefined &&
      changes.responsibleExecutorId !== (initial.responsibleExecutorId ?? "")) {
    patch.responsibleExecutorId = changes.responsibleExecutorId || null;
  }
  if (changes.workStatus !== undefined && changes.workStatus !== initial.workStatus &&
      statusOptions("review", initial).some((s) => s === changes.workStatus)) {
    patch.workStatus = changes.workStatus;
  }
  return patch;
}

const REQUIRED = "Заполните обязательные поля";
export const AMOUNTS_UNEQUAL = "Сумма работы и сумма выплаты не равны";
const AMOUNTS_POSITIVE = "Сумма работы и сумма выплаты должны быть положительными";

export function amountError(draft: ExpenseDraft, initial?: OtherExpenseEditValues) {
  const amount = Number(draft.amount);
  const payment = Number(draft.paymentAmount);
  // Keep a historical null on unrelated edits; never introduce an empty/unequal payout.
  const unchangedAbsentPayment = initial?.paymentAmount === null && amount === initial.amount && draft.paymentAmount === "";
  if (!draft.amount || (!draft.paymentAmount && !unchangedAbsentPayment)) return REQUIRED;
  if (!Number.isFinite(amount) || amount <= 0) return AMOUNTS_POSITIVE;
  if (unchangedAbsentPayment) return null;
  if (!Number.isFinite(payment) || payment <= 0) return AMOUNTS_POSITIVE;
  return amount !== payment ? AMOUNTS_UNEQUAL : null;
}

type SourceFields = Pick<OtherExpenseEditValues, keyof ExpenseDraft>;
export function sourceBody(draft: ExpenseDraft, initial: OtherExpenseEditValues | undefined, isAdmin: boolean, canRework: boolean) {
  if (!draft.projectId || !draft.executorId || !draft.workTypeId || !draft.responsibleExecutorId || !draft.description) {
    throw new Error(REQUIRED);
  }
  const error = amountError(draft, initial);
  if (error) throw new Error(error);

  const body: Partial<SourceFields> = {};
  function put<K extends keyof SourceFields>(key: K, value: SourceFields[K]) {
    if (!initial || value !== initial[key]) body[key] = value;
  }
  put("projectId", draft.projectId);
  put("executorId", draft.executorId);
  put("workTypeId", draft.workTypeId);
  put("executionYear", Number(draft.executionYear));
  put("executionMonth", Number(draft.executionMonth));
  put("description", draft.description);
  put("amount", Number(draft.amount));
  put("preferredPayMethod", draft.preferredPayMethod || null);
  put("comment", draft.comment || null);
  if (!responsibleLocked(initial)) put("responsibleExecutorId", draft.responsibleExecutorId);
  if (initial) put("bankAccountId", draft.bankAccountId || null);
  // Do not round an existing timestamp to the displayed calendar day on unrelated edits.
  if (plannedDateEditable(initial) && (!initial || draft.plannedPayAt !== (initial.plannedPayAt?.slice(0, 10) ?? ""))) {
    put("plannedPayAt", draft.plannedPayAt || null);
  }

  const paymentCreated = hasOtherExpensePayment(initial?.paymentStatus);
  if (initial && draft.workStatus !== initial.workStatus && statusOptions("source", initial, canRework).some((s) => s === draft.workStatus)) {
    put("workStatus", draft.workStatus);
    if (paymentCreated) {
      body.paymentStatus = null;
      return body;
    }
  }
  if ((!initial || paymentCreated) && draft.paymentAmount !== "") put("paymentAmount", Number(draft.paymentAmount));
  if (isAdmin && initial?.paymentStatus === "paid" && draft.paymentStatus === "planned") put("paymentStatus", "planned");
  return body;
}

/** An archived / no longer linked value is displayable, but is not a new assignment option. */
export function referenceOptions(catalog: ExpenseRef[], value: string, saved?: ExpenseRef | null) {
  const options = catalog.map((ref) => ({ value: ref.id, label: ref.name, disabled: false }));
  if (saved && value === saved.id && !options.some((option) => option.value === value)) {
    options.push({ value, label: saved.name, disabled: true });
  }
  return options;
}

export async function fetchWorkTypeIds(executorId: string, signal: AbortSignal): Promise<Set<string>> {
  const response = await fetch(`/api/executors/${encodeURIComponent(executorId)}/work-type-ids`, { signal });
  if (!response.ok) throw new Error(`Ошибка сервера (${response.status})`);
  const ids: unknown = await response.json();
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) throw new Error("Некорректный список видов работ");
  return new Set(ids);
}

export async function readApiJson<T>(r: Response): Promise<T> {
  const text = await r.text();
  if (!text.trim()) {
    if (!r.ok) throw new Error(`Ошибка сервера (${r.status})`);
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(r.ok ? "Некорректный ответ сервера" : `Ошибка сервера (${r.status})`);
  }
}
