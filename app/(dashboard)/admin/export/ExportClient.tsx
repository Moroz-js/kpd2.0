"use client";

import * as React from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PageHeader } from "@/components/ui-custom/PageHeader";
import { snapshotLabel, type SnapshotOption } from "@/lib/snapshots/labels";

const EXPORTED_SHEETS = [
  "Кэшфлоу проектов",
  "График кешфлоу",
  "БД_План_расходов_полный",
  "БД_Проекты",
  "БД_Банковские счета",
  "БД_Исполнители",
  "БД_Начисления",
  "БД_Клиенты",
  "БД_Виды_работ",
  "БД_Заказы",
  "БД_Выплаты",
  "БД_Выставленные_работы",
];

export function ExportClient() {
  const [loading, setLoading] = React.useState(false);
  const [source, setSource] = React.useState("live");
  const [snapshots, setSnapshots] = React.useState<SnapshotOption[]>([]);

  React.useEffect(() => {
    fetch("/api/snapshots")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: { snapshots?: SnapshotOption[] }) =>
        setSnapshots(payload.snapshots ?? [])
      )
      .catch(() => setSnapshots([]));
  }, []);

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/export-excel?snapshot=${encodeURIComponent(source)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Не удалось сформировать файл");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
      const filename = match
        ? decodeURIComponent(match[1])
        : `Смета_${new Date().toISOString().slice(0, 10)}.xlsx`;

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
          Выгрузка выбранного состояния системы в формат исходной сметы.
        </p>

        <div className="max-w-sm space-y-1.5">
          <p className="text-sm font-medium text-neutral-700">Источник данных</p>
          <SearchableSelect
            value={source}
            onValueChange={setSource}
            options={[
              { value: "live", label: "Актуальные данные" },
              ...snapshots.map((snapshot) => ({ value: snapshot.id, label: snapshotLabel(snapshot) })),
            ]}
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Вкладки в файле
          </p>
          <ul className="grid grid-cols-1 gap-1 text-sm text-neutral-700 sm:grid-cols-2">
            {EXPORTED_SHEETS.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-neutral-300" />
                {s}
              </li>
            ))}
          </ul>
        </div>

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
