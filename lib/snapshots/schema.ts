export const SNAPSHOT_SCHEMA_VERSION = 1;
export const CASHFLOW_FORMULA_VERSION = "cashflow-v1";
export const SNAPSHOT_TIMEZONE = "Europe/Moscow";

export const SNAPSHOT_MODELS = [
  "User",
  "Executor",
  "Client",
  "Project",
  "ProjectWorkType",
  "ProjectExecutor",
  "BankAccount",
  "Currency",
  "WorkType",
  "ExecutorWorkType",
  "Work",
  "Payment",
  "OtherExpense",
  "NumberCounter",
  "Order",
  "Charge",
  "BankOperation",
  "SpendingPlanLine",
  "VacationEntry",
  "Task",
  "CashflowOpeningBalance",
  "CashflowCellComment",
  "ActivityLog",
  "BankAccountReconciliation",
  "BankAccountReconciliationResult",
  "ProjectVerification",
  "ProjectVerificationResult",
] as const;

export type SnapshotModel = (typeof SNAPSHOT_MODELS)[number];
export type SnapshotRecord = Record<string, unknown>;

export const MODEL_DELEGATES: Record<SnapshotModel, string> = {
  User: "user",
  Executor: "executor",
  Client: "client",
  Project: "project",
  ProjectWorkType: "projectWorkType",
  ProjectExecutor: "projectExecutor",
  BankAccount: "bankAccount",
  Currency: "currency",
  WorkType: "workType",
  ExecutorWorkType: "executorWorkType",
  Work: "work",
  Payment: "payment",
  OtherExpense: "otherExpense",
  NumberCounter: "numberCounter",
  Order: "order",
  Charge: "charge",
  BankOperation: "bankOperation",
  SpendingPlanLine: "spendingPlanLine",
  VacationEntry: "vacationEntry",
  Task: "task",
  CashflowOpeningBalance: "cashflowOpeningBalance",
  CashflowCellComment: "cashflowCellComment",
  ActivityLog: "activityLog",
  BankAccountReconciliation: "bankAccountReconciliation",
  BankAccountReconciliationResult: "bankAccountReconciliationResult",
  ProjectVerification: "projectVerification",
  ProjectVerificationResult: "projectVerificationResult",
};

export const SECTION_MODELS: Record<string, SnapshotModel[]> = {
  cashflow: [
    "Project",
    "Order",
    "Charge",
    "Work",
    "OtherExpense",
    "SpendingPlanLine",
    "CashflowOpeningBalance",
    "BankAccountReconciliation",
    "BankAccountReconciliationResult",
  ],
  projects: ["Project", "Client", "User", "ProjectExecutor", "ProjectWorkType"],
  charges: ["Charge", "Order", "Project", "Client", "BankAccount"],
  orders: ["Order", "Project", "Client", "Charge"],
  "issued-works": ["Work", "OtherExpense", "Project", "Executor", "WorkType"],
  payouts: ["Payment", "OtherExpense", "Executor", "BankAccount"],
  "other-expenses": ["OtherExpense", "Project", "Executor", "WorkType", "BankAccount"],
  executors: [
    "Executor",
    "User",
    "ExecutorWorkType",
    "ProjectExecutor",
    "WorkType",
    "Project",
    "BankAccount",
  ],
  responsibles: ["User", "Executor", "Project"],
  clients: ["Client", "Project", "Order", "Charge"],
  "work-types": ["WorkType", "ExecutorWorkType", "ProjectWorkType"],
  "bank-accounts": ["BankAccount", "BankOperation", "BankAccountReconciliation", "BankAccountReconciliationResult"],
  tasks: ["Task", "Executor"],
  activity: ["ActivityLog", "User"],
  export: [...SNAPSHOT_MODELS],
};

export function sanitizeSnapshotRow(model: SnapshotModel, row: SnapshotRecord): SnapshotRecord {
  if (model !== "User") return row;
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "password")
  );
}

export function snapshotModelKey(model: SnapshotModel): string {
  return `models/${model}.ndjson.gz`;
}
