"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOutAction } from "@/app/(dashboard)/actions";
import {
  FolderOpen,
  Users,
  Briefcase,
  CreditCard,
  TrendingUp,
  LogOut,
  UserCheck,
  Receipt,
  FileText,
  Building2,
  Wallet,
  Wrench,
  ShoppingCart,
  Hourglass,
  CheckSquare,
  User,
  Download,
  KeyRound,
  PanelLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { useState, useCallback } from "react";
import { toast } from "sonner";
import { usePersistedState } from "@/components/PersistedInterfaceState";

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
};

type NavGroup = {
  label?: string;
  items: NavItem[];
};

/** Состав sidebar по ролям (см. TZ Приложение B / TDNB-31). */
const ADMIN_NAV: NavGroup[] = [
  {
    items: [
      { label: "Кэшфлоу", href: "/admin/cashflow", icon: TrendingUp },
      { label: "Проекты", href: "/admin/projects", icon: FolderOpen },
      { label: "Начисления", href: "/admin/charges", icon: FileText },
      { label: "Заказы", href: "/admin/orders", icon: ShoppingCart },
      { label: "Выставленные работы", href: "/admin/issued-works", icon: Briefcase },
      { label: "Выплаты", href: "/admin/payouts", icon: CreditCard },
      { label: "Прочие траты", href: "/admin/other-expenses", icon: Receipt },
      { label: "Исполнители", href: "/admin/executors", icon: Users },
      { label: "Руководители проекта", href: "/admin/responsibles", icon: UserCheck },
      { label: "Клиенты", href: "/admin/clients", icon: Building2 },
      { label: "Виды работ", href: "/admin/work-types", icon: Wrench },
      { label: "Банковские счета", href: "/admin/bank-accounts", icon: Wallet },
      { label: "Задачи", href: "/admin/tasks", icon: CheckSquare },
      { label: "История действий", href: "/admin/activity", icon: Hourglass },
    ],
  },
  {
    label: "Система",
    items: [{ label: "Экспорт в Excel", href: "/admin/export", icon: Download }],
  },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  responsible: "Руководитель проекта",
  executor: "Исполнитель",
};

function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = usePersistedState("sidebar", false);

  const toggle = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, [setCollapsed]);

  return [collapsed, toggle] as const;
}

type SidebarProps = {
  role: string;
  fullName: string;
  userId?: string;
  isSuperAdmin?: boolean;
  hasProjects?: boolean;
  isPm?: boolean;
  isPermanentExecutor?: boolean;
  hasProfile?: boolean;
};

function buildNavGroups({
  role,
  hasProjects,
  isPm,
  isPermanentExecutor,
  hasProfile,
}: Required<Omit<SidebarProps, "fullName" | "userId" | "isSuperAdmin">>): NavGroup[] {
  if (role === "admin") return ADMIN_NAV;

  const items: NavItem[] = [];

  // PM: только свои проекты (кэшфлоу — admin-only, PM смотрит его внутри проекта)
  if (isPm && hasProjects) {
    items.push({ label: "Мои проекты", href: "/responsible/projects", icon: FolderOpen });
  }

  // Прочие траты: PM → /responsible, постоянный исполнитель → /executor
  if (isPm) {
    items.push({ label: "Прочие траты", href: "/responsible/other-expenses", icon: Receipt });
  } else if (isPermanentExecutor) {
    items.push({ label: "Прочие траты", href: "/executor/other-expenses", icon: Receipt });
  }

  // Исполнители: только PM
  if (isPm) {
    items.push({ label: "Исполнители", href: "/executor/executors", icon: Users });
  }

  // Личный профиль — для всех, у кого есть привязанный исполнитель
  if (hasProfile) {
    items.push({ label: "Личный профиль", href: "/me", icon: User });
  }

  return items.length > 0 ? [{ items }] : [];
}

function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%";
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export function Sidebar({
  role,
  fullName,
  userId,
  isSuperAdmin = false,
  hasProjects = true,
  isPm = false,
  isPermanentExecutor = false,
  hasProfile = false,
}: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [resettingPwd, setResettingPwd] = useState(false);
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const navGroups = buildNavGroups({
    role,
    hasProjects,
    isPm,
    isPermanentExecutor,
    hasProfile,
  });
  const displayRole = isPm ? ROLE_LABELS.responsible : (ROLE_LABELS[role] ?? role);

  if (searchParams.get("comparePanel")) return null;

  async function handleSelfReset() {
    if (!userId) return;
    setResettingPwd(true);
    try {
      const newPwd = generatePassword();
      const res = await fetch(`/api/users/${userId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPwd }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error((err as { error?: string }).error ?? "Не удалось сбросить пароль");
        return;
      }
      await navigator.clipboard.writeText(newPwd);
      toast.success("Пароль сброшен и скопирован в буфер обмена");
    } finally {
      setResettingPwd(false);
    }
  }

  return (
    <aside
      className={cn(
        "flex-shrink-0 h-full bg-white border-r border-neutral-200 flex flex-col z-10 overflow-y-auto transition-[width]",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div
        className={cn(
          "border-b border-neutral-200 flex items-center",
          collapsed ? "px-2 py-3 justify-center" : "px-4 py-5 justify-between gap-2"
        )}
      >
        {!collapsed && <span className="text-xl font-bold text-neutral-800">КПД</span>}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggleCollapsed}
          title={collapsed ? "Развернуть меню" : "Свернуть меню"}
          aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      </div>

      <nav className="flex-1 py-4 overflow-y-auto">
        <div className={cn("space-y-4", collapsed ? "px-1" : "px-2")}>
          {navGroups.map((group, gi) => (
            <div key={gi}>
              {group.label && !collapsed && (
                <p className="px-3 mb-1 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  {group.label}
                </p>
              )}
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "flex items-center rounded-md text-sm font-medium transition-colors",
                          collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                          isActive
                            ? "bg-neutral-100 text-neutral-900"
                            : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {!collapsed && item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className={cn("border-t border-neutral-200", collapsed ? "p-2" : "p-4")}>
        {!collapsed && <Separator className="mb-3" />}
        {!collapsed && (
          <div className="mb-3">
            <p className="text-sm font-medium text-neutral-800 truncate">{fullName}</p>
            <p className="text-xs text-neutral-500">{displayRole}</p>
          </div>
        )}
        {isSuperAdmin && (
          <Button
            type="button"
            variant="ghost"
            size={collapsed ? "icon" : "sm"}
            disabled={resettingPwd}
            onClick={handleSelfReset}
            title="Сбросить пароль"
            className={cn(
              "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 mb-1",
              collapsed ? "w-full" : "w-full justify-start"
            )}
          >
            <KeyRound className={cn("h-4 w-4", !collapsed && "mr-2")} />
            {!collapsed && (resettingPwd ? "Сброс..." : "Сбросить пароль")}
          </Button>
        )}
        <form action={signOutAction}>
          <Button
            type="submit"
            variant="ghost"
            size={collapsed ? "icon" : "sm"}
            title="Выйти"
            className={cn(
              "text-neutral-600 hover:text-red-600 hover:bg-red-50",
              collapsed ? "w-full" : "w-full justify-start"
            )}
          >
            <LogOut className={cn("h-4 w-4", !collapsed && "mr-2")} />
            {!collapsed && "Выйти"}
          </Button>
        </form>
      </div>
    </aside>
  );
}
