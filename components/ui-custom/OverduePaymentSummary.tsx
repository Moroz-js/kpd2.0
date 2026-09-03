import { formatMoneyRub } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type OverduePaymentSummaryProps = {
  amount: number;
  onClick?: () => void;
  active?: boolean;
};

export function OverduePaymentSummary({
  amount,
  onClick,
  active = false,
}: OverduePaymentSummaryProps) {
  const className = cn(
    "h-auto p-0 text-sm font-semibold tabular-nums whitespace-nowrap",
    amount === 0 ? "text-neutral-400" : "text-red-600",
    onClick && "hover:underline focus-visible:ring-1 focus-visible:ring-offset-2",
  );

  if (onClick) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={className}
        onClick={onClick}
        aria-pressed={active}
        title="Показать неоплаченные записи с просроченной датой оплаты"
      >
        Не закрыто {formatMoneyRub(amount)}
      </Button>
    );
  }

  return (
    <span className={className}>
      Не закрыто {formatMoneyRub(amount)}
    </span>
  );
}
