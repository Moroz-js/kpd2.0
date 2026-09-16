"use client";

/**
 * Правила разбора выписки — одна таблица на контрагента, проект и вид работ.
 *
 * Правила появляются в основном сами: блок «запомнить выбор» в карточке операции
 * создаёт строку здесь. Экран нужен, чтобы правило можно было увидеть, выключить
 * или удалить, когда оно начало подставлять не то.
 */

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui-custom/ConfirmDialog";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { RULE_MATCH_FIELDS, RULE_TARGETS } from "@/lib/statuses";
import { formatDate } from "@/lib/format";
import { compactCell, compactHead, compactTable, stickyActionsCell, stickyActionsHead, stickyActionsInner } from "@/lib/table-styles";
import { cn } from "@/lib/utils";
import { STATEMENT_FORMAT_RULES, resolveStatementFormat } from "@/lib/statement-formats";
import type { CounterpartyOption, OptionRow, RecognitionRule } from "./types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function RulesTab({
  counterparties,
  projects,
  workTypes,
  bankAccounts,
}: {
  counterparties: CounterpartyOption[];
  projects: OptionRow[];
  workTypes: OptionRow[];
  bankAccounts: OptionRow[];
}) {
  const { data, isLoading, mutate } = useSWR<RecognitionRule[]>("/api/recognition-rules", fetcher);
  const rules = React.useMemo(() => data ?? [], [data]);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<RecognitionRule | null>(null);

  async function toggleActive(rule: RecognitionRule) {
    const res = await fetch(`/api/recognition-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    if (!res.ok) {
      toast.error("Не удалось изменить правило");
      return;
    }
    mutate();
  }

  async function changePriority(rule: RecognitionRule, value: string) {
    const priority = Number(value);
    if (!Number.isFinite(priority) || priority === rule.priority) return;
    const res = await fetch(`/api/recognition-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority }),
    });
    if (!res.ok) {
      toast.error("Не удалось изменить приоритет");
      return;
    }
    mutate();
  }

  async function remove(rule: RecognitionRule) {
    const res = await fetch(`/api/recognition-rules/${rule.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Не удалось удалить правило");
      return;
    }
    toast.success("Правило удалено");
    mutate();
  }

  function ruleValue(rule: RecognitionRule): string {
    return (
      rule.counterpartyName ?? rule.projectName ?? rule.workTypeName ?? "значение не задано"
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <StatementFormatsPanel bankAccounts={bankAccounts} />
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-500">
          Правило срабатывает, когда поле выписки совпадает со значением. Меньший приоритет
          применяется раньше. Правила из карточки операции появляются здесь автоматически.
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Правило
        </Button>
      </div>

      <Table
        className={compactTable}
        containerClassName="rounded-md border bg-white flex-1 min-h-0 overflow-auto"
      >
        <TableHeader>
          <TableRow>
            <TableHead className={cn(compactHead, "w-28")}>Что подставляет</TableHead>
            <TableHead className={cn(compactHead, "w-36")}>Поле выписки</TableHead>
            <TableHead className={cn(compactHead, "w-48")}>Значение в выписке</TableHead>
            <TableHead className={cn(compactHead, "w-52")}>Подставляем</TableHead>
            <TableHead className={cn(compactHead, "w-20")}>Приоритет</TableHead>
            <TableHead className={cn(compactHead, "w-20")}>Активно</TableHead>
            <TableHead className={cn(compactHead, "w-20 text-right")}>Срабатываний</TableHead>
            <TableHead className={cn(compactHead, "w-28")}>Последнее</TableHead>
            <TableHead className={cn(compactHead, "w-32")}>Создал</TableHead>
            <TableHead className={stickyActionsHead} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={10} className="py-8 text-center text-neutral-500">
                Загрузка...
              </TableCell>
            </TableRow>
          ) : rules.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="py-8 text-center text-neutral-500">
                Правил пока нет — они появятся, когда в карточке операции выбрать «запомнить».
              </TableCell>
            </TableRow>
          ) : (
            rules.map((rule) => (
              <TableRow key={rule.id} className={cn(!rule.isActive && "text-neutral-400")}>
                <TableCell className={compactCell}>
                  {RULE_TARGETS[rule.target as keyof typeof RULE_TARGETS] ?? rule.target}
                </TableCell>
                <TableCell className={compactCell}>
                  {RULE_MATCH_FIELDS[rule.matchField as keyof typeof RULE_MATCH_FIELDS] ??
                    rule.matchField}
                </TableCell>
                <TableCell className={cn(compactCell, "truncate")} title={rule.matchValue}>
                  {rule.matchValue}
                </TableCell>
                <TableCell className={cn(compactCell, "truncate")} title={ruleValue(rule)}>
                  {ruleValue(rule)}
                </TableCell>
                <TableCell className={compactCell}>
                  <Input
                    defaultValue={rule.priority}
                    onBlur={(e) => changePriority(rule, e.target.value)}
                    className="h-6 w-14 px-1 text-xs tabular-nums"
                  />
                </TableCell>
                <TableCell className={compactCell}>
                  <Checkbox
                    checked={rule.isActive}
                    onCheckedChange={() => toggleActive(rule)}
                    aria-label="Правило активно"
                  />
                </TableCell>
                <TableCell className={cn(compactCell, "text-right tabular-nums")}>
                  {rule.hitCount}
                </TableCell>
                <TableCell className={compactCell}>
                  {rule.lastUsedAt ? formatDate(rule.lastUsedAt) : "—"}
                </TableCell>
                <TableCell className={cn(compactCell, "truncate")}>
                  {rule.createdByName ?? (
                    <StatusBadge tone="gray" label={rule.source === "imported" ? "импорт" : "—"} />
                  )}
                </TableCell>
                <TableCell className={cn(compactCell, stickyActionsCell)}>
                  <div className={stickyActionsInner}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteTarget(rule)}
                      title="Удалить правило"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {createOpen && (
        <RuleFormDialog
          counterparties={counterparties}
          projects={projects}
          workTypes={workTypes}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            mutate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Удалить правило?"
        description="Новые выписки перестанут разбираться по этому признаку. Уже разобранные операции не изменятся."
        confirmLabel="Удалить"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await remove(deleteTarget);
        }}
      />
    </div>
  );
}

function StatementFormatsPanel({ bankAccounts }: { bankAccounts: OptionRow[] }) {
  const byFormat = React.useMemo(() => {
    const groups = Object.fromEntries(
      Object.keys(STATEMENT_FORMAT_RULES).map((id) => [id, [] as string[]])
    ) as Record<string, string[]>;
    for (const account of bankAccounts) {
      groups[resolveStatementFormat(account.statementFormat)].push(account.name);
    }
    return groups;
  }, [bankAccounts]);

  return (
    <div className="mb-4 rounded-md border bg-white p-3">
      <h3 className="text-sm font-semibold text-neutral-800">Правила определения ветки</h3>
      <p className="mt-1 text-xs text-neutral-500">
        Формат выписки задаётся у банковского счёта. Казахстан и Черногория приходят другой
        структурой — ветка (поступление / списание) читается из их колонок, а не из российских.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-neutral-400">
              <th className="pb-1 pr-3 font-medium">Формат</th>
              <th className="pb-1 pr-3 font-medium">ИНН / ИИК / IBAN</th>
              <th className="pb-1 pr-3 font-medium">Счёт</th>
              <th className="pb-1 pr-3 font-medium">БИК</th>
              <th className="pb-1 pr-3 font-medium">Поступление</th>
              <th className="pb-1 pr-3 font-medium">Списание</th>
              <th className="pb-1 font-medium">Счета</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(STATEMENT_FORMAT_RULES).map((rule) => (
              <tr key={rule.id} className="align-top text-neutral-700">
                <td className="py-1.5 pr-3 font-medium">{rule.label}</td>
                <td className="py-1.5 pr-3">{rule.fields.taxId}</td>
                <td className="py-1.5 pr-3">{rule.fields.account}</td>
                <td className="py-1.5 pr-3">{rule.fields.bic}</td>
                <td className="py-1.5 pr-3">{rule.incomingMarkers.slice(0, 3).join(", ")}</td>
                <td className="py-1.5 pr-3">{rule.outgoingMarkers.slice(0, 3).join(", ")}</td>
                <td className="py-1.5">
                  {byFormat[rule.id]?.length
                    ? byFormat[rule.id].join(", ")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RuleFormDialog({
  counterparties,
  projects,
  workTypes,
  onClose,
  onSaved,
}: {
  counterparties: CounterpartyOption[];
  projects: OptionRow[];
  workTypes: OptionRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [target, setTarget] = React.useState("counterparty");
  const [matchField, setMatchField] = React.useState("name");
  const [matchValue, setMatchValue] = React.useState("");
  const [valueId, setValueId] = React.useState("");
  const [priority, setPriority] = React.useState("100");
  const [submitting, setSubmitting] = React.useState(false);

  const valueOptions =
    target === "counterparty"
      ? counterparties.map((c) => ({ value: c.id, label: c.name, searchText: c.searchText }))
      : target === "project"
        ? projects.map((p) => ({ value: p.id, label: p.name }))
        : workTypes.map((w) => ({ value: w.id, label: w.name }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await fetch("/api/recognition-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target,
        matchField,
        matchValue: matchValue.trim(),
        counterpartyId: target === "counterparty" ? valueId : null,
        projectId: target === "project" ? valueId : null,
        workTypeId: target === "work_type" ? valueId : null,
        priority: Number(priority) || 100,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Не удалось создать правило");
      return;
    }
    toast.success("Правило создано");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новое правило разбора</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Что подставляет</Label>
              <SearchableSelect
                value={target}
                onValueChange={(v) => {
                  setTarget(v);
                  setValueId("");
                }}
                options={Object.entries(RULE_TARGETS).map(([value, label]) => ({ value, label }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Поле выписки</Label>
              <SearchableSelect
                value={matchField}
                onValueChange={setMatchField}
                options={Object.entries(RULE_MATCH_FIELDS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-value">Значение в выписке</Label>
            <Input
              id="rule-value"
              value={matchValue}
              onChange={(e) => setMatchValue(e.target.value)}
              placeholder="ООО «Базис» / 7701234567 / 40702810..."
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Подставляем</Label>
            <SearchableSelect
              value={valueId}
              onValueChange={setValueId}
              options={valueOptions}
              placeholder="Выберите значение"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-priority">Приоритет</Label>
            <Input
              id="rule-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-24 tabular-nums"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Отмена
            </Button>
            <Button type="submit" disabled={submitting || !valueId || !matchValue.trim()}>
              {submitting ? "Сохранение..." : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
