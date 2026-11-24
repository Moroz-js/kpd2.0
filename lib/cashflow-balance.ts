export type CashflowBalanceInput = {
  openingBalance: number;
  openingBudget?: number;
  income: number[];
  expenseDP: number[];
  expenseBudget: number[];
  manualBalance: (number | null)[];
};

export type CashflowBalanceResult = {
  balanceStartDP: number[];
  balanceEndDP: number[];
  balanceEndBudget: number[];
};

// Shared implementation also runs in the standalone snapshot worker (no TS loader).
export { calculateCashflowBalances } from "./cashflow-ledger.mjs";

export type CashflowLedgerYear = CashflowBalanceResult & {
  openingBalance: number;
  income: number[]; incomeFact: number[];
  paid: number[]; issued: number[]; plan: number[]; expenseDP: number[];
  manualBalance: (number | null)[];
  projects: (import("./services/cashflow").CashflowProjectRow & { visible: boolean })[];
};
