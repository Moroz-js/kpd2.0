export type CashflowBalanceInput = {
  openingBalance: number;
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

/**
 * Рассчитывает независимые цепочки баланса ДП и смет.
 * Ручное значение недели N применяется как входящий баланс недели N + 1.
 */
export function calculateCashflowBalances({
  openingBalance,
  income,
  expenseDP,
  expenseBudget,
  manualBalance,
}: CashflowBalanceInput): CashflowBalanceResult {
  const length = income.length;
  if (
    expenseDP.length !== length ||
    expenseBudget.length !== length ||
    manualBalance.length !== length
  ) {
    throw new Error("Массивы кэшфлоу должны иметь одинаковую длину");
  }

  const balanceStartDP: number[] = [];
  const balanceEndDP: number[] = [];
  const balanceEndBudget: number[] = [];

  for (let index = 0; index < length; index += 1) {
    const startDP =
      index === 0
        ? openingBalance
        : manualBalance[index - 1] ?? balanceEndDP[index - 1];
    const startBudget =
      index === 0 ? openingBalance : balanceEndBudget[index - 1];

    balanceStartDP.push(startDP);
    balanceEndDP.push(startDP + income[index] - expenseDP[index]);
    balanceEndBudget.push(
      startBudget + income[index] - expenseBudget[index]
    );
  }

  return { balanceStartDP, balanceEndDP, balanceEndBudget };
}
