/**
 * Правила выплаты для прочих трат (одна запись = работа + выплата).
 */

export function hasOtherExpensePayment(paymentStatus: string | null | undefined): boolean {
  return paymentStatus != null;
}

/** Запланировано → проверено; оплачено → оплачено */
export function workStatusFromPaymentStatus(paymentStatus: string): "checked" | "paid" {
  if (paymentStatus === "planned") return "checked";
  return "paid";
}
