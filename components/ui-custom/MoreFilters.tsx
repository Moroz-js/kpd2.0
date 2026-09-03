"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type MoreFiltersProps = {
  children: React.ReactNode;
  activeCount?: number;
};

/** Контейнер для второстепенных фильтров, чтобы не перегружать toolbar таблиц. */
export function MoreFilters({ children, activeCount = 0 }: MoreFiltersProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 text-xs font-normal whitespace-nowrap",
              activeCount > 0 && "border-neutral-400 bg-neutral-50",
            )}
          >
            <SlidersHorizontal className="size-3.5" />
            Показать ещё
            {activeCount > 0 && <span className="text-neutral-500">· {activeCount}</span>}
          </Button>
        }
      />
      <PopoverContent className="w-auto min-w-48 p-2" align="end">
        <div className="flex flex-col gap-2">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
