import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { NavigationProgress } from "@/components/layout/NavigationProgress";
import { prisma } from "@/lib/db";
import {
  PersistedDashboardMain,
  PersistedInterfaceStateProvider,
} from "@/components/PersistedInterfaceState";
import { ComparisonProvider } from "@/components/ComparisonProvider";
import { Suspense } from "react";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  const { role, fullName, id: userId, isSuperAdmin, executorId, executorType, isResponsible: isResponsibleFlag, responsibleActive } = sessionUser;

  const isPm =
    role === "responsible" ||
    (role === "executor" && isResponsibleFlag && responsibleActive);
  const isPermanentExecutor = role === "executor" && executorType === "permanent";
  const hasProfile = !!executorId;

  let hasProjects = true;
  if (isPm) {
    const count = await prisma.project.count({ where: { responsibleUserId: userId } });
    hasProjects = count > 0;
  }

  return (
    <PersistedInterfaceStateProvider userId={userId}>
      <div className="flex h-screen overflow-hidden bg-neutral-50">
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <Suspense fallback={null}>
          <Sidebar
            role={role}
            fullName={fullName}
            userId={userId}
            isSuperAdmin={isSuperAdmin ?? false}
            hasProjects={hasProjects}
            isPm={isPm}
            isPermanentExecutor={isPermanentExecutor}
            hasProfile={hasProfile}
          />
        </Suspense>
        <ComparisonProvider>
          <PersistedDashboardMain>{children}</PersistedDashboardMain>
        </ComparisonProvider>
      </div>
    </PersistedInterfaceStateProvider>
  );
}
