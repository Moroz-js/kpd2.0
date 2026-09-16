/**
 * Форматы выписки. Россия, Казахстан и Черногория приходят разными колонками —
 * ветка (поступление / списание) определяется по-разному.
 */

import { STATEMENT_FORMATS, type StatementFormat } from "@/lib/statuses";

export type { StatementFormat };

export type StatementFieldLabels = {
  taxId: string;
  account: string;
  bic: string;
  operationType: string;
};

type FormatRule = {
  id: StatementFormat;
  label: string;
  fields: StatementFieldLabels;
  incomingMarkers: string[];
  outgoingMarkers: string[];
  description: string;
};

export const STATEMENT_FORMAT_RULES: Record<StatementFormat, FormatRule> = {
  ru: {
    id: "ru",
    label: STATEMENT_FORMATS.ru,
    fields: {
      taxId: "ИНН",
      account: "Счёт",
      bic: "БИК",
      operationType: "Тип операции",
    },
    incomingMarkers: ["поступление", "зачисление", "пополнение", "credit", "к", "ct"],
    outgoingMarkers: ["списание", "платёж", "платеж", "оплата", "дебет", "debit", "д", "dt"],
    description: "Стандартная российская выписка: тип операции или знак суммы.",
  },
  kz: {
    id: "kz",
    label: STATEMENT_FORMATS.kz,
    fields: {
      taxId: "ИИН / БИН",
      account: "ИИК",
      bic: "БИК / БСК",
      operationType: "Дт / Кт",
    },
    incomingMarkers: ["зачисление", "пополнение", "кт", "кредит", "credit", "к"],
    outgoingMarkers: ["списание", "дт", "дебет", "дебит", "debit", "д"],
    description: "Казахстанская выписка: колонки Дт/Кт и ИИК вместо расчётного счёта.",
  },
  me: {
    id: "me",
    label: STATEMENT_FORMATS.me,
    fields: {
      taxId: "PIB",
      account: "IBAN",
      bic: "SWIFT",
      operationType: "Uplata / Isplata",
    },
    incomingMarkers: ["uplata", "incoming", "credit", "in"],
    outgoingMarkers: ["isplata", "outgoing", "debit", "out", "payment"],
    description: "Черногорская выписка: IBAN/SWIFT и uplata/isplata вместо поступления/списания.",
  },
};

export function isStatementFormat(value: string | null | undefined): value is StatementFormat {
  return value === "ru" || value === "kz" || value === "me";
}

export function resolveStatementFormat(value: string | null | undefined): StatementFormat {
  return isStatementFormat(value) ? value : "ru";
}

function normalizeMarker(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'.,:;()]/g, "")
    .replace(/\s+/g, " ");
}

function matchesMarker(haystack: string, markers: string[]): boolean {
  const normalized = normalizeMarker(haystack);
  if (!normalized) return false;
  return markers.some((marker) => {
    const token = normalizeMarker(marker);
    if (!token) return false;
    if (normalized === token) return true;
    if (token.length >= 3) return normalized.includes(token);
    return normalized.split(/[\s/]+/).includes(token);
  });
}

function amountSign(amount: string | number | null | undefined): "incoming" | "outgoing" | null {
  if (amount == null || amount === "") return null;
  const numeric =
    typeof amount === "number" ? amount : Number(String(amount).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(numeric) || numeric === 0) return null;
  return numeric < 0 ? "outgoing" : "incoming";
}

/**
 * Как определить ветку по сырому полю выписки.
 * Сначала тип операции формата, затем знак суммы. null — человек должен разобрать.
 */
export function determineOperationKind(
  format: string | null | undefined,
  raw: { operationType?: string | null; amount?: string | number | null }
): "incoming" | "outgoing" | null {
  const rule = STATEMENT_FORMAT_RULES[resolveStatementFormat(format)];
  const type = raw.operationType?.trim() ?? "";
  if (type) {
    if (matchesMarker(type, rule.incomingMarkers)) return "incoming";
    if (matchesMarker(type, rule.outgoingMarkers)) return "outgoing";
  }
  return amountSign(raw.amount);
}

export function statementFieldLabels(format: string | null | undefined): StatementFieldLabels {
  return STATEMENT_FORMAT_RULES[resolveStatementFormat(format)].fields;
}
