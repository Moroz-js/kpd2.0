"use client";

import React, { useCallback } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePersistedState } from "@/components/PersistedInterfaceState";

/**
 * Хук хранения свёрнутости секции ДП.
 * Если сохранённого значения нет — используется defaultExpanded.
 */
export function useSectionCollapsed(sectionId: string, defaultExpanded = true) {
  const [expanded, setExpanded] = usePersistedState(
    `section:${sectionId}`,
    defaultExpanded
  );

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, [setExpanded]);

  return [expanded, toggle] as const;
}

/** Иконка-шеврон состояния секции. */
export function SectionChevron({ expanded, className }: { expanded: boolean; className?: string }) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return <Icon className={cn("h-3.5 w-3.5 shrink-0 text-neutral-400", className)} />;
}

/**
 * Сворачиваемый блок-карточка (для блоков ДП вне общей таблицы:
 * график кэшфлоу, все работы по проекту).
 */
export function CollapsibleSection({
  sectionId,
  title,
  defaultExpanded = true,
  children,
  className,
}: {
  sectionId: string;
  title: React.ReactNode;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [expanded, toggle] = useSectionCollapsed(sectionId, defaultExpanded);

  return (
    <div className={cn("rounded-lg border border-neutral-200 bg-white", className)}>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left select-none"
      >
        <SectionChevron expanded={expanded} />
        <span className="text-base font-semibold text-neutral-900">{title}</span>
      </button>
      {expanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
