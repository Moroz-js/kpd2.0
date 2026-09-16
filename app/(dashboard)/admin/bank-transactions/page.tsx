import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { BankTransactionsClient } from "./BankTransactionsClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) redirect("/login");

  // Списки исполнителей, клиентов и счетов нужны, чтобы контрагента можно было
  // создать прямо из карточки операции.
  const [bankAccounts, projects, workTypes, executors, clients] = await Promise.all([
    prisma.bankAccount.findMany({
      select: { id: true, name: true, status: true, statementFormat: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.workType.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.executor.findMany({
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
    prisma.client.findMany({
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <BankTransactionsClient
      bankAccounts={bankAccounts}
      projects={projects}
      workTypes={workTypes}
      executorOptions={executors}
      clientOptions={clients}
      bankAccountOptions={bankAccounts}
    />
  );
}
