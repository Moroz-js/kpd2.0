"use client";

import * as React from "react";
import { MessageSquare } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CASHFLOW_HIGHLIGHTS,
  CASHFLOW_HIGHLIGHT_IDS,
  type CashflowHighlightId,
  type CashflowCellMeta,
} from "@/lib/cashflow-comments";

export type CashflowCellSavePayload = {
  text: string;
  highlight: CashflowHighlightId | null;
};

export type CashflowCommentCellProps = {
  meta?: CashflowCellMeta;
  onSave: (payload: CashflowCellSavePayload) => Promise<void>;
  className?: string;
  compact?: boolean;
  allowHighlight?: boolean;
  children: React.ReactNode;
};

export function CashflowCommentCell({
  meta,
  onSave,
  className,
  compact,
  allowHighlight = true,
  children,
}: CashflowCommentCellProps) {
  const comment = meta?.text;
  const highlight = allowHighlight ? (meta?.highlight ?? null) : null;
  const hasMeta = Boolean(comment || highlight);

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(comment ?? "");
  const [draftHighlight, setDraftHighlight] = React.useState<CashflowHighlightId | null>(highlight);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setDraft(comment ?? "");
      setDraftHighlight(highlight);
    }
  }, [open, comment, highlight]);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        text: draft.trim(),
        highlight: allowHighlight ? draftHighlight : null,
      });
      setOpen(false);
    } catch {
      // Ошибку показывает вызывающий код; popover остаётся открытым для повтора.
    } finally {
      setSaving(false);
    }
  }

  const triggerTitle =
    comment ||
    (allowHighlight && highlight
      ? CASHFLOW_HIGHLIGHTS[highlight].label
      : "Комментарий");

  return (
    <div
      className={cn(
        "group/cell relative flex items-center justify-end gap-0.5",
        compact ? "min-h-[1.35rem]" : "min-h-[1.5rem]",
        className
      )}
    >
      <div className="min-w-0 flex-1 text-right">{children}</div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          title={triggerTitle}
          render={
            <button
              type="button"
              className={cn(
                "shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover/cell:opacity-100 focus:opacity-100",
                hasMeta
                  ? "text-blue-500 hover:text-blue-700 opacity-100"
                  : "text-neutral-300 hover:text-neutral-500"
              )}
            />
          }
        >
          <span className="relative inline-flex">
            <MessageSquare className={cn("h-3 w-3", comment && "fill-blue-100")} />
            {highlight && (
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-white",
                  CASHFLOW_HIGHLIGHTS[highlight].swatch
                )}
              />
            )}
          </span>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3" side="top" align="end">
          <div className="space-y-3">
            {allowHighlight && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-neutral-700">Подсветка</p>
                <div className="flex flex-wrap items-center gap-2">
                  {CASHFLOW_HIGHLIGHT_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      title={CASHFLOW_HIGHLIGHTS[id].label}
                      className={cn(
                        "h-6 w-6 rounded border-2 transition-transform hover:scale-110",
                        CASHFLOW_HIGHLIGHTS[id].swatch,
                        draftHighlight === id && "ring-2 ring-blue-500 ring-offset-1"
                      )}
                      onClick={() => setDraftHighlight(draftHighlight === id ? null : id)}
                    />
                  ))}
                  <button
                    type="button"
                    className="text-xs text-neutral-500 hover:text-neutral-800 underline-offset-2 hover:underline"
                    onClick={() => setDraftHighlight(null)}
                  >
                    Сбросить
                  </button>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-neutral-700">Комментарий</p>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Введите комментарий..."
                className="min-h-[72px] resize-y text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
              />
            </div>
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
    </div>
  );
}
