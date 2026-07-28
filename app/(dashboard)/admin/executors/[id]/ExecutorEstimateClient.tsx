"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorksTab } from "./WorksTab";
import { VacationsTab } from "./VacationsTab";
import { TasksTab } from "./TasksTab";
import { SettingsTab } from "./SettingsTab";
import { EXECUTOR_TYPES } from "@/lib/statuses";
import { normalizeExecutorType } from "@/lib/executor-type";
import { hasPersonalSmeta } from "@/lib/executor-personal-estimate";

type WorkType = { id: string; name: string };
type Project = { id: string; name: string; status: string };
type BankAccount = { id: string; name: string };

type ExecutorDetail = {
  id: string;
  name: string;
  type: string;
  status: string;
  accessRevokedAt: string | null;
  contacts: string | null;
  contactEmail: string | null;
  accessEmail: string | null;
  requisites: string | null;
  recipientType: string | null;
  defaultBankAccountId: string | null;
  oldEstimateUrl: string | null;
  specialties: string | null;
  companyStatus: string | null;
  contractFile: string | null;
  ndaFile: string | null;
  note: string | null;
  inTgChat: boolean;
  isResponsible: boolean;
  responsibleActive: boolean;
  onboardingSeeded: boolean;
  user: { id: string; email: string; fullName: string; role: string; isActive: boolean } | null;
  executorWorkTypes: { workType: WorkType }[];
  projectExecutors: { project: Project }[];
};

const TABS = [
  { id: "works", label: "Работы и Выплаты" },
  { id: "vacations", label: "График отпусков" },
  { id: "tasks", label: "Задачи" },
] as const;

type TabId = (typeof TABS)[number]["id"] | "settings";

type Props = {
  executorId: string;
  viewerRole: string; // admin | responsible | executor
  viewerExecutorId: string | null;
  viewerIsSuperAdmin?: boolean;
  backHref?: string;
  initialTab?: string;
  /** full — смета + настройки; settings-only — только настройки чужого исполнителя. */
  view?: "full" | "settings-only";
};

