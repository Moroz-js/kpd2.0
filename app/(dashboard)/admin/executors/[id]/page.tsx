import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canViewExecutorEstimate, isAdmin } from "@/lib/permissions";
import { ExecutorEstimateClient } from "./ExecutorEstimateClient";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; fromProject?: string }>;
}) {
  const { id } = await params;
  const { tab, fromProject } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const allowed = isAdmin(user) || (await canViewExecutorEstimate(user, id));
  if (!allowed) redirect("/");

  const backHref = fromProject
    ? isAdmin(user)
      ? `/admin/projects/${fromProject}`
      : `/responsible/projects/${fromProject}`
    : isAdmin(user)
      ? "/admin/executors"
      : undefined;

  return (
    <ExecutorEstimateClient
      executorId={id}
      viewerRole={user.role}
      viewerExecutorId={user.executorId}
      viewerIsSuperAdmin={user.isSuperAdmin ?? false}
      backHref={backHref}
      initialTab={tab}
    />
  );
}
