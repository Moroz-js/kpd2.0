import { moscowDateKey } from "@/lib/iso-weeks";

export type PayableRecord = {
  status: string | null | undefined;
  paidAt: string | Date | null | undefined;
  plannedPayAt: string | Date | null | undefined;
  amount: number | null | undefined;
};

function dateKey(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return moscowDateKey(date);
}

/** Неоплаченная запись с датой оплаты план-факт до сегодняшнего дня (МСК). */
export function isOverduePayment(record: Omit<PayableRecord, "amount">): boolean {
  if (record.status === "paid") return false;
  const effectiveDate = record.paidAt ?? record.plannedPayAt;
  if (!effectiveDate) return false;
  const key = dateKey(effectiveDate);
  return key !== null && key < moscowDateKey();
}

export function overduePaymentTotal(records: PayableRecord[]): number {
  return records.reduce(
    (total, record) => total + (isOverduePayment(record) ? record.amount ?? 0 : 0),
    0
  );
}
