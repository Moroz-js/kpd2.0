"use client";

import * as React from "react";
import { MessageSquare } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import type { DisplayChange } from "@/lib/audit/display-changes";
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
  historyUrl?: string;
  className?: string;
  compact?: boolean;
  allowHighlight?: boolean;
  children: React.ReactNode;
};

export function CashflowCommentCell({
  meta,
  onSave,
  historyUrl,
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
  const [historyState, setHistoryState] = React.useState<{
    url: string;
    items: CommentHistoryItem[] | null;
    error: boolean;
  }>({ url: "", items: null, error: false });

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setDraft(comment ?? "");
      setDraftHighlight(highlight);
      if (historyUrl) {
        setHistoryState({ url: "", items: null, error: false });
      }
    }
    setOpen(nextOpen);
  }

  React.useEffect(() => {
    if (!open || !historyUrl) return;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(historyUrl, { signal: controller.signal });
        if (!response.ok) throw new Error("Failed to load history");
        const history = await response.json() as { items: CommentHistoryItem[] };
        setHistoryState({ url: historyUrl, items: history.items, error: false });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setHistoryState({ url: historyUrl, items: null, error: true });
      }
    })();

    return () => controller.abort();
  }, [open, historyUrl]);

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
      <Popover open={open} onOpenChange={handleOpenChange}>
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
            {historyUrl && (
              <CommentHistory
                state={historyState}
                historyUrl={historyUrl}
              />
            )}
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

type CommentHistoryItem = {
  id: string;
  createdAt: string;
  authorName: string;
  displayChanges: DisplayChange[];
};

function CommentHistory({
  state,
  historyUrl,
}: {
  state: { url: string; items: CommentHistoryItem[] | null; error: boolean };
  historyUrl: string;
}) {
  const isCurrent = state.url === historyUrl;

  return (
    <div className="border-t border-neutral-100 pt-2">
      <p className="mb-1 text-xs font-medium text-neutral-700">Последние изменения</p>
      {(!isCurrent || state.items === null) && !state.error && (
        <p className="text-xs text-neutral-400">Загрузка…</p>
      )}
      {isCurrent && state.error && (
        <p className="text-xs text-neutral-400">Не удалось загрузить историю</p>
      )}
      {isCurrent && state.items?.length === 0 && (
        <p className="text-xs text-neutral-400">Изменений пока нет</p>
      )}
      {isCurrent && state.items && state.items.length > 0 && (
        <div className="space-y-1.5">
          {state.items.map((item) => (
            <div key={item.id} className="text-xs">
              <div className="flex flex-wrap gap-x-1.5 text-neutral-500">
                <span className="font-medium text-neutral-700">{item.authorName}</span>
                <span className="tabular-nums">{formatDateTime(item.createdAt)}</span>
              </div>
              {item.displayChanges.map((change) => (
                <div key={change.field} className="flex flex-wrap items-center gap-x-1 text-neutral-600">
                  <span>{change.fieldLabel}:</span>
                  <span className="line-through text-neutral-400">{change.from}</span>
                  <span className="text-neutral-400">→</span>
                  <span className="font-medium text-neutral-700">{change.to}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
