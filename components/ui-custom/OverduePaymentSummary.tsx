import { formatMoneyRub } from "@/lib/format";
import { cn } from "@/lib/utils";

export function OverduePaymentSummary({ amount }: { amount: number }) {
  return (
    <span
      className={cn(
        "text-xs font-medium tabular-nums whitespace-nowrap",
        amount === 0 ? "text-neutral-400" : "text-red-600"
      )}
    >
      Не закрыто {formatMoneyRub(amount)}
    </span>
  );
}
