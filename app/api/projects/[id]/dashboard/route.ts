import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getISOWeek, getISOWeekYear, getISOWeeksInYear, isoWeekStart } from "@/lib/iso-weeks";
import { hasPersonalSmeta } from "@/lib/executor-personal-estimate";

type Ctx = { params: Promise<{ id: string }> };

function chargeWeek(paidPlanAt: Date | null, paidAt: Date | null): { week: number; year: number } | null {
  const d = paidAt ?? paidPlanAt;
  if (!d) return null;
  return { week: getISOWeek(d), year: getISOWeekYear(d) };
}

function issuedWeek(plannedPayAt: Date | null, paidAt: Date | null): { week: number; year: number } | null {
  const d = paidAt ?? plannedPayAt;
  if (!d) return null;
  return { week: getISOWeek(d), year: getISOWeekYear(d) };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: { select: { name: true } },
      responsible: { select: { id: true, fullName: true } },
    },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!isAdmin(user) && project.responsibleUserId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam) : new Date().getFullYear();
  const weeksInYear = getISOWeeksInYear(year);
  const weeks = Array.from({ length: weeksInYear }, (_, i) => i + 1);

  // Fetch all data for this project + year
  const [works, otherExpenses, charges, planLines, executors, workTypes] = await Promise.all([
    prisma.work.findMany({
      where: { projectId: id },
      include: {
        executor: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
      },
      orderBy: { plannedPayAt: "desc" },
    }),
    prisma.otherExpense.findMany({
      where: { projectId: id },
      include: {
        executor: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
      },
      orderBy: { plannedPayAt: "desc" },
    }),
    prisma.charge.findMany({
      where: { order: { projectId: id } },
      include: { order: { select: { description: true, orderNumber: true } } },
      orderBy: { paidPlanAt: "desc" },
    }),
    prisma.spendingPlanLine.findMany({
      where: { projectId: id, year },
      include: {
        executor: { select: { id: true, name: true, accessEmail: true } },
        workType: { select: { id: true, name: true } },
      },
    }),
    prisma.executor.findMany({ where: { status: "active" }, select: { id: true, name: true, executorWorkTypes: { select: { workTypeId: true } } } }),
    prisma.workType.findMany({ where: { status: "active" }, select: { id: true, name: true } }),
  ]);

  // IssuedWork aggregates per week for this project/year
  const issuedWorksByWeek = new Map<number, { total: number; paid: number }>();
  for (const w of works) {
    const pf = issuedWeek(w.plannedPayAt, w.paidAt);
    if (!pf || pf.year !== year) continue;
    const cur = issuedWorksByWeek.get(pf.week) ?? { total: 0, paid: 0 };
    cur.total += w.amount;
    if (w.workStatus === "paid") cur.paid += w.amount;
    issuedWorksByWeek.set(pf.week, cur);
  }
  for (const o of otherExpenses) {
    const pf = issuedWeek(o.plannedPayAt, o.paidAt);
    if (!pf || pf.year !== year) continue;
    const cur = issuedWorksByWeek.get(pf.week) ?? { total: 0, paid: 0 };
    cur.total += o.amount;
    if (o.workStatus === "paid") cur.paid += o.amount;
    issuedWorksByWeek.set(pf.week, cur);
  }

  // Charges per week
  const chargesByWeek = new Map<number, { total: number; paid: number }>();
  for (const c of charges) {
    const pf = chargeWeek(c.paidPlanAt, c.paidAt);
    if (!pf || pf.year !== year) continue;
    const cur = chargesByWeek.get(pf.week) ?? { total: 0, paid: 0 };
    cur.total += c.amount;
    if (c.status === "paid") cur.paid += c.amount;
    chargesByWeek.set(pf.week, cur);
  }

  // SpendingPlan per week
  const planByWeek = new Map<number, number>();
  for (const pl of planLines) {
    planByWeek.set(pl.week, (planByWeek.get(pl.week) ?? 0) + pl.amount);
  }

  // Block 1: Summary (rows 3–9 из ТЗ)
  // row3  cashflow        = prev + row4 − row42 (план, не факт!)
  // row4  incomePlanFact  = SUM charges plan+fact
  // row5  incomeFact      = SUM charges paid
  // row6  incomePlan      = row4 − row5
  // row7  incomeCumulative= rolling sum row4
  // row8  marginPct       = row3 / row7
  // row9  expenses        = SUM issuedWork (факт+долг+план)
  // row42 expensePlan     = SUM SpendingPlanLine (итог блока 4)
  // row41 overspend       = row9 − row42 (перерасход)
  const summary: Record<string, number[]> = {
    cashflow: [],
    incomePlanFact: [],
    incomeFact: [],
    incomePlan: [],
    incomeCumulative: [],
    marginPct: [],
    expenses: [],
    expensePlan: [],
    overspend: [],
    paidWorks: [],
  };

  let prevCashflow = project.cashflowInitial ?? 0;
  let prevCumulative = 0;

  for (const w of weeks) {
    const inc = chargesByWeek.get(w) ?? { total: 0, paid: 0 };
    const exp = issuedWorksByWeek.get(w) ?? { total: 0, paid: 0 };
    const plan = planByWeek.get(w) ?? 0; // row42

    const incomePF = inc.total;                        // row4
    const incomeFact = inc.paid;                       // row5
    const incomePlan = incomePF - incomeFact;          // row6
    const cumulative = prevCumulative + incomePF;      // row7
    const cashflow = prevCashflow + incomePF - plan;   // row3: ПЛАН, не факт!
    const margin = cumulative === 0 ? 0 : cashflow / cumulative; // row8
    const overspend = exp.total - plan;                // row41

    summary.cashflow.push(cashflow);
    summary.incomePlanFact.push(incomePF);
    summary.incomeFact.push(incomeFact);
    summary.incomePlan.push(incomePlan);
    summary.incomeCumulative.push(cumulative);
    summary.marginPct.push(margin);
    summary.expenses.push(exp.total);
    summary.expensePlan.push(plan);
    summary.overspend.push(overspend);
    summary.paidWorks.push(exp.paid);

    prevCashflow = cashflow;
    prevCumulative = cumulative;
  }

  // Block 2: «Расходы из смет» — все статусы работ, с разбивкой по исполнителям
  const workTypeMap = new Map<string, {
    id: string;
    name: string;
    weeks: number[];
    executorMap: Map<string, { id: string; name: string; weeks: number[] }>;
  }>();
  const allSources = [
    ...works.map(w => ({ workTypeId: w.workTypeId, workTypeName: w.workType.name, executorId: w.executorId, executorName: w.executor.name, amount: w.amount, plannedPayAt: w.plannedPayAt, paidAt: w.paidAt, workStatus: w.workStatus })),
    ...otherExpenses.map(o => ({ workTypeId: o.workTypeId, workTypeName: o.workType.name, executorId: o.executorId, executorName: o.executor.name, amount: o.amount, plannedPayAt: o.plannedPayAt, paidAt: o.paidAt, workStatus: o.workStatus })),
  ];

  for (const src of allSources) {
    const pf = issuedWeek(src.plannedPayAt, src.paidAt);
    if (!pf || pf.year !== year) continue;
    if (!workTypeMap.has(src.workTypeId)) {
      workTypeMap.set(src.workTypeId, {
        id: src.workTypeId,
        name: src.workTypeName,
        weeks: new Array(weeksInYear).fill(0),
        executorMap: new Map(),
      });
    }
    const entry = workTypeMap.get(src.workTypeId)!;
    entry.weeks[pf.week - 1] += src.amount;
    if (!entry.executorMap.has(src.executorId)) {
      entry.executorMap.set(src.executorId, { id: src.executorId, name: src.executorName, weeks: new Array(weeksInYear).fill(0) });
    }
    entry.executorMap.get(src.executorId)!.weeks[pf.week - 1] += src.amount;
  }

  // Block 4: SpendingPlanLine grouped by (executor, workType)
  const planGroupMap = new Map<string, {
    id: string;
    executorId: string;
    executorName: string;
    executorHasPersonalSmeta: boolean;
    workTypeId: string;
    workTypeName: string;
    sourceType: string | null;
    weeks: (string | null)[];
    lineIds: (string | null)[];
  }>();

  for (const pl of planLines) {
    const key = `${pl.executorId}:${pl.workTypeId}`;
    if (!planGroupMap.has(key)) {
      planGroupMap.set(key, {
        id: key,
        executorId: pl.executorId,
        executorName: pl.executor.name,
        executorHasPersonalSmeta: hasPersonalSmeta(pl.executor),
        workTypeId: pl.workTypeId,
        workTypeName: pl.workType.name,
        sourceType: pl.sourceType,
        weeks: new Array(weeksInYear).fill(null),
        lineIds: new Array(weeksInYear).fill(null),
      });
    }
    const entry = planGroupMap.get(key)!;
    const prev = entry.weeks[pl.week - 1];
    entry.weeks[pl.week - 1] = String((prev !== null ? parseFloat(prev) : 0) + pl.amount);
    entry.lineIds[pl.week - 1] = pl.id;
  }

  // Week headers with month info
  const weekHeaders = weeks.map(w => {
    const start = isoWeekStart(year, w);
    return {
      week: w,
      month: start.getMonth() + 1,
      monthName: start.toLocaleDateString("ru-RU", { month: "short" }),
    };
  });

  return NextResponse.json({
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      client: project.client?.name ?? null,
      responsible: project.responsible?.fullName ?? null,
      cashflowInitial: project.cashflowInitial ?? 0,
    },
    year,
    weeks: weekHeaders,
    summary,
    workTypes: Array.from(workTypeMap.values()).map(wt => ({
      id: wt.id,
      name: wt.name,
      weeks: wt.weeks,
      executors: Array.from(wt.executorMap.values()).sort((a, b) => a.name.localeCompare(b.name, "ru")),
    })),
    planLines: Array.from(planGroupMap.values()),
    executors: executors
      .map(e => ({
        id: e.id,
        name: e.name,
        workTypeIds: e.executorWorkTypes.map(ewt => ewt.workTypeId),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    availableWorkTypes: [...workTypes].sort((a, b) => a.name.localeCompare(b.name, "ru")),
  });
}
