import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isAdmin, isResponsible } from "@/lib/permissions";
import { loadOtherExpenseFormOptions } from "@/lib/services/other-expense-form-options";
import { OtherExpensesClient } from "@/app/(dashboard)/admin/other-expenses/OtherExpensesClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user || (!isAdmin(user) && !isResponsible(user))) redirect("/login");

  const options = await loadOtherExpenseFormOptions();

  return (
    <OtherExpensesClient
      stateScope="responsible"
      isAdmin={isAdmin(user)}
      userId={user.id}
      executorId={user.executorId ?? null}
      {...options}
    />
  );
}
