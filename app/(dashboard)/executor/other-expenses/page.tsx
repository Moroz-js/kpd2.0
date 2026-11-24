import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canAccessOtherExpenses } from "@/lib/permissions";
import { loadOtherExpenseFormOptions } from "@/lib/services/other-expense-form-options";
import { OtherExpensesClient } from "@/app/(dashboard)/admin/other-expenses/OtherExpensesClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user || !canAccessOtherExpenses(user)) redirect("/login");

  const options = await loadOtherExpenseFormOptions();

  return (
    <OtherExpensesClient
      stateScope="executor"
      isAdmin={false}
      userId={user.id}
      executorId={user.executorId ?? null}
      {...options}
    />
  );
}