export function ExecutorEstimateClient({
  executorId,
  viewerRole,
  viewerExecutorId,
  viewerIsSuperAdmin = false,
  backHref,
  initialTab,
  view = "full",
}: Props) {
  const router = useRouter();
  const isAdmin = viewerRole === "admin";
  const isOwner = viewerExecutorId != null && viewerExecutorId === executorId;
  const settingsOnlyView = view === "settings-only" && !isOwner && !isAdmin;
  const canSeeSettings = isAdmin || isOwner || settingsOnlyView;

  const [executor, setExecutor] = useState<ExecutorDetail | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]); // виды работ исполнителя
  const [allWorkTypes, setAllWorkTypes] = useState<WorkType[]>([]); // все активные
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (initialTab === "settings") return "settings";
    return "works";
  });
  const [openTaskCount, setOpenTaskCount] = useState(0);

  const loadExecutor = useCallback(async () => {
    const r = await fetch(`/api/executors/${executorId}`);
    if (r.ok) setExecutor(await r.json());
  }, [executorId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadExecutor(),
      // Проекты исполнителя (из ProjectExecutor)
      fetch(`/api/executors/${executorId}`)
        .then((r) => r.json())
        .then((d: ExecutorDetail) => {
          const p = d.projectExecutors
            .filter((pe) => pe.project.status === "active")
            .map((pe) => pe.project);
          setProjects(p);
          const wt = d.executorWorkTypes.map((ewt) => ewt.workType);
          setWorkTypes(wt);
        }),
      fetch("/api/bank-accounts?status=active")
        .then((r) => r.json())
        .then((d: BankAccount[]) => setBankAccounts(d))
        .catch(() => {}),
      fetch("/api/work-types?status=active")
        .then((r) => r.json())
        .then((d: WorkType[]) => setAllWorkTypes(d))
        .catch(() => {}),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [executorId, loadExecutor]);

  // Полная перезагрузка данных
  const reload = useCallback(async () => {
    await loadExecutor();
    const r = await fetch(`/api/executors/${executorId}`);
    if (r.ok) {
      const d: ExecutorDetail = await r.json();
      const p = d.projectExecutors
        .filter((pe) => pe.project.status === "active")
        .map((pe) => pe.project);
      setProjects(p);
      const wt = d.executorWorkTypes.map((ewt) => ewt.workType);
      setWorkTypes(wt);
    }
    // Обновляем layout (сайдбар), чтобы имя отразилось сразу.
    router.refresh();
  }, [executorId, loadExecutor, router]);

  const hasPersonalEstimate =
    !settingsOnlyView &&
    executor != null &&
    hasPersonalSmeta(executor);
  const settingsOnly = !hasPersonalEstimate;

  const isPermanentType = executor != null && normalizeExecutorType(executor.type) === "permanent";
  // Внешний владелец не видит вкладку отпусков и "работы на проверку"
  const isExternalOwner = isOwner && !isAdmin && !isPermanentType;

  useEffect(() => {
    if (!executor) return;
    if (settingsOnlyView) {
      setActiveTab("settings");
      return;
    }
    if (settingsOnly && canSeeSettings) setActiveTab("settings");
  }, [executor, settingsOnly, settingsOnlyView, canSeeSettings]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3rem)] text-sm text-neutral-400">
        Загрузка...
      </div>
    );
  }

  if (!executor) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3rem)] text-sm text-neutral-500">
        Исполнитель не найден или нет доступа.
      </div>
    );
  }

  const visibleTabs: { id: TabId; label: string }[] = settingsOnly
    ? canSeeSettings
      ? [{ id: "settings" as TabId, label: "Настройки" }]
      : []
    : [
        ...TABS.filter((t) => !(t.id === "vacations" && isExternalOwner)),
        ...(canSeeSettings ? [{ id: "settings" as TabId, label: "Настройки" }] : []),
      ];

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] min-h-0 gap-3">
      {/* Header */}
      <div className="shrink-0 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {backHref && (
            <Link href={backHref}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
          )}
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">{executor.name}</h1>
            <p className="text-sm text-neutral-500">
              {EXECUTOR_TYPES[normalizeExecutorType(executor.type)] ?? executor.type}
              {executor.accessEmail ? ` · ${executor.accessEmail}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasPersonalEstimate && openTaskCount > 0 && (
            <button
              onClick={() => setActiveTab("tasks")}
              className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 border border-orange-200 px-3 py-1 text-xs font-medium text-orange-800 hover:bg-orange-200 transition-colors"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              Задачи {openTaskCount}
            </button>
          )}
        </div>
      </div>

      {visibleTabs.length === 0 ? (
        <p className="text-sm text-neutral-500 py-8 shrink-0">
          У этого исполнителя нет личной сметы — доступны только настройки.
        </p>
      ) : (
        <>
      {/* Tab bar */}
      <div className="shrink-0 border-b border-neutral-200">
        <nav className="flex gap-0 overflow-x-auto">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-neutral-500 hover:text-neutral-800 hover:border-neutral-300"
              }`}
            >
              {tab.label}
              {tab.id === "tasks" && openTaskCount > 0 && (
                <span className="ml-1.5 rounded-full bg-orange-500 text-white text-[10px] font-semibold px-1.5 py-0.5">
                  {openTaskCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {hasPersonalEstimate && activeTab === "works" && (
          <WorksTab
            executorId={executorId}
            isAdmin={isAdmin}
            isOwner={isOwner}
            bankAccounts={bankAccounts}
          />
        )}
        {hasPersonalEstimate && activeTab === "vacations" && (
          <VacationsTab executorId={executorId} isAdmin={isAdmin} isOwner={isOwner} />
        )}
        {hasPersonalEstimate && activeTab === "tasks" && (
          <TasksTab
            executorId={executorId}
            isAdmin={isAdmin}
            isOwner={isOwner}
            isPermanent={isPermanentType}
            onTaskCountChange={setOpenTaskCount}
          />
        )}
        {activeTab === "settings" && canSeeSettings && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <SettingsTab
              executorId={executorId}
              executor={executor}
              bankAccounts={bankAccounts}
              allWorkTypes={allWorkTypes}
              onChanged={reload}
              isAdmin={isAdmin}
              viewerIsSuperAdmin={viewerIsSuperAdmin}
              canEdit={isAdmin || isPermanentType}
            />
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
