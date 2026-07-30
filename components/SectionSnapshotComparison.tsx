"use client";

import * as React from "react";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { cn } from "@/lib/utils";
import { formatDate, formatDateShort, formatDateTime, formatMoney, monthLabel, weekLabel } from "@/lib/format";
import { getISOWeek } from "@/lib/iso-weeks";
import {
  WORK_STATUSES,
  PAYMENT_STATUSES,
  ENTITY_STATUSES,
  CHARGE_STATUSES,
  TASK_STATUSES,
  EXECUTOR_TYPES,
  PROJECT_TYPES,
  ACTIVITY_ACTIONS,
} from "@/lib/statuses";
import { modelLabel } from "@/lib/snapshots/field-labels";

export type DiffRow = {
  key: string;
  status: "added" | "removed" | "modified" | "unchanged";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changes: Array<{ field: string; before: unknown; after: unknown }>;
};

export type RefMaps = Partial<
  Record<"executor" | "project" | "workType" | "bankAccount" | "client" | "user" | "order", Map<string, string>>
> & {
  personalSmetaIds?: Set<string>;
  /** orderId → projectId */
  orderProject?: Map<string, string>;
  /** projectId → clientId */
  projectClient?: Map<string, string>;
};

type CellCtx = {
  record: Record<string, unknown>;
  model: string;
  refs: RefMaps;
};

type CompareColumn = {
  key: string;
  label: React.ReactNode;
  align?: "left" | "right";
  /** Поля snapshot, изменение которых подсвечивает ячейку */
  fields?: string[];
  render: (ctx: CellCtx) => React.ReactNode;
};

type SectionConfig = {
  /** Модели-строки таблицы (остальные — только для резолва имён) */
  rowModels: string[];
  preferredModel?: string;
  columns: CompareColumn[];
};

const COMPARE_ROW_LIMIT = 200;

