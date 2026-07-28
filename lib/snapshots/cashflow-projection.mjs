export const CASHFLOW_FORMULA_VERSION = "cashflow-v1";

function moscowParts(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function weeksInYear(year) {
  return isoWeek(new Date(Date.UTC(year, 11, 28)));
}

function cashflowWeekYear(value) {
  const p = moscowParts(value);
  const week0 = isoWeek(new Date(Date.UTC(p.year, p.month - 1, p.day)));
  let week = week0;
  if (week0 === 1 && p.month === 12) week = weeksInYear(p.year);
  else if (week0 >= 52 && p.month === 1) week = 1;
  return { year: p.year, week };
}

function isoWeekStart(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  return monday;
}

function zeroes(length) {
  return Array.from({ length }, () => 0);
}

export function availableCashflowYears(tables) {
  const years = new Set();
  for (const row of tables.CashflowOpeningBalance ?? []) years.add(Number(row.year));
  for (const row of tables.SpendingPlanLine ?? []) years.add(Number(row.year));
  for (const row of [...(tables.Charge ?? []), ...(tables.Work ?? []), ...(tables.OtherExpense ?? [])]) {
    const value = row.paidAt ?? row.paidPlanAt ?? row.plannedPayAt;
    if (value) years.add(cashflowWeekYear(value).year);
  }
  years.add(Number(moscowParts(new Date()).year));
  return [...years].filter(Number.isInteger).sort();
}

export function projectCashflow(tables, year, now = new Date()) {
  const count = weeksInYear(year);
  const projects = tables.Project ?? [];
  const active = projects.filter((project) => project.status === "active");
  const activeIds = new Set(active.map((project) => project.id));
  const orders = new Map((tables.Order ?? []).map((order) => [order.id, order]));
  const chargeTotal = zeroes(count);
  const iwTotal = zeroes(count);
  const iwPaidTotal = zeroes(count);
  const planTotal = zeroes(count);
  const chargeByProject = new Map();
  const iwByProject = new Map();
  const planByProject = new Map();

  function add(map, projectId, index, amount) {
    if (!map.has(projectId)) map.set(projectId, zeroes(count));
    map.get(projectId)[index] += Number(amount) || 0;
  }

  for (const charge of tables.Charge ?? []) {
    const order = orders.get(charge.orderId);
    if (!order || !activeIds.has(order.projectId)) continue;
    const value = charge.paidAt ?? charge.paidPlanAt;
    if (!value) continue;
    const point = cashflowWeekYear(value);
    if (point.year !== year || point.week < 1 || point.week > count) continue;
    chargeTotal[point.week - 1] += Number(charge.amount) || 0;
    add(chargeByProject, order.projectId, point.week - 1, charge.amount);
  }

  for (const row of [...(tables.Work ?? []), ...(tables.OtherExpense ?? [])]) {
    const value = row.paidAt ?? row.plannedPayAt;
    if (!value) continue;
    const point = cashflowWeekYear(value);
    if (point.year !== year || point.week < 1 || point.week > count) continue;
    iwTotal[point.week - 1] += Number(row.amount) || 0;
    if (row.workStatus === "paid") {
      iwPaidTotal[point.week - 1] += Number(row.amount) || 0;
    }
    add(iwByProject, row.projectId, point.week - 1, row.amount);
  }

  for (const line of tables.SpendingPlanLine ?? []) {
    if (Number(line.year) !== year || !activeIds.has(line.projectId)) continue;
    const index = Number(line.week) - 1;
    if (index < 0 || index >= count) continue;
    planTotal[index] += Number(line.amount) || 0;
    add(planByProject, line.projectId, index, line.amount);
  }

  const opening = (tables.CashflowOpeningBalance ?? []).find((row) => Number(row.year) === year);
  const startBalance = Number(opening?.amount) || 0;
  const current = cashflowWeekYear(now);
  const balanceEndDP = [];
  const balanceEndBudget = [];
  let previousDP = startBalance;
  let previousBudget = startBalance;
  for (let i = 0; i < count; i++) {
    const isPast = year < current.year || (year === current.year && i + 1 < current.week);
    const dpExpense = isPast ? iwPaidTotal[i] : planTotal[i];
    previousDP = previousDP + chargeTotal[i] - dpExpense;
    previousBudget = previousBudget + chargeTotal[i] - iwTotal[i];
    balanceEndDP.push(previousDP);
    balanceEndBudget.push(previousBudget);
  }

  const projectRows = active.map((project) => {
    const charges = chargeByProject.get(project.id) ?? zeroes(count);
    const plan = planByProject.get(project.id) ?? zeroes(count);
    const iw = iwByProject.get(project.id) ?? zeroes(count);
    let dp = 0;
    let budget = 0;
    const cashflow = [];
    const budgetCashflow = [];
    for (let i = 0; i < count; i++) {
      dp += charges[i] - plan[i];
      budget += charges[i] - iw[i];
      cashflow.push(dp);
      budgetCashflow.push(budget);
    }
    return { id: project.id, name: project.name, type: project.type, charges, plan, iw, cashflow, budgetCashflow };
  });

  const weeks = Array.from({ length: count }, (_, index) => {
    const start = isoWeekStart(year, index + 1);
    return {
      week: index + 1,
      month: start.getUTCMonth() + 1,
      monthName: new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" }).format(start),
    };
  });

  return {
    formulaVersion: CASHFLOW_FORMULA_VERSION,
    year,
    weeks,
    balanceEndDP,
    balanceEndBudget,
    projects: projectRows,
  };
}

export function projectAllCashflowYears(tables, now = new Date()) {
  return Object.fromEntries(
    availableCashflowYears(tables).map((year) => [String(year), projectCashflow(tables, year, now)])
  );
}
