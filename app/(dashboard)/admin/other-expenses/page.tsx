import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { executorWhereForOtherExpense } from "@/lib/executor-personal-estimate";
import { listActivePermanentExecutors } from "@/lib/services/executors";
import { listActiveProjectsWithManagerExecutor } from "@/lib/services/projects";
import { OtherExpensesClient } from "./OtherExpensesClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) redirect("/login");

  const [projects, executors, workTypes, permanentExecutors, bankAccounts] = await Promise.all([
    listActiveProjectsWithManagerExecutor(),
    prisma.executor.findMany({ where: executorWhereForOtherExpense, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.workType.findMany({ where: { status: "active" }, select: { id: true, name: true, segment: true }, orderBy: { name: "asc" } }),
    listActivePermanentExecutors(),
    prisma.bankAccount.findMany({ where: { status: "active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <OtherExpensesClient
      stateScope="admin"
      isAdmin={true}
      userId={user.id}
      executorId={user.executorId ?? null}
      projects={projects}
      executors={executors}
      workTypes={workTypes as { id: string; name: string; segment: string }[]}
      permanentExecutors={permanentExecutors}
      bankAccounts={bankAccounts}
    />
  );
}
