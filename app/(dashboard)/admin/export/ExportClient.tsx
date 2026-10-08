"use client";

import * as React from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-custom/PageHeader";

export function ExportClient() {
  const [loading, setLoading] = React.useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/export-excel");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Не удалось сформировать файл");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
      const filename = match
        ? decodeURIComponent(match[1])
        : `Кэшфлоу_${new Date().toISOString().slice(0, 10)}.xlsx`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Файл сформирован");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Экспорт в Excel" />

      <div className="max-w-2xl space-y-4 rounded-lg border bg-white p-6">
        <p className="text-sm text-neutral-600">
          Актуальный кэшфлоу на сейчас: числа как на экране, каждый год на своём листе.
        </p>

        <Button onClick={handleDownload} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Формируется…
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" /> Скачать Excel
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
