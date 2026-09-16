/** Клиентские типы страницы «Банковские транзакции» — даты приходят строками из API. */

export type ChargeLink = {
  chargeId: string;
  chargeNumber: string;
  invoiceNumber: string | null;
  chargeAmount: number;
  chargeStatus: string;
  projectName: string | null;
  amount: number | null;
  link: string; // suggested | confirmed
  reason: string | null;
};

export type BankOperation = {
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  currency: string;
  statementFormat: string;
  transferSource: string | null;
  amount: number;
  date: string;
  month: number;
  year: number;
  kind: string; // incoming | outgoing
  isInternalTransfer: boolean;
  pairedOperationId: string | null;
  pairedAccountName: string | null;
  counterpartyName: string | null;
  counterpartyType: string | null;
  counterpartyId: string | null;
  counterpartyLinkedName: string | null;
  counterpartyRuleId: string | null;
  projectId: string | null;
  projectName: string | null;
  workTypeId: string | null;
  workTypeName: string | null;
  workDescription: string | null;
  paymentOrder: string | null;
  paymentPurpose: string | null;
  basis: string | null;
  status: string;
  chargeMatch: string | null;
  comment: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  raw: {
    docNumber: string | null;
    date: string | null;
    amount: string | null;
    currency: string | null;
    operationType: string | null;
    counterparty: string | null;
    inn: string | null;
    account: string | null;
    bik: string | null;
    purpose: string | null;
    category: string | null;
  };
  trace: {
    counterparty: string | null;
    project: string | null;
    workType: string | null;
  };
  charges: ChargeLink[];
};

export type ChargeCandidate = {
  id: string;
  chargeNumber: string;
  invoiceNumber: string | null;
  projectName: string | null;
  bankAccountName: string | null;
  amount: number;
  linkedAmount: number;
  status: string;
  issuedAt: string | null;
  paidPlanAt: string | null;
  paymentPurpose: string | null;
};

export type OptionRow = { id: string; name: string; statementFormat?: string };

/** Контрагент для выбора в операции: ищем по имени, написаниям из выписки и реквизитам. */
export type CounterpartyOption = {
  id: string;
  name: string;
  kind: string;
  status: string;
  legalType: string | null;
  uniqueProjectId: string | null;
  uniqueWorkTypeId: string | null;
  searchText: string;
};

export type RecognitionRule = {
  id: string;
  target: string;
  matchField: string;
  matchValue: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  projectId: string | null;
  projectName: string | null;
  workTypeId: string | null;
  workTypeName: string | null;
  priority: number;
  isActive: boolean;
  hitCount: number;
  lastUsedAt: string | null;
  source: string;
  comment: string | null;
  createdByName: string | null;
  createdAt: string;
};

/** Имя контрагента в строке: из справочника, иначе написание из выписки. */
export function counterpartyLabel(op: BankOperation): string | null {
  return op.counterpartyLinkedName ?? op.counterpartyName;
}

/** В таблице и фильтре — только справочник. Пусто, пока не определился. */
export function catalogCounterpartyName(op: BankOperation): string | null {
  if (!op.counterpartyId) return null;
  return op.counterpartyLinkedName ?? op.counterpartyName;
}

/** Назначение из банка, иначе описание из разбора. */
export function operationPurpose(op: BankOperation): string | null {
  return op.paymentPurpose ?? op.raw.purpose ?? op.workDescription;
}

export function canConfirmOperation(op: BankOperation): boolean {
  if (op.status === "confirmed") return false;
  if (op.kind === "incoming" && !op.isInternalTransfer) {
    return op.chargeMatch === "confirmed" && op.charges.length > 0;
  }
  return true;
}

/**
 * Пара внутреннего перевода показывается одной строкой — списанием.
 * Поступление-близнец скрывается, чтобы перевод не удваивал оборот.
 */
export function collapseTransferPairs(rows: BankOperation[]): BankOperation[] {
  return rows.filter(
    (r) => !(r.isInternalTransfer && r.pairedOperationId && r.kind === "incoming")
  );
}
