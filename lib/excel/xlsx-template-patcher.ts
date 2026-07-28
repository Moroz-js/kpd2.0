import path from "path";
import JSZip from "jszip";
import type { SheetMeta } from "@/lib/excel/mappings";

export type ExcelRow = Record<string, unknown>;

export type SheetPatch = {
  meta: SheetMeta;
  rows: ExcelRow[];
};

type Cell = {
  ref: string;
  col: number;
  row: number;
  attrs: string;
  styleAttrs: string;
  value: string | null;
  formula: string | null;
};

type ParsedRow = {
  row: number;
  attrs: string;
  xml: string;
  cells: Map<number, Cell>;
};

type TableRef = {
  path: string;
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

export async function patchWorkbookTemplate(
  templateBuffer: Buffer,
  patches: SheetPatch[],
  keepSheets?: string[],
  documentMetadata?: Record<string, unknown>,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(templateBuffer);
  const sharedStrings = await readSharedStrings(zip);
  const sheetPaths = await readWorkbookSheetPaths(zip);

  if (keepSheets && keepSheets.length > 0) {
    await removeUnneededSheets(zip, sheetPaths, keepSheets);
  }

  for (const patch of patches) {
    const sheetPath = sheetPaths.get(patch.meta.sheet);
    if (!sheetPath) throw new Error(`Лист "${patch.meta.sheet}" не найден в workbook.xml`);

    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) throw new Error(`XML листа "${patch.meta.sheet}" не найден: ${sheetPath}`);

    const worksheetXml = await sheetFile.async("string");
    const tableRefs = await readWorksheetTables(zip, sheetPath);
    const targetTable = tableRefs.find((t) => tableCoversHeader(worksheetXml, sharedStrings, t, patch.meta.identifyBy));
    const patched = patchWorksheetXml(worksheetXml, sharedStrings, patch, targetTable ?? null);

    zip.file(sheetPath, patched.xml);

    for (const tableRef of tableRefs) {
      if (targetTable && tableRef.path === targetTable.path) {
        await patchTableXml(zip, tableRef.path, patched.tableRef);
      }
    }
  }

  await removeCalcChain(zip);
  await forceFullRecalculation(zip);
  if (documentMetadata) {
    const corePath = "docProps/core.xml";
    const file = zip.file(corePath);
    if (file) {
      const core = await file.async("string");
      const description = escapeXml(JSON.stringify(documentMetadata));
      const next = /<dc:description>[\s\S]*?<\/dc:description>/.test(core)
        ? core.replace(/<dc:description>[\s\S]*?<\/dc:description>/, `<dc:description>${description}</dc:description>`)
        : core.replace("</cp:coreProperties>", `<dc:description>${description}</dc:description></cp:coreProperties>`);
      zip.file(corePath, next);
    }
  }

  const output = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return Buffer.from(output);
}

