import { Suspense } from "react";
import { BankAccountsClient } from "./BankAccountsClient";

export default function Page() {
  return (
    <Suspense>
      <BankAccountsClient />
    </Suspense>
  );
}
