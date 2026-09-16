import { Suspense } from "react";
import { ClientsClient } from "./ClientsClient";

export default function Page() {
  return (
    <Suspense>
      <ClientsClient />
    </Suspense>
  );
}
