import type { PrismaClient } from "@prisma/client";
import { canEditOtherExpense, canEditWork, isAdmin, type SessionLike } from "@/lib/permissions";
import { loadOtherExpenseFormOptions } from "@/lib/services/other-expense-form-options";
import type { IssuedWorkSource } from "@/lib/views/issuedWorks";

const ref = { select: { id: true, name: true } } as const;
const common = {
  id: true, projectId: true, project: ref, executorId: true, executor: ref,
  workTypeId: true, workType: ref, executionYear: true, executionMonth: true,
  responsibleExecutorId: true, responsibleExecutor: ref, amount: true, plannedPayAt: true,
  workStatus: true, comment: true,
} as const;

type NameRef = { id: string; name: string };
const nameRef = ({ id, name }: NameRef) => ({ id, name });

// Snapshot adapters may include additional raw columns when resolving a relation.
// Construct the wire record explicitly; never spread a Prisma/snapshot row into the response.
function formValues(row: {
  id: string; projectId: string; project: NameRef; workTypeId: string; workType: NameRef;
  executionYear: number; executionMonth: number; responsibleExecutorId: string | null;
  responsibleExecutor: NameRef | null; amount: number; plannedPayAt: Date | string | null;
  workStatus: string; comment: string | null;
}) {
  return {
    id: row.id, projectId: row.projectId, project: nameRef(row.project),
    workTypeId: row.workTypeId, workType: nameRef(row.workType),
    executionYear: row.executionYear, executionMonth: row.executionMonth,
    responsibleExecutorId: row.responsibleExecutorId,
    responsibleExecutor: row.responsibleExecutor ? nameRef(row.responsibleExecutor) : null,
    amount: row.amount, plannedPayAt: row.plannedPayAt ? new Date(row.plannedPayAt).toISOString() : null,
    workStatus: row.workStatus, comment: row.comment,
  };
}

function editorMode(readOnly: boolean, paid: boolean, canEditSource: boolean) {
  return readOnly || paid ? "view" : canEditSource ? "source" : "review";
}

/** Called only after checking the live project ACL. Verify membership again in the selected data source. */
export async function getProjectWorkEditor(db: Pick<PrismaClient, "work" | "otherExpense">, projectId: string,
  sourceType: IssuedWorkSource, id: string, user: SessionLike, readOnly: boolean) {
  const where = { id, projectId };
  const admin = isAdmin(user);
  if (sourceType === "personal") {
    const row = await db.work.findUnique({ where, select: {
      ...common, techTask: true, volume: true, rate: true, link: true, report: true, paymentId: true,
    } });
    if (!row) return null;
    return {
      sourceType, isAdmin: admin, mode: editorMode(readOnly, row.workStatus === "paid", canEditWork(user, row)),
      executorId: row.executorId, executorName: row.executor.name,
      initial: { ...formValues(row), techTask: row.techTask, volume: row.volume, rate: row.rate,
        link: row.link, report: row.report, paymentId: row.paymentId },
    } as const;
  }
  const row = await db.otherExpense.findUnique({ where, select: {
    ...common, description: true, paymentAmount: true, preferredPayMethod: true, bankAccountId: true,
    bankAccount: ref, paymentStatus: true, createdById: true,
  } });
  if (!row) return null;
  const mode = editorMode(readOnly, row.workStatus === "paid" || row.paymentStatus === "paid", canEditOtherExpense(user, row));
  return {
    sourceType, isAdmin: admin, mode,
    canRework: admin || (!!user.executorId && user.executorId === row.responsibleExecutorId),
    options: mode === "source" ? await loadOtherExpenseFormOptions() : null,
    initial: { ...formValues(row), executorId: row.executorId, executor: nameRef(row.executor),
      description: row.description, paymentAmount: row.paymentAmount, preferredPayMethod: row.preferredPayMethod,
      bankAccountId: row.bankAccountId, bankAccount: row.bankAccount ? nameRef(row.bankAccount) : null,
      paymentStatus: row.paymentStatus },
  } as const;
}

export type ProjectWorkEditorData = NonNullable<Awaited<ReturnType<typeof getProjectWorkEditor>>>;
