import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_ACTIVITY_ACTION,
  cashflowCommentActivityId,
  commentActivityAuthorName,
  spendingPlanCommentActivityId,
} from "../lib/comment-history";

describe("comment history identifiers", () => {
  it("creates stable identifiers for cashflow cells", () => {
    expect(cashflowCommentActivityId(2026, 12, "summary:incomeFact"))
      .toBe("2026:12:summary:incomeFact");
  });

  it("creates stable identifiers for spending-plan cells", () => {
    expect(
      spendingPlanCommentActivityId({
        projectId: "project-1",
        executorId: "executor-1",
        workTypeId: "work-type-1",
        year: 2026,
        week: 12,
      })
    ).toBe("project-1:executor-1:work-type-1:2026:12");
  });

  it("marks derived automatic events as Авто", () => {
    expect(commentActivityAuthorName(AUTOMATIC_ACTIVITY_ACTION, "Иван Иванов"))
      .toBe("Авто");
    expect(commentActivityAuthorName("update", "Иван Иванов"))
      .toBe("Иван Иванов");
  });
});
