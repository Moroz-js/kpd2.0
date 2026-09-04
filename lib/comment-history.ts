export const CASHFLOW_COMMENT_ACTIVITY_ENTITY_TYPE = "CashflowCellComment";
export const SPENDING_PLAN_COMMENT_ACTIVITY_ENTITY_TYPE = "SpendingPlanLineComment";
export const AUTOMATIC_ACTIVITY_ACTION = "auto_update";

export function cashflowCommentActivityId(
  year: number,
  week: number,
  rowKey: string
) {
  return `${year}:${week}:${rowKey}`;
}

export function spendingPlanCommentActivityId(input: {
  projectId: string;
  executorId: string;
  workTypeId: string;
  year: number;
  week: number;
}) {
  return [
    input.projectId,
    input.executorId,
    input.workTypeId,
    input.year,
    input.week,
  ].join(":");
}

export function commentActivityAuthorName(action: string, userName: string) {
  return action === AUTOMATIC_ACTIVITY_ACTION ? "Авто" : userName;
}