/** Удаляет из zip все листы, не входящие в keepSheets, и обновляет workbook.xml / rels / [Content_Types]. */
async function removeUnneededSheets(
  zip: JSZip,
  sheetPaths: Map<string, string>,
  keepSheets: string[],
): Promise<void> {
  const keepSet = new Set(keepSheets);

  // Листы для удаления
  const toRemove: { name: string; sheetPath: string }[] = [];
  for (const [name, sheetPath] of sheetPaths.entries()) {
    if (!keepSet.has(name)) toRemove.push({ name, sheetPath });
  }
  if (toRemove.length === 0) return;

  const removedPaths = new Set<string>();

  for (const { sheetPath } of toRemove) {
    removedPaths.add(sheetPath);

    // Удаляем связанные файлы через _rels листа
    const relPath = `${path.posix.dirname(sheetPath)}/_rels/${path.posix.basename(sheetPath)}.rels`;
    const relFile = zip.file(relPath);
    if (relFile) {
      const relXml = await relFile.async("string");
      for (const rel of relXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
        const attrs = parseAttrs(rel[1]);
        if (attrs.Target) {
          const absPath = normalizeXlsxPath(path.posix.dirname(sheetPath), attrs.Target);
          removedPaths.add(absPath);
          // Удаляем и _rels связанного файла
          const nestedRel = `${path.posix.dirname(absPath)}/_rels/${path.posix.basename(absPath)}.rels`;
          removedPaths.add(nestedRel);
        }
      }
      removedPaths.add(relPath);
    }
  }

  for (const p of removedPaths) {
    zip.remove(p);
  }

  // Обновляем workbook.xml — убираем <sheet> элементы удалённых листов
  const workbookPath = "xl/workbook.xml";
  const workbookXml = await requiredText(zip, workbookPath);
  const relsPath = "xl/_rels/workbook.xml.rels";
  const relsXml = await requiredText(zip, relsPath);

  // Строим карту rId → sheetPath
  const rIdToPath = new Map<string, string>();
  for (const rel of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attrs = parseAttrs(rel[1]);
    if (attrs.Id && attrs.Target) {
      rIdToPath.set(attrs.Id, normalizeXlsxPath("xl", attrs.Target));
    }
  }

  // Определяем rId удалённых листов
  const removedRIds = new Set<string>();
  for (const [rId, p] of rIdToPath.entries()) {
    if (removedPaths.has(p)) removedRIds.add(rId);
  }

  // Удаляем <sheet .../> из workbook.xml
  const cleanedWorkbook = workbookXml.replace(/<sheet\b([^>]*)\/>/g, (match) => {
    const attrs = parseAttrs(match.slice(6));
    return removedRIds.has(attrs["r:id"]) ? "" : match;
  });
  zip.file(workbookPath, cleanedWorkbook);

  // Удаляем <Relationship .../> из workbook.xml.rels
  const cleanedRels = relsXml.replace(/<Relationship\b([^>]*)\/>/g, (match) => {
    const attrs = parseAttrs(match.slice(14));
    return removedRIds.has(attrs.Id) ? "" : match;
  });
  zip.file(relsPath, cleanedRels);

  // Удаляем Override из [Content_Types].xml
  const ctPath = "[Content_Types].xml";
  const ctFile = zip.file(ctPath);
  if (ctFile) {
    const ctXml = await ctFile.async("string");
    const cleanedCt = ctXml.replace(/<Override\b([^>]*)\/>/g, (match) => {
      const attrs = parseAttrs(match.slice(9));
      const partName = attrs.PartName?.replace(/^\//, "") ?? "";
      return removedPaths.has(partName) ? "" : match;
    });
    zip.file(ctPath, cleanedCt);
  }
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];

  const xml = await file.async("string");
  const items = [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)];
  return items.map((item) => {
    const textParts = [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
    return textParts.map((part) => decodeXml(part[1])).join("");
  });
}

async function readWorkbookSheetPaths(zip: JSZip): Promise<Map<string, string>> {
  const workbook = await requiredText(zip, "xl/workbook.xml");
  const rels = await requiredText(zip, "xl/_rels/workbook.xml.rels");
  const relTargets = new Map<string, string>();

  for (const rel of rels.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attrs = parseAttrs(rel[1]);
    if (attrs.Id && attrs.Target) {
      relTargets.set(attrs.Id, normalizeXlsxPath("xl", attrs.Target));
    }
  }

  const out = new Map<string, string>();
  for (const sheet of workbook.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const attrs = parseAttrs(sheet[1]);
    const relId = attrs["r:id"];
    if (attrs.name && relId && relTargets.has(relId)) {
      out.set(decodeXml(attrs.name), relTargets.get(relId)!);
    }
  }

  return out;
}

async function readWorksheetTables(zip: JSZip, sheetPath: string): Promise<TableRef[]> {
  const relPath = `${path.posix.dirname(sheetPath)}/_rels/${path.posix.basename(sheetPath)}.rels`;
  const relFile = zip.file(relPath);
  if (!relFile) return [];

  const relXml = await relFile.async("string");
  const out: TableRef[] = [];

  for (const rel of relXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attrs = parseAttrs(rel[1]);
    if (!attrs.Target || !attrs.Type?.endsWith("/table")) continue;

    const tablePath = normalizeXlsxPath(path.posix.dirname(sheetPath), attrs.Target);
    const tableFile = zip.file(tablePath);
    if (!tableFile) continue;

    const tableXml = await tableFile.async("string");
    const ref = parseRef(extractAttr(tableXml, "ref"));
    if (ref) out.push({ path: tablePath, ...ref });
  }

  return out;
}

