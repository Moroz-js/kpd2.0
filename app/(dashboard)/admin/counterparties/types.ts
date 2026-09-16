export type Requisite = {
  id: string;
  paymentMethod: string;
  taxId: string | null;
  bic: string | null;
  bankName: string | null;
  accountNumber: string | null;
  cardNumber: string | null;
  status: string;
  comment: string | null;
};

export type Alias = {
  id: string;
  value: string;
  source: string;
};

export type Counterparty = {
  id: string;
  name: string;
  kind: string;
  legalType: string | null;
  status: string;
  comment: string | null;
  executorId: string | null;
  executorName: string | null;
  clientId: string | null;
  clientName: string | null;
  bankAccountId: string | null;
  bankAccountName: string | null;
  uniqueProjectId: string | null;
  uniqueProjectName: string | null;
  uniqueWorkTypeId: string | null;
  uniqueWorkTypeName: string | null;
  personalEstimateUrl: string | null;
  requisites: Requisite[];
  aliases: Alias[];
  operationCount: number;
  createdAt: string;
};

export type LinkOption = { id: string; name: string; status: string; type?: string };

/** Что заполнено у контрагента: ссылка ровно одна. */
export type LinkKind = "executor" | "client" | "bankAccount";

export const LINK_LABELS: Record<LinkKind, string> = {
  executor: "Исполнитель",
  client: "Клиент",
  bankAccount: "Счёт КПД",
};

export function linkedEntityHref(row: {
  executorId: string | null;
  clientId: string | null;
  bankAccountId: string | null;
}): string | null {
  if (row.executorId) return `/admin/executors/${row.executorId}?tab=settings`;
  if (row.clientId) return `/admin/clients?open=${row.clientId}`;
  if (row.bankAccountId) return `/admin/bank-accounts?open=${row.bankAccountId}`;
  return null;
}

export function linkedEntityLabel(row: {
  executorName: string | null;
  clientName: string | null;
  bankAccountName: string | null;
}): string | null {
  return row.executorName ?? row.clientName ?? row.bankAccountName;
}
