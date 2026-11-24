"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PersonalWorkEditDialog } from "./PersonalWorkEditDialog";
import { OtherExpenseFormDialog } from "./OtherExpenseFormDialog";
import type { ProjectWorkEditorData } from "@/lib/services/project-work-editor";

type ReviewPatch = { responsibleExecutorId?: string | null; workStatus?: string; comment?: string | null };

export function ProjectWorkEditor({ url, permanentExecutors, onClose, onSaved }: {
  url: string;
  permanentExecutors: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  // The parent keys this dialog by row/source. Always open with fresh source values,
  // not a cached list row (including when the same work is reopened after saving).
  const [data, setData] = useState<ProjectWorkEditorData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Не удалось загрузить работу");
        const editor: ProjectWorkEditorData = await response.json();
        if (!controller.signal.aborted) setData(editor);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить работу");
      }
    })();
    return () => controller.abort();
  }, [url, attempt]);

  if (!data) return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Работа по проекту</DialogTitle></DialogHeader>
        {error ? <><p role="alert">{error}</p><Button variant="outline" onClick={() => { setError(""); setAttempt((n) => n + 1); }}>Повторить</Button></>
          : <p role="status" className="text-neutral-500">Загрузка работы…</p>}
      </DialogContent>
    </Dialog>
  );

  const onReviewSave = async (patch: ReviewPatch) => {
    if (data.mode !== "review") throw new Error("Рецензирование недоступно");
    if (!Object.keys(patch).length) return;
    const key = encodeURIComponent(`${data.sourceType}:${data.initial.id}`);
    const response = await fetch(`/api/issued-works/${key}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Не удалось сохранить работу");
  };
  const actions = { isAdmin: data.isAdmin, mode: data.mode, onReviewSave, onSaved, onClose };
  if (data.sourceType === "personal") return (
    <PersonalWorkEditDialog {...actions} executorId={data.executorId} executorName={data.executorName}
      work={data.initial} permanentExecutors={permanentExecutors} />
  );
  const options = data.options ?? { projects: [], executors: [], workTypes: [], bankAccounts: [], permanentExecutors };
  return <OtherExpenseFormDialog {...actions} {...options} initial={data.initial} canRework={data.canRework} />;
}