function patchWorksheetXml(
  xml: string,
  sharedStrings: string[],
  patch: SheetPatch,
  tableRef: TableRef | null,
): { xml: string; tableRef: string } {
  const rows = parseRows(xml, sharedStrings);
  const headerRow = tableRef?.startRow ?? findHeaderRow(rows, patch.meta.identifyBy);
  const header = rows.find((row) => row.row === headerRow);

  if (!header) throw new Error(`Строка заголовков не найдена: ${patch.meta.sheet}`);

  const headers = new Map<number, string>();
  for (const [col, cell] of header.cells) {
    if (cell.value) headers.set(col, cell.value.trim());
  }

  const startCol = tableRef?.startCol ?? minHeaderCol(headers);
  const endCol = tableRef?.endCol ?? maxHeaderCol(headers);
  const dataStartRow = (tableRef?.startRow ?? headerRow + patch.meta.dataOffset - 1) + 1;
  const oldDataEndRow = tableRef?.endRow ?? findMaxRow(rows);
  const outputDataCount = Math.max(patch.rows.length, 1);
  const newDataEndRow = dataStartRow + outputDataCount - 1;
  const sample = findSampleRow(rows, dataStartRow, oldDataEndRow);
  const formulaTemplates = collectFormulaTemplates(rows, dataStartRow, oldDataEndRow);

  const beforeRows = rows
    .filter((row) => row.row < dataStartRow)
    .map((row) => row.xml)
    .join("");
  const afterRows = rows
    .filter((row) => row.row > oldDataEndRow)
    .map((row) => shiftRowXml(row.xml, row.row, row.row + newDataEndRow - oldDataEndRow))
    .join("");

  const generatedRows = Array.from({ length: outputDataCount }, (_, index) => {
    const rowNumber = dataStartRow + index;
    const rowData = patch.rows[index] ?? {};
    return buildDataRow({
      rowNumber,
      rowData,
      startCol,
      endCol,
      headers,
      sample,
      formulaTemplates,
    });
  }).join("");

  const sheetData = `<sheetData>${beforeRows}${generatedRows}${afterRows}</sheetData>`;
  const nextXml = xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, sheetData);
  const dimensionRef = `${colName(startCol)}1:${colName(endCol)}${Math.max(newDataEndRow, headerRow)}`;
  const withDimension = nextXml.replace(/<dimension\b[^>]*\/>/, `<dimension ref="${dimensionRef}"/>`);

  return {
    xml: withDimension,
    tableRef: `${colName(startCol)}${headerRow}:${colName(endCol)}${newDataEndRow}`,
  };
}

function buildDataRow(input: {
  rowNumber: number;
  rowData: ExcelRow;
  startCol: number;
  endCol: number;
  headers: Map<number, string>;
  sample: ParsedRow | null;
  formulaTemplates: Map<number, { formula: string; row: number; attrs: string }>;
}): string {
  const sampleRowAttrs = input.sample?.attrs ?? "";
  // Строка-образец могла быть скрыта сохранённым автофильтром шаблона —
  // снимаем hidden, иначе все сгенерированные строки будут невидимыми.
  const visibleSampleAttrs = sampleRowAttrs
    .replace(/\s+hidden="(?:1|true)"/g, "")
    .replace(/\s+collapsed="(?:1|true)"/g, "");
  const rowAttrs = replaceAttr(visibleSampleAttrs, "r", String(input.rowNumber));
  const cells: string[] = [];

  for (let col = input.startCol; col <= input.endCol; col++) {
    const header = input.headers.get(col);
    const hasValue = header ? Object.prototype.hasOwnProperty.call(input.rowData, header) : false;
    const sampleCell = input.sample?.cells.get(col);
    const formulaTemplate = input.formulaTemplates.get(col);

    if (hasValue && header) {
      cells.push(buildValueCell(input.rowNumber, col, input.rowData[header], sampleCell?.styleAttrs ?? ""));
      continue;
    }

    if (formulaTemplate) {
      const formula = shiftFormula(formulaTemplate.formula, formulaTemplate.row, input.rowNumber);
      cells.push(buildFormulaCell(input.rowNumber, col, formula, sampleCell?.styleAttrs ?? formulaTemplate.attrs));
      continue;
    }

    if (sampleCell?.styleAttrs) {
      cells.push(`<c r="${cellRef(input.rowNumber, col)}"${sampleCell.styleAttrs}/>`); 
    }
  }

  return `<row ${rowAttrs}>${cells.join("")}</row>`;
}

