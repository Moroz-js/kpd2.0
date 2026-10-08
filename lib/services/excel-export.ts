/**
 * Экспорт актуального кэшфлоу в Excel: числа с того же расчёта, что /api/cashflow.
 * По листу на год, без формул и без шаблона сметы.
 */

import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import {
  buildCashflowYear,
  listCashflowExportYears,
  loadCashflowTables,
  type CashflowProjectRow,
  type CashflowYearData,
} from "@/lib/services/cashflow";

const MONEY = "#,##0";
const HEADER_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
const SECTION_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
const CURRENT_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
const THIN: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFE5E5E5" } };
const BORDERS: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function monthGroups(weeks: CashflowYearData["weeks"]): { label: string; count: number }[] {
  const groups: { label: string; count: number }[] = [];
  for (const week of weeks) {
    const last = groups[groups.length - 1];
    if (last?.label === week.monthName) last.count += 1;
    else groups.push({ label: week.monthName, count: 1 });
  }
  return groups;
}

function styleLabel(cell: ExcelJS.Cell, opts?: { italic?: boolean; bold?: boolean; muted?: boolean; align?: ExcelJS.Alignment["horizontal"] }) {
  cell.font = {
    name: "Calibri",
    size: 10,
    italic: opts?.italic ?? false,
    bold: opts?.bold ?? false,
    color: { argb: opts?.muted ? "FF737373" : "FF171717" },
  };
  cell.alignment = { vertical: "middle", horizontal: opts?.align ?? "left", indent: 1 };
  cell.border = BORDERS;
}

function styleMoney(
  cell: ExcelJS.Cell,
  value: number | null,
  opts?: { bold?: boolean; muted?: boolean; danger?: boolean; current?: boolean }
) {
  if (value === null) {
    cell.value = null;
  } else {
    cell.value = Math.round(value);
    cell.numFmt = MONEY;
  }
  cell.font = {
    name: "Calibri",
    size: 10,
    bold: opts?.bold ?? false,
    color: { argb: opts?.danger ? "FFDC2626" : opts?.muted ? "FF737373" : "FF171717" },
  };
  cell.alignment = { vertical: "middle", horizontal: "right" };
  cell.border = BORDERS;
  if (opts?.current) cell.fill = CURRENT_FILL;
}

function writeWeekValues(
  row: ExcelJS.Row,
  values: (number | null)[],
  currentWeek: number | null,
  opts?: { bold?: boolean; muted?: boolean; dangerZero?: boolean }
) {
  values.forEach((value, index) => {
    const cell = row.getCell(index + 3);
    const danger = opts?.dangerZero && value !== null && Math.round(value) !== 0;
    styleMoney(cell, value, {
      bold: opts?.bold,
      muted: opts?.muted,
      danger,
      current: currentWeek === index + 1,
    });
  });
}

function addSectionRow(sheet: ExcelJS.Worksheet, title: string, weekCount: number) {
  const row = sheet.addRow([title, null, ...Array.from({ length: weekCount }, () => null)]);
  row.height = 18;
  const titleCell = row.getCell(1);
  titleCell.value = title;
  titleCell.fill = SECTION_FILL;
  titleCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF171717" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.border = BORDERS;
  for (let col = 2; col <= weekCount + 2; col += 1) {
    const cell = row.getCell(col);
    cell.fill = SECTION_FILL;
    cell.border = BORDERS;
  }
}

function addMetricRow(
  sheet: ExcelJS.Worksheet,
  label: string,
  values: (number | null)[],
  currentWeek: number | null,
  opts?: { total?: number | null; italic?: boolean; dangerZero?: boolean }
) {
  const row = sheet.addRow([label, opts?.total ?? null, ...values]);
  styleLabel(row.getCell(1), { italic: opts?.italic ?? true, muted: true, align: "right" });
  styleMoney(row.getCell(2), opts?.total === undefined ? sum(values.map((value) => value ?? 0)) : opts.total);
  writeWeekValues(row, values, currentWeek, { dangerZero: opts?.dangerZero });
}

function addProjectRows(
  sheet: ExcelJS.Worksheet,
  title: string,
  projects: CashflowProjectRow[],
  pick: (project: CashflowProjectRow) => number[],
  weekCount: number,
  currentWeek: number | null
) {
  addSectionRow(sheet, title, weekCount);
  if (projects.length === 0) {
    const empty = sheet.addRow(["Нет данных", null, ...Array.from({ length: weekCount }, () => null)]);
    styleLabel(empty.getCell(1), { muted: true });
    return;
  }
  for (const project of projects) {
    const values = pick(project);
    const muted = project.type !== "client";
    const row = sheet.addRow([project.name, sum(values), ...values]);
    styleLabel(row.getCell(1), { muted });
    styleMoney(row.getCell(2), sum(values), { bold: true, muted });
    writeWeekValues(row, values, currentWeek, { muted });
  }
}

