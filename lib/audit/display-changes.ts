import { formatDate, formatMoney, monthFullLabel } from "@/lib/format";
import {
  WORK_STATUSES,
  PAYMENT_STATUSES,
  TASK_STATUSES,
  VACATION_STATUSES,
  ENTITY_STATUSES,
  CHARGE_STATUSES,
  EXECUTOR_TYPES,
  formatCompanyStatus,
  PROJECT_TYPES,
} from "@/lib/statuses";
import { formatRecipientTypes, parseRecipientTypes } from "@/lib/executor-recipient-type";

const FIELD_LABELS: Record<string, string> = {
  number: "Номер проекта",
  numberSerial: "Серийный № проекта",
  workStatus: "Статус работы",
  paymentStatus: "Статус платежа",
  paidAt: "Дата оплаты",
  plannedPayAt: "Плановая дата оплаты",
  checkedAt: "Дата проверки",
  issuedAt: "Дата выставления",
  issuedPlanAt: "Плановая дата выставления",
  paidPlanAt: "Плановая дата оплаты",
  accessRevokedAt: "Доступ отозван",
  amount: "Сумма",
  paymentAmount: "Сумма к оплате",
  value: "Значение",
  name: "Название",
  shortName: "Краткое название",
  fullName: "ФИО",
  email: "Email",
  description: "Описание",
  comment: "Комментарий",
  text: "Комментарий",
  highlight: "Подсветка",
  duplicateRows: "Дубли строк",
  status: "Статус",
  type: "Тип",
  projectId: "Проект",
  projectIds: "Проекты",
  clientId: "Клиент",
  executorId: "Исполнитель",
  workTypeId: "Вид работ",
  bankAccountId: "Банковский счёт",
  defaultBankAccountId: "Счёт по умолчанию",
  orderId: "Заказ",
  responsibleUserId: "Ответственный",
  companyStatus: "Статус в компании",
  specialty: "Специальность",
  specialties: "Специальности",
  contacts: "Контакт общее",
  contactEmail: "Контакт email",
  accessEmail: "Email для доступа",
  requisites: "Реквизиты",
  note: "Примечание",
  inTgChat: "В Telegram-чате",
  recipientType: "Тип получателя",
  contractFile: "Договор",
  ndaFile: "NDA",
  contractNumber: "Номер договора",
  executionMonth: "Месяц исполнения",
  executionYear: "Год исполнения",
  periodMonth: "Месяц периода",
  periodYear: "Год периода",
  preferredPayMethod: "Способ оплаты",
  isResponsible: "Ответственный по проектам",
  responsibleActive: "Статус ответственного",
  isDefault: "По умолчанию",
  currency: "Валюта",
  accountNumber: "Номер счёта",
  bik: "БИК",
  inn: "ИНН",
  kpp: "КПП",
  corrAccount: "Корр. счёт",
  department: "Отдел",
  company: "Компания",
  role: "Роль",
  segment: "Сегмент",
  oldEstimateUrl: "Ссылка на смету",
};

const STATUS_LABELS: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(WORK_STATUSES).map(([k, v]) => [k, v.label])
  ),
  ...Object.fromEntries(
    Object.entries(PAYMENT_STATUSES).map(([k, v]) => [k, v.label])
  ),
  ...Object.fromEntries(
    Object.entries(TASK_STATUSES).map(([k, v]) => [k, v.label])
  ),
  ...Object.fromEntries(
    Object.entries(VACATION_STATUSES).map(([k, v]) => [k, v.label])
  ),
  ...Object.fromEntries(
    Object.entries(ENTITY_STATUSES).map(([k, v]) => [k, v.label])
  ),
  ...Object.fromEntries(
    Object.entries(CHARGE_STATUSES).map(([k, v]) => [k, v.label])
  ),
};

const DATE_FIELDS = new Set([
  "paidAt",
  "plannedPayAt",
  "checkedAt",
  "issuedAt",
  "issuedPlanAt",
  "paidPlanAt",
  "accessRevokedAt",
]);

const MONEY_FIELDS = new Set(["amount", "paymentAmount", "value"]);

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  responsible: "Ответственный",
  executor: "Исполнитель",
};

export type DisplayChange = {
  field: string;
  fieldLabel: string;
  from: string;
  to: string;
};

export function formatFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function isIsoDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T|$)/.test(s);
}

export function formatChangeValue(value: unknown, field: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Да" : "Нет";

  if (typeof value === "number") {
    if (MONEY_FIELDS.has(field)) return formatMoney(value);
    if (field === "executionMonth" || field === "periodMonth") {
      return monthFullLabel(value);
    }
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (field === "projectIds") return `${value.length} шт.`;
    return value.map((v) => formatChangeValue(v, field)).join(", ");
  }

  const str = String(value);

  if (STATUS_LABELS[str]) return STATUS_LABELS[str];

  if (field === "role" && ROLE_LABELS[str]) return ROLE_LABELS[str];

  if (field === "type") {
    if (str in PROJECT_TYPES) {
      return PROJECT_TYPES[str as keyof typeof PROJECT_TYPES];
    }
    if (str === "external-person" || str === "external-legal") return EXECUTOR_TYPES.external;
    if (str in EXECUTOR_TYPES) {
      return EXECUTOR_TYPES[str as keyof typeof EXECUTOR_TYPES];
    }
  }

  if (field === "companyStatus") {
    return formatCompanyStatus(str);
  }

  if (field === "recipientType") {
    return formatRecipientTypes(parseRecipientTypes(str));
  }

  if (
    DATE_FIELDS.has(field) ||
    /At$/.test(field) ||
    isIsoDateString(str)
  ) {
    const d = new Date(str);
    if (!Number.isNaN(d.getTime())) return formatDate(d);
  }

  return str;
}

export function parseDisplayChanges(raw: string | null): DisplayChange[] {
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw) as Record<string, { from: unknown; to: unknown }>;
    return Object.entries(obj).map(([field, val]) => ({
      field,
      fieldLabel: formatFieldLabel(field),
      from: formatChangeValue(val?.from, field),
      to: formatChangeValue(val?.to, field),
    }));
  } catch {
    return [];
  }
}