function buildValueCell(row: number, col: number, value: unknown, styleAttrs: string): string {
  const ref = cellRef(row, col);
  if (value == null || value === "") return `<c r="${ref}"${styleAttrs}/>`;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return `<c r="${ref}"${styleAttrs}/>`;
    return `<c r="${ref}"${styleAttrs}><v>${dateToExcelSerial(value)}</v></c>`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${styleAttrs}><v>${value}</v></c>`;
  }

  if (typeof value === "boolean") {
    return `<c r="${ref}" t="b"${styleAttrs}><v>${value ? 1 : 0}</v></c>`;
  }

  return `<c r="${ref}" t="inlineStr"${styleAttrs}><is><t>${escapeXml(String(value))}</t></is></c>`;
}

function buildFormulaCell(row: number, col: number, formula: string, styleAttrs: string): string {
  return `<c r="${cellRef(row, col)}"${styleAttrs}><f>${escapeXml(formula)}</f></c>`;
}

function parseRows(xml: string, sharedStrings: string[]): ParsedRow[] {
  const rows: ParsedRow[] = [];

  for (const match of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const attrs = match[1];
    const rowNumber = Number(parseAttrs(attrs).r);
    if (!Number.isFinite(rowNumber)) continue;

    const cells = new Map<number, Cell>();
    for (const cellMatch of match[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellAttrs = cellMatch[1];
      const body = cellMatch[2] ?? "";
      const parsedAttrs = parseAttrs(cellAttrs);
      if (!parsedAttrs.r) continue;

      const decodedRef = decodeCellRef(parsedAttrs.r);
      const styleAttrs = collectStyleAttrs(cellAttrs);
      const value = readCellValue(body, parsedAttrs.t, sharedStrings);
      const formula = readFormula(body);

      cells.set(decodedRef.col, {
        ref: parsedAttrs.r,
        col: decodedRef.col,
        row: decodedRef.row,
        attrs: cellAttrs,
        styleAttrs,
        value,
        formula,
      });
    }

    rows.push({
      row: rowNumber,
      attrs,
      xml: match[0],
      cells,
    });
  }

  return rows.sort((a, b) => a.row - b.row);
}

function readCellValue(body: string, type: string | undefined, sharedStrings: string[]): string | null {
  if (type === "s") {
    const rawIndex = extractTag(body, "v");
    const index = rawIndex == null ? -1 : Number(rawIndex);
    return sharedStrings[index] ?? null;
  }

  if (type === "inlineStr") {
    return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((match) => decodeXml(match[1]))
      .join("");
  }

  const value = extractTag(body, "v");
  return value == null ? null : decodeXml(value);
}

function readFormula(body: string): string | null {
  const match = body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/);
  return match ? decodeXml(match[1]) : null;
}

function collectFormulaTemplates(
  rows: ParsedRow[],
  dataStartRow: number,
  oldDataEndRow: number,
): Map<number, { formula: string; row: number; attrs: string }> {
  const formulas = new Map<number, { formula: string; row: number; attrs: string }>();

  for (const row of rows) {
    if (row.row < dataStartRow || row.row > oldDataEndRow) continue;

    for (const [col, cell] of row.cells) {
      if (!cell.formula || formulas.has(col)) continue;
      // Артефакт выгрузки Google Sheets: нерасчётная заглушка с захардкоженным
      // кэш-значением. Если её копировать, все строки получат одно и то же
      // значение из строки-образца — поэтому такие формулы не переносим.
      if (cell.formula.includes("__xludf.DUMMYFUNCTION")) continue;
      formulas.set(col, { formula: cell.formula, row: row.row, attrs: cell.styleAttrs });
    }
  }

  return formulas;
}

function tableCoversHeader(
  worksheetXml: string,
  sharedStrings: string[],
  table: TableRef,
  identifyBy: string,
): boolean {
  const rows = parseRows(worksheetXml, sharedStrings);
  const header = rows.find((row) => row.row === table.startRow);
  return [...(header?.cells.values() ?? [])].some((cell) => cell.value?.trim() === identifyBy);
}

function findHeaderRow(rows: ParsedRow[], identifyBy: string): number {
  const row = rows.find((item) =>
    [...item.cells.values()].some((cell) => cell.value?.trim() === identifyBy),
  );
  if (!row) throw new Error(`Колонка "${identifyBy}" не найдена`);
  return row.row;
}

function findSampleRow(rows: ParsedRow[], dataStartRow: number, oldDataEndRow: number): ParsedRow | null {
  return rows.find((row) => row.row >= dataStartRow && row.row <= oldDataEndRow) ?? null;
}

async function patchTableXml(zip: JSZip, tablePath: string, ref: string): Promise<void> {
  const file = zip.file(tablePath);
  if (!file) return;

  const xml = await file.async("string");
  let next = xml.replace(/(<table\b[^>]*\bref=")[^"]+(")/, `$1${ref}$2`);

  // autoFilter обязан совпадать с ref таблицы, иначе Excel считает таблицу
  // повреждённой и убирает формат «умной таблицы». Сохранённые критерии
  // фильтра (<filterColumn>) тоже сбрасываем — иначе часть строк будет скрыта.
  next = next.replace(
    /<autoFilter\b[^>]*?(?:\/>|>[\s\S]*?<\/autoFilter>)/,
    `<autoFilter ref="${ref}"/>`,
  );

  zip.file(tablePath, next);
}

async function removeCalcChain(zip: JSZip): Promise<void> {
  zip.remove("xl/calcChain.xml");

  const relPath = "xl/_rels/workbook.xml.rels";
  const relFile = zip.file(relPath);
  if (relFile) {
    const rels = await relFile.async("string");
    zip.file(relPath, rels.replace(/<Relationship\b[^>]*Target="calcChain\.xml"[^>]*\/>/g, ""));
  }

  const contentPath = "[Content_Types].xml";
  const contentFile = zip.file(contentPath);
  if (contentFile) {
    const content = await contentFile.async("string");
    zip.file(
      contentPath,
      content.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/g, ""),
    );
  }
}

async function forceFullRecalculation(zip: JSZip): Promise<void> {
  const workbookPath = "xl/workbook.xml";
  const workbook = await requiredText(zip, workbookPath);
  const calcPr = '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>';

  const next = workbook.includes("<calcPr")
    ? workbook.replace(/<calcPr\b[^>]*\/>/, calcPr).replace(/<calcPr\b[^>]*>[\s\S]*?<\/calcPr>/, calcPr)
    : workbook.replace("</workbook>", `${calcPr}</workbook>`);

  zip.file(workbookPath, next);
}

async function requiredText(zip: JSZip, filePath: string): Promise<string> {
  const file = zip.file(filePath);
  if (!file) throw new Error(`Файл ${filePath} не найден в шаблоне`);
  return file.async("string");
}

function parseRef(ref: string | null): Omit<TableRef, "path"> | null {
  if (!ref) return null;
  const [start, end] = ref.split(":");
  if (!start || !end) return null;

  const startCell = decodeCellRef(start);
  const endCell = decodeCellRef(end);
  return {
    startCol: startCell.col,
    startRow: startCell.row,
    endCol: endCell.col,
    endRow: endCell.row,
  };
}

function parseAttrs(attrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of attrs.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    out[match[1]] = decodeXml(match[2]);
  }
  return out;
}

function collectStyleAttrs(attrs: string): string {
  const parsed = parseAttrs(attrs);
  const parts: string[] = [];
  for (const name of ["s", "cm", "vm", "ph"]) {
    if (parsed[name] != null) parts.push(`${name}="${escapeXml(parsed[name])}"`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function replaceAttr(attrs: string, name: string, value: string): string {
  if (new RegExp(`\\b${name}="`).test(attrs)) {
    return attrs.replace(new RegExp(`\\b${name}="[^"]*"`), `${name}="${value}"`);
  }
  return `${name}="${value}"${attrs ? ` ${attrs.trim()}` : ""}`;
}

