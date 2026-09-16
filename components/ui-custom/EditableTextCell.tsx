"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Props = {
  value: string | null | undefined;
  placeholder?: string;
  emptyLabel?: string;
  onSave: (next: string | null) => Promise<void>;
  className?: string;
};

/**
 * Единый инлайн-текст: полный текст по наведению, по клику — окно с правкой.
 */
export function EditableTextCell({
  value,
  placeholder = "Добавить",
  emptyLabel = "—",
  onSave,
  className,
}: Props) {
  const text = value?.trim() || "";
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(text);
  const [saving, setSaving] = React.useState(false);

  function handleOpenChange(next: boolean) {
    if (next) setDraft(text);
    setOpen(next);
  }

  async function handleSave() {
    const next = draft.trim();
    if (next === text) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next || null);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        title={text || placeholder}
        render={
          <button
            type="button"
            className={cn(
              "block w-full truncate text-left text-xs hover:text-blue-700 hover:underline",
              text ? "text-neutral-600" : "text-neutral-400",
              className
            )}
          />
        }
      >
        {text || emptyLabel}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <div className="space-y-3">
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="min-h-[96px] resize-y text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void handleSave();
              }
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? "..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