function str(v: unknown): string {
  if (v == null || v === "") return "";
  return String(v);
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dateVal(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

function payWeekFromRecord(record: Record<string, unknown>): number | null {
  const d = dateVal(record.paidAt) ?? dateVal(record.plannedPayAt);
  if (!d) return null;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return null;
  return getISOWeek(parsed);
}

function refName(
  refs: RefMaps,
  kind: "executor" | "project" | "workType" | "bankAccount" | "client" | "user" | "order",
  id: unknown
): string {
  if (id == null || id === "") return "—";
  return refs[kind]?.get(String(id)) ?? "—";
}

function executorCell(ctx: CellCtx, idField = "executorId") {
  const id = str(ctx.record[idField]);
  const name = refName(ctx.refs, "executor", id);
  if (!id || name === "—") return "—";
  if (ctx.refs.personalSmetaIds?.has(id)) {
    return (
      <Link href={`/admin/executors/${id}`} className="text-blue-600 hover:underline">
        {name}
      </Link>
    );
  }
  return name;
}

function projectCell(ctx: CellCtx) {
  const id = str(ctx.record.projectId);
  const name = refName(ctx.refs, "project", id);
  if (!id || name === "—") return "—";
  return (
    <Link href={`/admin/projects/${id}`} className="text-blue-600 hover:underline">
      {name}
    </Link>
  );
}

/** Проект начисления через заказ */
function chargeProjectCell(ctx: CellCtx) {
  const orderId = str(ctx.record.orderId);
  const projectId = orderId ? ctx.refs.orderProject?.get(orderId) : "";
  if (!projectId) return "—";
  const name = refName(ctx.refs, "project", projectId);
  if (name === "—") return "—";
  return (
    <Link href={`/admin/projects/${projectId}`} className="text-blue-600 hover:underline">
      {name}
    </Link>
  );
}

function chargeClientCell(ctx: CellCtx) {
  const orderId = str(ctx.record.orderId);
  const projectId = orderId ? ctx.refs.orderProject?.get(orderId) : "";
  const clientId = projectId ? ctx.refs.projectClient?.get(projectId) : "";
  return refName(ctx.refs, "client", clientId);
}

function orderCell(ctx: CellCtx) {
  const id = str(ctx.record.orderId);
  if (!id) return "—";
  const number = ctx.refs.order?.get(id);
  return number ? `№${number}` : "—";
}

function moneyCell(v: unknown) {
  const n = num(v);
  return n == null ? "—" : formatMoney(n);
}

function statusBadge(dict: Record<string, { label: string; tone: string }>, value: unknown) {
  const v = str(value);
  if (!v) return "—";
  return <StatusBadge dict={dict as never} value={v} />;
}

const ISSUED_WORK_COLUMNS: CompareColumn[] = [
  {
    key: "number",
    label: "Номер",
    fields: ["issuedWorkNumber", "issuedWorkNumberYear", "issuedWorkNumberSerial"],
    render: ({ record }) => str(record.issuedWorkNumber) || "—",
  },
  {
    key: "executionYear",
    label: (
      <span className="block text-left">
        Год
        <br />
        выполнения
      </span>
    ),
    fields: ["executionYear"],
    render: ({ record }) => str(record.executionYear) || "—",
  },
  {
    key: "executionMonth",
    label: (
      <span className="block text-left">
        Месяц
        <br />
        выполнения
      </span>
    ),
    fields: ["executionMonth"],
    render: ({ record }) => {
      const m = num(record.executionMonth);
      return m ? monthLabel(m) : "—";
    },
  },
  {
    key: "week",
    label: (
      <span className="block text-left">
        Неделя
        <br />
        оплаты
      </span>
    ),
    fields: ["plannedPayAt", "paidAt"],
    render: ({ record }) => {
      const w = payWeekFromRecord(record);
      return w != null ? weekLabel(w) : "—";
    },
  },
  {
    key: "executor",
    label: "Исполнитель",
    fields: ["executorId"],
    render: (ctx) => executorCell(ctx),
  },
  {
    key: "responsible",
    label: "Ответственный",
    fields: ["responsibleExecutorId"],
    render: (ctx) => refName(ctx.refs, "executor", ctx.record.responsibleExecutorId),
  },
  {
    key: "project",
    label: "Проект",
    fields: ["projectId"],
    render: (ctx) => projectCell(ctx),
  },
  {
    key: "workType",
    label: "Вид работ",
    fields: ["workTypeId"],
    render: (ctx) => refName(ctx.refs, "workType", ctx.record.workTypeId),
  },
  {
    key: "amount",
    label: "Сумма",
    align: "right",
    fields: ["amount"],
    render: ({ record }) => moneyCell(record.amount),
  },
  {
    key: "workStatus",
    label: "Статус",
    fields: ["workStatus"],
    render: ({ record }) => statusBadge(WORK_STATUSES, record.workStatus),
  },
  {
    key: "checkedAt",
    label: "Дата проверки",
    fields: ["checkedAt"],
    render: ({ record }) => formatDateShort(dateVal(record.checkedAt)),
  },
  {
    key: "plannedPayAt",
    label: "Дата оплаты план",
    fields: ["plannedPayAt"],
    render: ({ record }) => formatDateShort(dateVal(record.plannedPayAt)),
  },
  {
    key: "paidAt",
    label: "Дата оплаты факт",
    fields: ["paidAt"],
    render: ({ record }) => formatDateShort(dateVal(record.paidAt)),
  },
  {
    key: "smeta",
    label: "Тип сметы",
    fields: [],
    render: ({ model }) => (model === "OtherExpense" ? "Прочие траты" : "Личная смета"),
  },
];

const EXECUTOR_COLUMNS: CompareColumn[] = [
  {
    key: "name",
    label: "Исполнитель",
    fields: ["name"],
    render: ({ record, refs }) => {
      const id = str(record.id);
      const name = str(record.name) || "—";
      if (id && refs.personalSmetaIds?.has(id)) {
        return (
          <Link href={`/admin/executors/${id}`} className="text-blue-600 hover:underline">
            {name}
          </Link>
        );
      }
      return name;
    },
  },
  {
    key: "companyStatus",
    label: "Статус в компании",
    fields: ["companyStatus"],
    render: ({ record }) => str(record.companyStatus) || "—",
  },
  {
    key: "type",
    label: "Тип",
    fields: ["type"],
    render: ({ record }) =>
      EXECUTOR_TYPES[str(record.type) as keyof typeof EXECUTOR_TYPES] || str(record.type) || "—",
  },
  {
    key: "specialty",
    label: "Специальность",
    fields: ["specialty"],
    render: ({ record }) => str(record.specialty) || "—",
  },
  {
    key: "responsible",
    label: "Ответственный",
    fields: ["responsibleUserId"],
    render: (ctx) => refName(ctx.refs, "user", ctx.record.responsibleUserId),
  },
  {
    key: "bank",
    label: "Источник оплаты",
    fields: ["defaultBankAccountId"],
    render: (ctx) => refName(ctx.refs, "bankAccount", ctx.record.defaultBankAccountId),
  },
  {
    key: "inTgChat",
    label: "В чате ТГ",
    fields: ["inTgChat"],
    render: ({ record }) => (record.inTgChat ? "Да" : "Нет"),
  },
  {
    key: "status",
    label: "Статус",
    fields: ["status"],
    render: ({ record }) => statusBadge(ENTITY_STATUSES, record.status),
  },
  {
    key: "accessEmail",
    label: "Email для доступа",
    fields: ["accessEmail"],
    render: ({ record }) => str(record.accessEmail) || "—",
  },
];

const PROJECT_COLUMNS: CompareColumn[] = [
  {
    key: "name",
    label: "Проект",
    fields: ["name", "shortName"],
    render: ({ record }) => {
      const id = str(record.id);
      const name = str(record.name) || str(record.shortName) || "—";
      if (!id || name === "—") return name;
      return (
        <Link href={`/admin/projects/${id}`} className="text-blue-600 hover:underline">
          {name}
        </Link>
      );
    },
  },
  {
    key: "client",
    label: "Клиент",
    fields: ["clientId"],
    render: (ctx) => refName(ctx.refs, "client", ctx.record.clientId),
  },
  {
    key: "responsible",
    label: "Руководитель",
    fields: ["responsibleUserId"],
    render: (ctx) => refName(ctx.refs, "user", ctx.record.responsibleUserId),
  },
  {
    key: "type",
    label: "Тип",
    fields: ["type"],
    render: ({ record }) =>
      PROJECT_TYPES[str(record.type) as keyof typeof PROJECT_TYPES] || str(record.type) || "—",
  },
  {
    key: "status",
    label: "Статус",
    fields: ["status"],
    render: ({ record }) => statusBadge(ENTITY_STATUSES, record.status),
  },
  {
    key: "cashflowInitial",
    label: "Старт. баланс",
    align: "right",
    fields: ["cashflowInitial"],
    render: ({ record }) => moneyCell(record.cashflowInitial),
  },
];

const PAYOUT_COLUMNS: CompareColumn[] = [
  {
    key: "number",
    label: "Номер",
    fields: ["payoutNumber"],
    render: ({ record }) => str(record.payoutNumber) || "—",
  },
  {
    key: "periodYear",
    label: "Год",
    fields: ["periodYear"],
    render: ({ record }) => str(record.periodYear) || "—",
  },
  {
    key: "periodMonth",
    label: "Месяц",
    fields: ["periodMonth"],
    render: ({ record }) => {
      const m = num(record.periodMonth);
      return m ? monthLabel(m) : "—";
    },
  },
  {
    key: "executor",
    label: "Исполнитель",
    fields: ["executorId"],
    render: (ctx) => executorCell(ctx),
  },
  {
    key: "paymentStatus",
    label: "Статус",
    fields: ["paymentStatus"],
    render: ({ record }) => statusBadge(PAYMENT_STATUSES, record.paymentStatus),
  },
  {
    key: "amount",
    label: "Выплата",
    align: "right",
    fields: ["amount"],
    render: ({ record }) => moneyCell(record.amount),
  },
  {
    key: "plannedPayAt",
    label: "Дата оплаты план",
    fields: ["plannedPayAt"],
    render: ({ record }) => formatDateShort(dateVal(record.plannedPayAt)),
  },
  {
    key: "paidAt",
    label: "Дата оплаты факт",
    fields: ["paidAt"],
    render: ({ record }) => formatDateShort(dateVal(record.paidAt)),
  },
  {
    key: "bank",
    label: "Источник оплаты",
    fields: ["bankAccountId"],
    render: (ctx) => refName(ctx.refs, "bankAccount", ctx.record.bankAccountId),
  },
];

const OTHER_EXPENSE_COLUMNS: CompareColumn[] = [
  {
    key: "number",
    label: "Номер",
    fields: ["issuedWorkNumber"],
    render: ({ record }) => str(record.issuedWorkNumber) || "—",
  },
  {
    key: "executionYear",
    label: "Год выполнения",
    fields: ["executionYear"],
    render: ({ record }) => str(record.executionYear) || "—",
  },
  {
    key: "executionMonth",
    label: "Месяц",
    fields: ["executionMonth"],
    render: ({ record }) => {
      const m = num(record.executionMonth);
      return m ? monthLabel(m) : "—";
    },
  },
  {
    key: "week",
    label: "Неделя оплаты",
    fields: ["plannedPayAt", "paidAt"],
    render: ({ record }) => {
      const w = payWeekFromRecord(record);
      return w != null ? weekLabel(w) : "—";
    },
  },
  {
    key: "project",
    label: "Проект",
    fields: ["projectId"],
    render: (ctx) => projectCell(ctx),
  },
  {
    key: "executor",
    label: "Исполнитель",
    fields: ["executorId"],
    render: (ctx) => executorCell(ctx),
  },
  {
    key: "workType",
    label: "Вид работ",
    fields: ["workTypeId"],
    render: (ctx) => refName(ctx.refs, "workType", ctx.record.workTypeId),
  },
  {
    key: "amount",
    label: "Сумма",
    align: "right",
    fields: ["amount"],
    render: ({ record }) => moneyCell(record.amount),
  },
  {
    key: "workStatus",
    label: "Статус работы",
    fields: ["workStatus"],
    render: ({ record }) => statusBadge(WORK_STATUSES, record.workStatus),
  },
  {
    key: "paymentStatus",
    label: "Статус выплаты",
    fields: ["paymentStatus"],
    render: ({ record }) => statusBadge(PAYMENT_STATUSES, record.paymentStatus),
  },
  {
    key: "plannedPayAt",
    label: "Дата оплаты план",
    fields: ["plannedPayAt"],
    render: ({ record }) => formatDateShort(dateVal(record.plannedPayAt)),
  },
  {
    key: "paidAt",
    label: "Дата оплаты факт",
    fields: ["paidAt"],
    render: ({ record }) => formatDateShort(dateVal(record.paidAt)),
  },
  {
    key: "bank",
    label: "Источник",
    fields: ["bankAccountId"],
    render: (ctx) => refName(ctx.refs, "bankAccount", ctx.record.bankAccountId),
  },
];

const CHARGE_COLUMNS: CompareColumn[] = [
  {
    key: "bank",
    label: "Р/с",
    fields: ["bankAccountId"],
    render: (ctx) => refName(ctx.refs, "bankAccount", ctx.record.bankAccountId),
  },
  {
    key: "amount",
    label: "Сумма",
    align: "right",
    fields: ["amount"],
    render: ({ record }) => moneyCell(record.amount),
  },
  {
    key: "status",
    label: "Статус",
    fields: ["status"],
    render: ({ record }) => statusBadge(CHARGE_STATUSES, record.status),
  },
  {
    key: "client",
    label: "Клиент",
    fields: ["orderId"],
    render: (ctx) => chargeClientCell(ctx),
  },
  {
    key: "project",
    label: "Проект",
    fields: ["orderId"],
    render: (ctx) => chargeProjectCell(ctx),
  },
  {
    key: "order",
    label: "Номер заказа",
    fields: ["orderId"],
    render: (ctx) => orderCell(ctx),
  },
  {
    key: "chargeNumber",
    label: "Номер начисления",
    fields: ["chargeNumber"],
    render: ({ record }) => str(record.chargeNumber) || "—",
  },
  {
    key: "invoiceNumber",
    label: "Номер счёта",
    fields: ["invoiceNumber"],
    render: ({ record }) => str(record.invoiceNumber) || "—",
  },
  {
    key: "paidPlanAt",
    label: "Дата план",
    fields: ["paidPlanAt"],
    render: ({ record }) => formatDateShort(dateVal(record.paidPlanAt)),
  },
  {
    key: "paidAt",
    label: "Дата факт",
    fields: ["paidAt"],
    render: ({ record }) => formatDateShort(dateVal(record.paidAt)),
  },
];

const ORDER_COLUMNS: CompareColumn[] = [
  {
    key: "orderNumber",
    label: "Номер",
    fields: ["orderNumber"],
    render: ({ record }) => {
      const n = str(record.orderNumber);
      return n ? `№${n}` : "—";
    },
  },
  {
    key: "client",
    label: "Клиент",
    fields: ["projectId"],
    render: (ctx) => {
      const projectId = str(ctx.record.projectId);
      const clientId = projectId ? ctx.refs.projectClient?.get(projectId) : "";
      return refName(ctx.refs, "client", clientId);
    },
  },
  {
    key: "project",
    label: "Проект",
    fields: ["projectId"],
    render: (ctx) => projectCell(ctx),
  },
  {
    key: "description",
    label: "Описание",
    fields: ["description"],
    render: ({ record }) => str(record.description) || "—",
  },
  {
    key: "status",
    label: "Статус",
    fields: ["status"],
    render: ({ record }) => statusBadge(ENTITY_STATUSES, record.status),
  },
  {
    key: "contract",
    label: "Договор / ДС",
    fields: ["contractNumber"],
    render: ({ record }) => str(record.contractNumber) || "—",
  },
];

const CLIENT_COLUMNS: CompareColumn[] = [
  {
    key: "name",
    label: "Клиент",
    fields: ["name"],
    render: ({ record }) => str(record.name) || "—",
  },
  {
    key: "company",
    label: "Компания",
    fields: ["company"],
    render: ({ record }) => str(record.company) || "—",
  },
  {
    key: "status",
    label: "Статус",
    fields: ["status"],
    render: ({ record }) => statusBadge(ENTITY_STATUSES, record.status),
  },
  {
    key: "createdAt",
    label: "Создан",
    fields: ["createdAt"],
    render: ({ record }) => formatDate(dateVal(record.createdAt)),
  },
];

const WORK_TYPE_COLUMNS: CompareColumn[] = [
  {
    key: "name",
    label: "Вид работ",
    fields: ["name"],
    render: ({ record }) => str(record.name) || "—",
  },
  {
    key: "segment",
    label: "Сегмент",
    fields: ["segment"],
    render: ({ record }) => str(record.segment) || "—",
  },
  {
    key: "status",
    label: "Статус",
    fields: ["status"],
    render: ({ record }) => statusBadge(ENTITY_STATUSES, record.status),
  },
];

const BANK_ACCOUNT_COLUMNS: CompareColumn[] = [
  {
    key: "name",
    label: "Счёт",
    fields: ["name"],
    render: ({ record }) => str(record.name) || "—",
  },
  {
    key: "currency",
    label: "Валюта",
    fields: ["currency"],
    render: ({ record }) => str(record.currency) || "—",
  },
  {
    key: "status",
    label: "Статус",
    fields: ["status"],
    render: ({ record }) => statusBadge(ENTITY_STATUSES, record.status),
  },
];

const TASK_COLUMNS: CompareColumn[] = [
  {
    key: "executor",
    label: "Исполнитель",
    fields: ["executorId"],
    render: (ctx) => executorCell(ctx),
  },
  {
    key: "title",
    label: "Задача",
    fields: ["title"],
    render: ({ record }) => str(record.title) || "—",
  },
  {
    key: "status",
    label: "Статус",
    fields: ["status"],
    render: ({ record }) => statusBadge(TASK_STATUSES, record.status),
  },
  {
    key: "plannedDoneAt",
    label: "План",
    fields: ["plannedDoneAt"],
    render: ({ record }) => formatDateShort(dateVal(record.plannedDoneAt)),
  },
  {
    key: "result",
    label: "Результат",
    fields: ["result"],
    render: ({ record }) => str(record.result) || "—",
  },
  {
    key: "comment",
    label: "Комментарий",
    fields: ["comment"],
    render: ({ record }) => str(record.comment) || "—",
  },
];

const RESPONSIBLE_COLUMNS: CompareColumn[] = [
  {
    key: "fullName",
    label: "ФИО",
    fields: ["fullName"],
    render: ({ record }) => str(record.fullName) || "—",
  },
  {
    key: "isActive",
    label: "Статус",
    fields: ["isActive"],
    render: ({ record }) => (record.isActive ? "Активен" : "Неактивен"),
  },
  {
    key: "email",
    label: "Email",
    fields: ["email"],
    render: ({ record }) => str(record.email) || "—",
  },
];

const ACTIVITY_COLUMNS: CompareColumn[] = [
  {
    key: "createdAt",
    label: "Когда",
    fields: ["createdAt"],
    render: ({ record }) => formatDateTime(dateVal(record.createdAt)),
  },
  {
    key: "user",
    label: "Кто",
    fields: ["userId"],
    render: (ctx) => refName(ctx.refs, "user", ctx.record.userId),
  },
  {
    key: "action",
    label: "Действие",
    fields: ["action"],
    render: ({ record }) => ACTIVITY_ACTIONS[str(record.action)] || str(record.action) || "—",
  },
  {
    key: "entityType",
    label: "Сущность",
    fields: ["entityType"],
    render: ({ record }) => str(record.entityType) || "—",
  },
  {
    key: "entityLabel",
    label: "Объект",
    fields: ["entityLabel"],
    render: ({ record }) => str(record.entityLabel) || "—",
  },
];

export const SECTION_COMPARE_CONFIG: Record<string, SectionConfig> = {
  "issued-works": {
    rowModels: ["Work", "OtherExpense"],
    preferredModel: "Work",
    columns: ISSUED_WORK_COLUMNS,
  },
  executors: { rowModels: ["Executor"], columns: EXECUTOR_COLUMNS },
  projects: { rowModels: ["Project"], columns: PROJECT_COLUMNS },
  payouts: { rowModels: ["Payment"], columns: PAYOUT_COLUMNS },
  "other-expenses": { rowModels: ["OtherExpense"], columns: OTHER_EXPENSE_COLUMNS },
  charges: { rowModels: ["Charge"], columns: CHARGE_COLUMNS },
  orders: { rowModels: ["Order"], columns: ORDER_COLUMNS },
  clients: { rowModels: ["Client"], columns: CLIENT_COLUMNS },
  "work-types": { rowModels: ["WorkType"], columns: WORK_TYPE_COLUMNS },
  "bank-accounts": { rowModels: ["BankAccount"], columns: BANK_ACCOUNT_COLUMNS },
  tasks: { rowModels: ["Task"], columns: TASK_COLUMNS },
  responsibles: { rowModels: ["User"], columns: RESPONSIBLE_COLUMNS },
  activity: { rowModels: ["ActivityLog"], columns: ACTIVITY_COLUMNS },
};

function mergeRefMap(
  target: Map<string, string>,
  rows: Array<{ id?: unknown; name?: unknown; fullName?: unknown; firstName?: unknown; lastName?: unknown }>
) {
  for (const row of rows) {
    if (row?.id == null) continue;
    const id = String(row.id);
    if (target.has(id)) continue;
    const fullName = row.fullName != null ? String(row.fullName).trim() : "";
    const name = row.name != null ? String(row.name).trim() : "";
    const composed = [row.lastName, row.firstName].filter(Boolean).map(String).join(" ").trim();
    const label = fullName || name || composed;
    if (label) target.set(id, label);
  }
}

function mapsFromDiff(diff: Record<string, DiffRow[]>): RefMaps {
  const pick = (model: string) =>
    (diff[model] ?? []).flatMap((row) => [row.before, row.after]).filter(Boolean) as Array<
      Record<string, unknown>
    >;
  const executor = new Map<string, string>();
  const project = new Map<string, string>();
  const workType = new Map<string, string>();
  const bankAccount = new Map<string, string>();
  const client = new Map<string, string>();
  const user = new Map<string, string>();
  const order = new Map<string, string>();
  const orderProject = new Map<string, string>();
  const projectClient = new Map<string, string>();
  const personalSmetaIds = new Set<string>();
  mergeRefMap(executor, pick("Executor") as never);
  mergeRefMap(project, pick("Project") as never);
  mergeRefMap(workType, pick("WorkType") as never);
  mergeRefMap(bankAccount, pick("BankAccount") as never);
  mergeRefMap(client, pick("Client") as never);
  mergeRefMap(user, pick("User") as never);
  for (const row of pick("Order")) {
    const id = row.id != null ? String(row.id) : "";
    if (!id) continue;
    const number = row.orderNumber != null ? String(row.orderNumber).trim() : "";
    if (number) order.set(id, number);
    const projectId = row.projectId != null ? String(row.projectId) : "";
    if (projectId) orderProject.set(id, projectId);
  }
  for (const row of pick("Project")) {
    const id = row.id != null ? String(row.id) : "";
    const clientId = row.clientId != null ? String(row.clientId) : "";
    if (id && clientId) projectClient.set(id, clientId);
  }
  for (const row of pick("Executor")) {
    const id = row.id != null ? String(row.id) : "";
    const email = typeof row.accessEmail === "string" ? row.accessEmail.trim() : "";
    if (id && email) personalSmetaIds.add(id);
  }
  return {
    executor,
    project,
    workType,
    bankAccount,
    client,
    user,
    order,
    orderProject,
    projectClient,
    personalSmetaIds,
  };
}

function useReferenceMaps(diff: Record<string, DiffRow[]> | null) {
  const [liveMaps, setLiveMaps] = React.useState<RefMaps>({});
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/executors").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/projects/options").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/work-types").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/bank-accounts").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/clients").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/responsibles").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/orders").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([executors, projects, workTypes, bankAccounts, clients, users, orders]) => {
        if (cancelled) return;
        const executorList = Array.isArray(executors) ? executors : [];
        const projectList = Array.isArray(projects) ? projects : [];
        const workTypeList = Array.isArray(workTypes) ? workTypes : [];
        const bankList = Array.isArray(bankAccounts) ? bankAccounts : [];
        const clientList = Array.isArray(clients) ? clients : [];
        const userList = Array.isArray(users) ? users : [];
        const orderList = Array.isArray(orders) ? orders : [];

        const executor = new Map<string, string>();
        const user = new Map<string, string>();
        const project = new Map<string, string>();
        const client = new Map<string, string>();
        const order = new Map<string, string>();
        const orderProject = new Map<string, string>();
        const projectClient = new Map<string, string>();
        const personalSmetaIds = new Set<string>();
        for (const row of executorList) {
          if (!row?.id) continue;
          const id = String(row.id);
          const label = String(row.name ?? row.fullName ?? "").trim();
          if (label) executor.set(id, label);
          if (typeof row.accessEmail === "string" && row.accessEmail.trim()) {
            personalSmetaIds.add(id);
          }
          if (row.responsibleUserId && row.responsibleName) {
            user.set(String(row.responsibleUserId), String(row.responsibleName));
          }
        }
        for (const row of userList) {
          if (!row?.id) continue;
          const label = String(row.fullName ?? row.name ?? "").trim();
          if (label) user.set(String(row.id), label);
        }
        for (const row of projectList) {
          if (!row?.id || !row?.name) continue;
          project.set(String(row.id), String(row.name));
        }
        for (const row of clientList) {
          if (!row?.id || !row?.name) continue;
          client.set(String(row.id), String(row.name));
        }
        for (const row of orderList) {
          if (!row?.id) continue;
          const id = String(row.id);
          if (row.orderNumber) order.set(id, String(row.orderNumber));
          if (row.projectId) {
            orderProject.set(id, String(row.projectId));
            if (row.projectName) project.set(String(row.projectId), String(row.projectName));
          }
          if (row.projectId && row.clientId) {
            projectClient.set(String(row.projectId), String(row.clientId));
            if (row.clientName) client.set(String(row.clientId), String(row.clientName));
          }
        }

        setLiveMaps({
          executor,
          project,
          workType: new Map(
            workTypeList
              .filter((row: { id?: string; name?: string }) => row?.id && row?.name)
              .map((row: { id: string; name: string }) => [row.id, row.name])
          ),
          bankAccount: new Map(
            bankList
              .filter((row: { id?: string; name?: string }) => row?.id && row?.name)
              .map((row: { id: string; name: string }) => [row.id, row.name])
          ),
          client,
          user,
          order,
          orderProject,
          projectClient,
          personalSmetaIds,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return React.useMemo(() => {
    const fromDiff = diff ? mapsFromDiff(diff) : {};
    const mergeLabel = (
      a?: Map<string, string>,
      b?: Map<string, string>
    ) => {
      const map = new Map<string, string>();
      a?.forEach((value, id) => map.set(id, value));
      b?.forEach((value, id) => map.set(id, value));
      return map;
    };
    const personalSmetaIds = new Set<string>([
      ...(fromDiff.personalSmetaIds ?? []),
      ...(liveMaps.personalSmetaIds ?? []),
    ]);
    return {
      executor: mergeLabel(fromDiff.executor, liveMaps.executor),
      project: mergeLabel(fromDiff.project, liveMaps.project),
      workType: mergeLabel(fromDiff.workType, liveMaps.workType),
      bankAccount: mergeLabel(fromDiff.bankAccount, liveMaps.bankAccount),
      client: mergeLabel(fromDiff.client, liveMaps.client),
      user: mergeLabel(fromDiff.user, liveMaps.user),
      order: mergeLabel(fromDiff.order, liveMaps.order),
      orderProject: mergeLabel(fromDiff.orderProject, liveMaps.orderProject),
      projectClient: mergeLabel(fromDiff.projectClient, liveMaps.projectClient),
      personalSmetaIds,
    } satisfies RefMaps;
  }, [diff, liveMaps]);
}

function rowSortKey(row: DiffRow, model: string): string {
  const record = row.after ?? row.before;
  if (!record) return `${model}\0${row.key}`;
  const number =
    record.issuedWorkNumber ??
    record.payoutNumber ??
    record.orderNumber ??
    record.name ??
    record.fullName ??
    record.title;
  return `${String(number ?? "")}\0${model}\0${row.key}`;
}

function SideCells({
  row,
  model,
  side,
  columns,
  refs,
}: {
  row: DiffRow;
  model: string;
  side: "A" | "B";
  columns: CompareColumn[];
  refs: RefMaps;
}) {
  const value = side === "A" ? row.before : row.after;
  const changed = new Set(row.changes.map((c) => c.field));
  const marker =
    row.status === "added" ? "+" : row.status === "removed" ? "−" : row.status === "modified" ? "●" : "";

  return (
    <>
      <td
        className={cn(
          "whitespace-nowrap px-1 py-1 text-center text-[10px] font-semibold",
          row.status === "added" && "text-green-600",
          row.status === "removed" && "text-red-600",
          row.status === "modified" && "text-amber-600",
          !value && "text-neutral-300",
          side === "A" && "border-r-0"
        )}
      >
        {value ? marker : "·"}
      </td>
      {columns.map((col) => {
        const highlighted =
          !!value && (col.fields ?? []).some((f) => changed.has(f));
        const content = value
          ? col.render({ record: value, model, refs })
          : "—";
        return (
          <td
            key={`${side}-${col.key}`}
            className={cn(
              "whitespace-nowrap px-1.5 py-1 text-[11px] leading-tight align-middle",
              col.align === "right" && "text-right tabular-nums",
              highlighted && "bg-amber-100/80 font-medium text-amber-950",
              !value && "text-neutral-300"
            )}
          >
            {content}
          </td>
        );
      })}
    </>
  );
}

type TaggedRow = DiffRow & { model: string };

function ComparisonSideTable({
  side,
  label,
  rows,
  columns,
  refs,
}: {
  side: "A" | "B";
  label: string;
  rows: TaggedRow[];
  columns: CompareColumn[];
  refs: RefMaps;
}) {
  const colSpan = columns.length + 1;
  return (
    <table className="min-w-max border-collapse text-[11px] leading-tight">
      <thead className="sticky top-0 z-10">
        <tr className="bg-neutral-100">
          <th
            colSpan={colSpan}
            className="border-b border-neutral-200 px-2 py-1 text-left text-[10px] font-semibold text-neutral-700"
          >
            {side} · {label}
          </th>
        </tr>
        <tr className="bg-neutral-50">
          <th className="border-b px-1 py-1 text-left text-[10px] font-medium text-neutral-500">
            Δ
          </th>
          {columns.map((col) => (
            <th
              key={`${side}-${col.key}`}
              className={cn(
                "whitespace-nowrap border-b px-1.5 py-1 text-left text-[10px] font-medium text-neutral-500",
                col.align === "right" && "text-right"
              )}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={colSpan} className="px-3 py-8 text-center text-neutral-500">
              Нет строк для сравнения
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr
              key={`${row.model}:${row.key}`}
              className={cn(
                "h-7 border-b border-neutral-100",
                row.status === "added" && "bg-green-50/70",
                row.status === "removed" && "bg-red-50/70",
                row.status === "modified" && "bg-amber-50/40",
                row.status === "unchanged" && "bg-white"
              )}
            >
              <SideCells
                row={row}
                model={row.model}
                side={side}
                columns={columns}
                refs={refs}
              />
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

export function SectionSnapshotComparison({
  section,
  sourceA,
  sourceB,
  onlyChanges,
  labelA,
  labelB,
  filter,
}: {
  section: string;
  sourceA: string;
  sourceB: string;
  onlyChanges: boolean;
  labelA: string;
  labelB: string;
  filter?: { field: string; id: string } | null;
}) {
  const [diff, setDiff] = React.useState<Record<string, DiffRow[]> | null>(null);
  const [model, setModel] = React.useState("");
  const [error, setError] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);
  const scrollARef = React.useRef<HTMLDivElement>(null);
  const scrollBRef = React.useRef<HTMLDivElement>(null);
  const refMaps = useReferenceMaps(diff);
  const entityFilter = filter ?? null;
  const config = SECTION_COMPARE_CONFIG[section] ?? null;

  React.useEffect(() => {
    setShowAll(false);
    setDiff(null);
    setError("");
    setModel("");
    const controller = new AbortController();
    const query = new URLSearchParams({ sourceA, sourceB, section });
    fetch(`/api/snapshots/compare?${query}`, { signal: controller.signal })
      .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
      .then(({ ok, payload }) => {
        if (!ok) throw new Error((payload as { error?: string }).error ?? "Не удалось загрузить сравнение");
        const next = (payload as { diff: Record<string, DiffRow[]> }).diff;
        setDiff(next);
        const preferred =
          config?.preferredModel && next[config.preferredModel]
            ? config.preferredModel
            : config?.rowModels.find((m) => (next[m] ?? []).length > 0) ??
              Object.keys(next)[0] ??
              "";
        setModel(preferred);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить сравнение");
      });
    return () => controller.abort();
  }, [sourceA, sourceB, section, config?.preferredModel, config?.rowModels]);

  React.useEffect(() => {
    if (!diff) return;
    const a = scrollARef.current;
    const b = scrollBRef.current;
    if (!a || !b) return;
    let syncing = false;
    const syncTop = (from: HTMLDivElement, to: HTMLDivElement) => {
      if (syncing) return;
      syncing = true;
      to.scrollTop = from.scrollTop;
      requestAnimationFrame(() => {
        syncing = false;
      });
    };
    const onA = () => syncTop(a, b);
    const onB = () => syncTop(b, a);
    a.addEventListener("scroll", onA, { passive: true });
    b.addEventListener("scroll", onB, { passive: true });
    return () => {
      a.removeEventListener("scroll", onA);
      b.removeEventListener("scroll", onB);
    };
  }, [diff, model, onlyChanges, showAll, filter?.field, filter?.id]);

  if (error) {
    return <div className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>;
  }
  if (!diff) {
    return <div className="p-6 text-sm text-neutral-500">Загрузка сравнения…</div>;
  }

  const matchesFilter = (row: DiffRow) => {
    if (!entityFilter) return true;
    if (row.key === entityFilter.id || row.before?.id === entityFilter.id || row.after?.id === entityFilter.id) {
      return true;
    }
    if (entityFilter.field === "id") return false;
    return (
      row.before?.[entityFilter.field] === entityFilter.id ||
      row.after?.[entityFilter.field] === entityFilter.id
    );
  };

  let tagged: TaggedRow[] = [];
  let modelOptions: string[] = [];
  let activeModel = model;
  let columns = config?.columns ?? [];

  if (config) {
    // Несколько row-моделей (issued-works) — объединяем в один список
    if (config.rowModels.length > 1) {
      tagged = config.rowModels.flatMap((m) =>
        (diff[m] ?? [])
          .filter(matchesFilter)
          .filter((row) => !onlyChanges || row.status !== "unchanged")
          .map((row) => ({ ...row, model: m }))
      );
      tagged.sort((a, b) => rowSortKey(a, a.model).localeCompare(rowSortKey(b, b.model), "ru"));
      modelOptions = [];
      activeModel = config.rowModels.join("+");
    } else {
      modelOptions = config.rowModels.filter((m) => (diff[m] ?? []).some(matchesFilter));
      activeModel = modelOptions.includes(model) ? model : (modelOptions[0] ?? config.rowModels[0] ?? "");
      tagged = (diff[activeModel] ?? [])
        .filter(matchesFilter)
        .filter((row) => !onlyChanges || row.status !== "unchanged")
        .map((row) => ({ ...row, model: activeModel }))
        .sort((a, b) => rowSortKey(a, activeModel).localeCompare(rowSortKey(b, activeModel), "ru"));
    }
  } else {
    // Fallback: любая модель из diff (старое поведение без кастомных колонок)
    modelOptions = Object.keys(diff).filter((key) => (diff[key] ?? []).some(matchesFilter));
    activeModel = modelOptions.includes(model) ? model : (modelOptions[0] ?? "");
    tagged = (diff[activeModel] ?? [])
      .filter(matchesFilter)
      .filter((row) => !onlyChanges || row.status !== "unchanged")
      .map((row) => ({ ...row, model: activeModel }))
      .sort((a, b) => rowSortKey(a, activeModel).localeCompare(rowSortKey(b, activeModel), "ru"));
    columns = [
      {
        key: "label",
        label: "Запись",
        fields: ["name", "title", "id"],
        render: ({ record }) =>
          str(record.name) || str(record.title) || str(record.fullName) || str(record.id) || "—",
      },
      {
        key: "status",
        label: "Статус",
        fields: ["status", "workStatus", "paymentStatus"],
        render: ({ record }) =>
          str(record.workStatus) || str(record.paymentStatus) || str(record.status) || "—",
      },
    ];
  }

  const allRows = tagged;
  const rows = showAll ? allRows : allRows.slice(0, COMPARE_ROW_LIMIT);
  const truncated = allRows.length > rows.length;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-white">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        {modelOptions.length > 1 ? (
          <Select value={activeModel} onValueChange={(value) => value && setModel(value)}>
            <SelectTrigger className="h-7 w-52 text-[11px]">
              <SelectValue>{modelLabel(activeModel)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((key) => (
                <SelectItem key={key} value={key}>
                  {modelLabel(key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-[11px] font-medium text-neutral-700">
            {config?.rowModels.length === 1 ? modelLabel(activeModel) : "Сравнение"}
          </span>
        )}
        <span className="text-[11px] text-neutral-400">
          {truncated ? `${rows.length} из ${allRows.length}` : allRows.length} строк
        </span>
        {truncated && (
          <button type="button" className="text-[11px] text-blue-600 hover:underline" onClick={() => setShowAll(true)}>
            Показать все
          </button>
        )}
      </div>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-2 gap-px bg-neutral-300">
        <div ref={scrollARef} className="min-h-0 min-w-0 overflow-auto bg-white">
          <ComparisonSideTable
            side="A"
            label={labelA}
            rows={rows}
            columns={columns}
            refs={refMaps}
          />
        </div>
        <div ref={scrollBRef} className="min-h-0 min-w-0 overflow-auto bg-white">
          <ComparisonSideTable
            side="B"
            label={labelB}
            rows={rows}
            columns={columns}
            refs={refMaps}
          />
        </div>
      </div>
    </div>
  );
}
