import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { loadOtherExpenseFormOptions } from "@/lib/services/other-expense-form-options";
import { OtherExpensesClient } from "./OtherExpensesClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) redirect("/login");

  const options = await loadOtherExpenseFormOptions();

  return (
    <OtherExpensesClient
      stateScope="admin"
      isAdmin={true}
      userId={user.id}
      executorId={user.executorId ?? null}
      {...options}
    />
  );
}
