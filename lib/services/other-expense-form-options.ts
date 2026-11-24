import { prisma } from "@/lib/db";
import { executorWhereForOtherExpense } from "@/lib/executor-personal-estimate";
import { listActivePermanentExecutors } from "@/lib/services/executors";
import { listActiveProjectsWithManagerExecutor } from "@/lib/services/projects";

/** Same selectable references in the source editor and when opened from a project. */
export async function loadOtherExpenseFormOptions() {
  const ref = { id: true, name: true } as const;
  const orderBy = { name: "asc" } as const;
  const [projects, executors, workTypes, permanentExecutors, bankAccounts] = await Promise.all([
    listActiveProjectsWithManagerExecutor(),
    prisma.executor.findMany({ where: executorWhereForOtherExpense, select: ref, orderBy }),
    prisma.workType.findMany({ where: { status: "active" }, select: { ...ref, segment: true }, orderBy }),
    listActivePermanentExecutors(),
    prisma.bankAccount.findMany({ where: { status: "active" }, select: ref, orderBy }),
  ]);
  return { projects, executors, workTypes, permanentExecutors, bankAccounts };
}
