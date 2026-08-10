export type SpendingPlanValue = {
  amount: number;
  comment: string | null;
  sourceType: string | null;
};

export type SpendingPlanPatch = {
  amount?: number;
  comment?: string | null;
  sourceType?: string | null;
};

/**
 * Объединяет исторические дубли одной ячейки плана.
 * Явная сумма заменяет общий итог, а изменение комментария сохраняет итог суммы.
 */
export function mergeSpendingPlanValues(
  rows: SpendingPlanValue[],
  patch: SpendingPlanPatch
): SpendingPlanValue {
  const existingAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const existingComment =
    rows.find((row) => row.comment?.trim())?.comment?.trim() ?? null;
  const existingSourceType =
    rows.find((row) => row.sourceType)?.sourceType ?? null;

  return {
    amount: patch.amount ?? existingAmount,
    comment:
      patch.comment !== undefined
        ? patch.comment?.trim() || null
        : existingComment,
    sourceType:
      patch.sourceType !== undefined ? patch.sourceType : existingSourceType,
  };
}
