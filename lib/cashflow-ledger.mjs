// Pure calculation shared by the Next server and the standalone Node snapshot worker.
const businessDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
});

function isoWeek(date) {
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  return Math.ceil(((thursday - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}

function weeksInYear(year) {
  return isoWeek(new Date(Date.UTC(year, 11, 28)));
}

/** Cashflow uses calendar years: late December stays in week 52/53, early January in week 1. */
export function cashflowWeekYear(value) {
  const parts = Object.fromEntries(businessDay.formatToParts(value instanceof Date ? value : new Date(value))
    .map(({ type, value: part }) => [type, Number(part)]));
  const { year, month, day } = parts;
  const week = isoWeek(new Date(Date.UTC(year, month - 1, day)));
  return { year, week: month === 12 && week === 1 ? weeksInYear(year) : month === 1 && week >= 52 ? 1 : week };
}

/** Ignore incomplete legacy dates, preferring valid actual over planned payment. */
export function cashflowPaymentWeek(actual, planned) {
  for (const value of [actual, planned]) {
    if (value == null) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isFinite(date.getTime())) return cashflowWeekYear(date);
  }
  return null;
}

/** @param {import('./cashflow-balance').CashflowBalanceInput} input */
export function calculateCashflowBalances({ openingBalance, openingBudget = openingBalance, income, expenseDP, expenseBudget, manualBalance }) {
  if ([expenseDP, expenseBudget, manualBalance].some((values) => values.length !== income.length)) {
    throw new Error("Массивы кэшфлоу должны иметь одинаковую длину");
  }
  const balanceStartDP = [], balanceEndDP = [], balanceEndBudget = [];
  let dp = openingBalance, budget = openingBudget;
  for (let i = 0; i < income.length; i++) {
    balanceStartDP.push(dp);
    dp = dp + income[i] - expenseDP[i];
    budget = budget + income[i] - expenseBudget[i];
    balanceEndDP.push(dp);
    balanceEndBudget.push(budget);
    dp = manualBalance[i] ?? dp; // Override the following week's opening, not this week's closing.
  }
  return { balanceStartDP, balanceEndDP, balanceEndBudget };
}

const zeroes = (length) => Array.from({ length }, () => 0);
function projectFlows(count) {
  return { charges: zeroes(count), iw: zeroes(count), iwPaid: zeroes(count), plan: zeroes(count) };
}
function newYear(year) {
  const count = weeksInYear(year);
  return {
    count, ...projectFlows(count), chargesPaid: zeroes(count), opening: /** @type {number|null} */ (null),
    manual: /** @type {(number|null)[]} */ (Array(count).fill(null)),
    projects: /** @type {Map<string, ReturnType<typeof projectFlows>>} */ (new Map()),
  };
}

/** Index transactions once, before selecting visible weeks or even years. */
function indexYears(tables) {
  const years = new Map();
  const activeIds = new Set(tables.activeProjects.map((p) => p.id));
  function bucket(year) {
    if (!years.has(year)) years.set(year, newYear(year));
    return years.get(year);
  }
  function add(group, projectId, i, key, amount) {
    group[key][i] += amount;
    if (!activeIds.has(projectId)) return;
    if (!group.projects.has(projectId)) group.projects.set(projectId, projectFlows(group.count));
    group.projects.get(projectId)[key][i] += amount;
  }
  for (const row of tables.charges) {
    if (!activeIds.has(row.order?.projectId)) continue;
    const point = cashflowPaymentWeek(row.paidAt, row.paidPlanAt);
    if (!point) continue;
    const { year, week } = point;
    const group = bucket(year);
    add(group, row.order.projectId, week - 1, "charges", row.amount);
    if (row.status === "paid") group.chargesPaid[week - 1] += row.amount;
  }
  for (const source of [tables.works, tables.otherExpenses]) {
    for (const row of source) {
      const point = cashflowPaymentWeek(row.paidAt, row.plannedPayAt);
      if (!point) continue;
      const { year, week } = point;
      const group = bucket(year);
      add(group, row.projectId, week - 1, "iw", row.amount);
      if (row.workStatus === "paid") add(group, row.projectId, week - 1, "iwPaid", row.amount);
    }
  }
  for (const { year, week, amount, projectId } of tables.planLines) {
    if (!activeIds.has(projectId)) continue;
    const group = bucket(year);
    if (week >= 1 && week <= group.count) add(group, projectId, week - 1, "plan", amount);
  }
  for (const { year, week, amount } of tables.manualBalances) {
    const group = bucket(year);
    if (week >= 1 && week <= group.count) group.manual[week - 1] = amount;
  }
  for (const { year, amount } of tables.openingBalances) bucket(year).opening = amount;
  return years;
}

/**
 * Empty years have no movements: skipping them carries both balances unchanged.
 * Annual overrides anchor both company lines, never an individual project.
 * @param {import('./services/cashflow').CashflowTables} tables
 * @param {number[]|undefined} requested undefined = all data years plus the as-of year
 * @returns {Map<number, import('./cashflow-balance').CashflowLedgerYear>}
 */
export function buildCashflowLedgers(tables, requested, now = new Date()) {
  const inputs = indexYears(tables);
  const current = cashflowWeekYear(now);
  const wanted = new Set(requested ?? [...inputs.keys(), current.year]);
  const last = Math.max(...wanted);
  const years = [...new Set([...wanted, ...inputs.keys()])].filter((year) => year <= last).sort((a, b) => a - b);
  const result = new Map();
  const projectCarry = new Map();
  let dp = 0, budget = 0;
  for (const year of years) {
    /** @type {ReturnType<typeof newYear>} */
    const group = inputs.get(year) ?? newYear(year);
    const openingBalance = group.opening ?? dp;
    const expenseDP = group.plan.map((plan, i) =>
      year < current.year || (year === current.year && i + 1 < current.week) ? group.iwPaid[i] : plan);
    const balances = calculateCashflowBalances({ openingBalance, openingBudget: group.opening ?? budget,
      income: group.charges, expenseDP, expenseBudget: group.iw, manualBalance: group.manual });
    dp = group.manual.at(-1) ?? balances.balanceEndDP.at(-1);
    budget = balances.balanceEndBudget.at(-1);

    const projects = tables.activeProjects.map(({ id, name, type }) => {
      const flows = group.projects.get(id) ?? projectFlows(group.count);
      const previous = projectCarry.get(id) ?? { dp: 0, budget: 0 };
      let projectDP = previous.dp, projectBudget = previous.budget;
      const cashflow = flows.charges.map((amount, i) => (projectDP += amount - flows.plan[i]));
      const budgetCashflow = flows.charges.map((amount, i) => (projectBudget += amount - flows.iw[i]));
      projectCarry.set(id, { dp: projectDP, budget: projectBudget });
      const visible = group.projects.has(id) || previous.dp !== 0 || previous.budget !== 0;
      return { id, name, type, ...flows, cashflow, budgetCashflow, visible };
    });
    if (wanted.has(year)) {
      result.set(year, { openingBalance, ...balances, projects, expenseDP, income: group.charges,
        incomeFact: group.chargesPaid, paid: group.iwPaid, issued: group.iw, plan: group.plan, manualBalance: group.manual });
    }
  }
  return result;
}