function extractAttr(xml: string, attr: string): string | null {
  const match = xml.match(new RegExp(`\\b${attr}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1] : null;
}

function shiftFormula(formula: string, fromRow: number, toRow: number): string {
  if (fromRow === toRow) return formula;
  return formula.replace(
    new RegExp(`(\\$?[A-Z]{1,3})\\$?${fromRow}(?!\\d)`, "g"),
    (_match, col: string) => `${col}${toRow}`,
  );
}

function shiftRowXml(xml: string, fromRow: number, toRow: number): string {
  if (fromRow === toRow) return xml;
  const shifted = xml
    .replace(new RegExp(`\\br="${fromRow}"`), `r="${toRow}"`)
    .replace(new RegExp(`(\\$?[A-Z]{1,3})\\$?${fromRow}(?!\\d)`, "g"), `$1${toRow}`);
  return shifted;
}

function minHeaderCol(headers: Map<number, string>): number {
  return Math.min(...headers.keys());
}

function maxHeaderCol(headers: Map<number, string>): number {
  return Math.max(...headers.keys());
}

function findMaxRow(rows: ParsedRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.row), 1);
}

function colName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function colIndex(name: string): number {
  let out = 0;
  for (const char of name) {
    out = out * 26 + char.charCodeAt(0) - 64;
  }
  return out - 1;
}

function cellRef(row: number, col: number): string {
  return `${colName(col)}${row}`;
}

function decodeCellRef(ref: string): { col: number; row: number } {
  const match = ref.match(/^(\$?[A-Z]+)\$?(\d+)$/);
  if (!match) throw new Error(`Некорректная ссылка ячейки: ${ref}`);
  return {
    col: colIndex(match[1].replace("$", "")),
    row: Number(match[2]),
  };
}

function dateToExcelSerial(date: Date): number {
  return (date.getTime() - EXCEL_EPOCH) / MS_PER_DAY;
}

function normalizeXlsxPath(baseDir: string, target: string): string {
  const raw = target.startsWith("/") ? target.slice(1) : path.posix.join(baseDir, target);
  return path.posix.normalize(raw).replace(/^\/+/, "");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
