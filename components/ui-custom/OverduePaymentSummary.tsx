import { formatMoneyRub } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

  const summary = onClick ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={className}
        onClick={onClick}
        aria-pressed={active}
      >
        Не закрыто {formatMoneyRub(amount)}
      </Button>
  ) : (
    <span className={className}>
      Не закрыто {formatMoneyRub(amount)}
    </span>
  );

  return (
    <span className="inline-flex items-center gap-1.5">
      {summary}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            className="inline-flex size-4 items-center justify-center rounded-full text-neutral-400 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Что означает сумма «Не закрыто»"
          >
            <Info className="size-3.5" aria-hidden />
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            Сумма неоплаченных записей с прошедшей датой оплаты: фактической или плановой,
            если фактическая не указана. Нажмите на сумму, чтобы показать эти записи.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}
