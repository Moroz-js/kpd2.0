import { STATEMENT_FORMATS, type StatementFormat } from "@/lib/statuses";

export const BANK_COUNTRIES = STATEMENT_FORMATS;
export type BankCountry = StatementFormat;

export const DEFAULT_BANKS: { name: string; country: BankCountry }[] = [
  { name: "Сбербанк", country: "ru" },
  { name: "Тинькофф", country: "ru" },
  { name: "Альфа-Банк", country: "ru" },
  { name: "ВТБ", country: "ru" },
  { name: "Газпромбанк", country: "ru" },
  { name: "Райффайзенбанк", country: "ru" },
  { name: "Открытие", country: "ru" },
  { name: "Совкомбанк", country: "ru" },
  { name: "ПСБ", country: "ru" },
  { name: "Точка", country: "ru" },
  { name: "Модульбанк", country: "ru" },
  { name: "Озон Банк", country: "ru" },
  { name: "Яндекс Банк", country: "ru" },
  { name: "Kaspi Bank", country: "kz" },
  { name: "Halyk Bank", country: "kz" },
  { name: "Банк ЦентрКредит", country: "kz" },
  { name: "ForteBank", country: "kz" },
  { name: "Jusan Bank", country: "kz" },
  { name: "Bereke Bank", country: "kz" },
  { name: "CKB", country: "me" },
  { name: "NLB Banka", country: "me" },
  { name: "Hipotekarna banka", country: "me" },
  { name: "Prva banka", country: "me" },
  { name: "Adriatic Bank", country: "me" },
  { name: "Erste Bank", country: "me" },
  { name: "Lovćen banka", country: "me" },
  { name: "Addiko Bank", country: "me" },
];

export function isBankCountry(value: string): value is BankCountry {
  return value in BANK_COUNTRIES;
}