function writeYearSheet(workbook: ExcelJS.Workbook, data: CashflowYearData) {
  const sheet = workbook.addWorksheet(String(data.year), {
    views: [{ state: "frozen", xSplit: 2, ySplit: 2, activeCell: "C3" }],
  });
  const weeks = data.weeks;
  const currentWeek = data.year === data.currentWeekYear ? data.currentWeek : null;

  sheet.columns = [
    { width: 42 },
    { width: 12 },
    ...weeks.map(() => ({ width: 9 })),
  ];

  const monthRow = sheet.addRow(["Показатель / Проект", "Итого"]);
  const weekRow = sheet.addRow(["Неделя", ""]);
  let col = 3;
  for (const group of monthGroups(weeks)) {
    sheet.mergeCells(monthRow.number, col, monthRow.number, col + group.count - 1);
    const cell = monthRow.getCell(col);
    cell.value = group.label;
    col += group.count;
  }
  weeks.forEach((week, index) => {
    weekRow.getCell(index + 3).value = week.week;
  });

  for (const row of [monthRow, weekRow]) {
    row.height = 18;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.fill = colNumber >= 3 && weeks[colNumber - 3]?.week === currentWeek ? CURRENT_FILL : HEADER_FILL;
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF525252" } };
      cell.alignment = { vertical: "middle", horizontal: colNumber === 1 ? "left" : "center" };
      cell.border = BORDERS;
    });
  }

  addSectionRow(sheet, "Сводка", weeks.length);
  addMetricRow(sheet, "Баланс на начало", data.summary.balanceStart, currentWeek, {
    total: data.openingBalance,
    italic: true,
  });
  addMetricRow(sheet, "Приход (факт)", data.summary.incomeFact, currentWeek);
  addMetricRow(sheet, "Приход (план)", data.summary.incomePlanOnly, currentWeek);
  addMetricRow(sheet, "Приход (план+факт)", data.summary.incomePlanFact, currentWeek);
  addMetricRow(sheet, "Расход (план-факт) из ДП", data.summary.expensePlanDP, currentWeek);
  addMetricRow(sheet, "Баланс (сметы/ДП)", data.summary.balanceEndDP, currentWeek);
  addMetricRow(sheet, "Баланс руками", data.summary.manualBalance, currentWeek, { total: null });
  addMetricRow(sheet, "Баланс на счетах", data.balanceInAccounts, currentWeek, {
    total: data.balanceInAccounts.reduce<number | null>((total, value) => {
      if (value === null) return total;
      return (total ?? 0) + value;
    }, null),
  });
  addMetricRow(sheet, "Несхождение", data.discrepancy, currentWeek, {
    dangerZero: true,
    total: data.discrepancy.reduce<number | null>((total, value) => {
      if (value === null) return total;
      return (total ?? 0) + value;
    }, null),
  });
  addMetricRow(sheet, "Оплачено из смет", data.summary.paidFromBudget, currentWeek);
  addMetricRow(sheet, "Неоплачено из смет", data.summary.unpaidFromBudget, currentWeek);
  addMetricRow(sheet, "Несхождение план и факт в ДП", data.discrepancyDPFact, currentWeek, {
    dangerZero: true,
  });
  addMetricRow(sheet, "Проектные расходы", data.aggregates.projectExpenses, currentWeek);
  addMetricRow(sheet, "Непроектные расходы", data.aggregates.nonProjectExpenses, currentWeek);

  const allProjects = [...data.externalProjects, ...data.internalProjects];
  addProjectRows(sheet, "План расходов из дашбордов проектов", allProjects, (project) => project.plan, weeks.length, currentWeek);
  addProjectRows(sheet, "План-факт расходов из работ", allProjects, (project) => project.iw, weeks.length, currentWeek);
  addProjectRows(sheet, "План доходов", allProjects, (project) => project.charges, weeks.length, currentWeek);

  sheet.getColumn(1).width = 42;
  sheet.getColumn(2).width = 12;
  weeks.forEach((_, index) => {
    sheet.getColumn(index + 3).width = 9;
  });
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

export async function buildCashflowWorkbook(years: CashflowYearData[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "КПД";
  workbook.created = new Date();
  for (const year of years) writeYearSheet(workbook, year);
  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.from(raw);
}

export async function buildExportWorkbook(): Promise<Buffer> {
  const tables = await loadCashflowTables(prisma as never);
  const years = listCashflowExportYears(tables).map((year) => buildCashflowYear(tables, year));
  return buildCashflowWorkbook(years);
}
