export function cashflowCommentMapKey(rowKey: string, year: number, week: number) {
  return `${rowKey}_${year}_${week}`;
}

export const CASHFLOW_HIGHLIGHT_IDS = ["yellow", "green", "red"] as const;
export type CashflowHighlightId = (typeof CASHFLOW_HIGHLIGHT_IDS)[number];

export type CashflowCellMeta = {
  text: string;
  highlight: CashflowHighlightId | null;
};

export const CASHFLOW_HIGHLIGHTS: Record<
  CashflowHighlightId,
  { label: string; swatch: string; cellClass: string }
> = {
  yellow: {
    label: "Жёлтый",
    swatch: "bg-yellow-300 border-yellow-400",
    cellClass: "bg-yellow-100",
  },
  green: {
    label: "Зелёный",
    swatch: "bg-green-300 border-green-400",
    cellClass: "bg-green-100",
  },
  red: {
    label: "Красный",
    swatch: "bg-rose-300 border-rose-400",
    cellClass: "bg-rose-100",
  },
};

export function cashflowHighlightCellClass(
  highlight: string | null | undefined
): string | undefined {
  if (!highlight || !(highlight in CASHFLOW_HIGHLIGHTS)) return undefined;
  return CASHFLOW_HIGHLIGHTS[highlight as CashflowHighlightId].cellClass;
}
