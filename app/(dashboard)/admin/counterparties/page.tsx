import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { CounterpartiesClient } from "./CounterpartiesClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) redirect("/login");

  const [executors, clients, bankAccounts] = await Promise.all([
    prisma.executor.findMany({
      select: { id: true, name: true, status: true, type: true },
      orderBy: { name: "asc" },
    }),
    prisma.client.findMany({
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
    prisma.bankAccount.findMany({
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <CounterpartiesClient executors={executors} clients={clients} bankAccounts={bankAccounts} />
  );
}
