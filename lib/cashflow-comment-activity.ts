import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/audit/log";
import { buildCashflowYears, loadCashflowTables } from "@/lib/services/cashflow";
import { cashflowCommentActivityId } from "@/lib/comment-history";

type CommentedCellValue = {
  year: number;
  week: number;
  rowKey: string;
  value: number | null;
};

export type CashflowCommentValues = Map<string, CommentedCellValue>;

function cellId(year: number, week: number, rowKey: string) {
  return `${year}:${week}:${rowKey}`;
}

/**
 * Снимает только значения ячеек, к которым прикреплены комментарии. Вызывается
 * до и после мутации источников, а не при чтении кэшфлоу.
 */
export async function captureCashflowCommentValues(): Promise<CashflowCommentValues> {
  try {
    const comments = await prisma.cashflowCellComment.findMany({
      where: {
        OR: [{ text: { not: "" } }, { highlight: { not: null } }],
      },
      select: { year: true, week: true, rowKey: true },
    });
    if (comments.length === 0) return new Map();

    const years = [...new Set(comments.map((comment) => comment.year))];
    const tables = await loadCashflowTables(prisma);
    const yearData = buildCashflowYears(tables, years);
    const values: CashflowCommentValues = new Map();
    for (const [year, data] of yearData) {
      const { weeksInYear } = data;
      const summary: Record<string, (number | null)[]> = {
        ...data.summary, balanceInAccounts: data.balanceInAccounts,
        discrepancy: data.discrepancy, discrepancyDPFact: data.discrepancyDPFact,
      };
      const aggregates: Record<string, number[]> = data.aggregates;
      const projects = new Map(data.projects.map((project) => [project.id, project]));

      for (const comment of comments) {
        if (comment.year !== year || comment.week < 1 || comment.week > weeksInYear) continue;
        const index = comment.week - 1;
        let value: number | null | undefined;
        if (comment.rowKey.startsWith("summary:")) {
          value = summary[comment.rowKey.slice("summary:".length)]?.[index];
        } else if (comment.rowKey.startsWith("aggregate:")) {
          value = aggregates[comment.rowKey.slice("aggregate:".length)]?.[index];
        } else {
          const match = /^project:(.+):(plan|iw|charges)$/.exec(comment.rowKey);
          if (match) {
            const [, projectId, kind] = match;
            value = projects.get(projectId)?.[kind as "plan" | "iw" | "charges"][index] ?? 0;
          }
        }
        if (value === undefined) continue;
        values.set(cellId(comment.year, comment.week, comment.rowKey), {
          ...comment,
          value,
        });
      }
    }

    return values;
  } catch {
    // История комментариев не должна делать основную мутацию недоступной.
    return new Map();
  }
}

export async function logCashflowCommentValueChanges(
  before: CashflowCommentValues,
  userId: string,
  skip?: (cell: CommentedCellValue) => boolean
) {
  if (before.size === 0) return;
  const after = await captureCashflowCommentValues();
  await Promise.all(
    [...before].flatMap(([id, previous]) => {
      const next = after.get(id);
      if (!next || skip?.(previous) || Object.is(previous.value, next.value)) return [];
      return logActivity({
        userId,
        action: "auto_update",
        entityType: "CashflowCellComment",
        entityId: cashflowCommentActivityId(previous.year, previous.week, previous.rowKey),
        entityLabel: `Кэшфлоу · нед. ${previous.week} / ${previous.year}`,
        changes: { value: { from: previous.value, to: next.value } },
      });
    })
  );
}
