"use client";

import * as React from "react";
import useSWR from "swr";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui-custom/StatusBadge";
import { COUNTERPARTY_LEGAL_TYPES, ENTITY_STATUSES } from "@/lib/statuses";
import { CounterpartyDialog } from "./CounterpartyDialog";
import type { Counterparty, LinkKind, LinkOption } from "./types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function LinkedCounterpartiesSection({
  linkKind,
  linkId,
}: {
  linkKind: LinkKind;
  linkId: string;
}) {
  const query =
    linkKind === "executor"
      ? `executorId=${linkId}`
      : linkKind === "client"
        ? `clientId=${linkId}`
        : `bankAccountId=${linkId}`;
  const { data, mutate } = useSWR<Counterparty[]>(`/api/counterparties?${query}`, fetcher);
  const { data: executors } = useSWR<LinkOption[]>("/api/executors", fetcher);
  const { data: clients } = useSWR<LinkOption[]>("/api/clients", fetcher);
  const { data: bankAccounts } = useSWR<LinkOption[]>("/api/bank-accounts", fetcher);
  const [editing, setEditing] = React.useState<Counterparty | "new" | null>(null);

  const rows = data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-800">Контрагенты</h3>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing("new")}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Контрагент
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-neutral-500">
          Связанных контрагентов нет. Добавьте юридический получатель, чтобы разбирать выписку.
        </p>
      ) : (
        <ul className="divide-y rounded-md border border-neutral-200">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => setEditing(row)}
                  className="block w-full truncate text-left text-sm font-medium text-blue-700 hover:underline"
                  title="Настройки контрагента"
                >
                  {row.name}
                </button>
                <p className="text-[11px] text-neutral-500">
                  {row.legalType
                    ? `${COUNTERPARTY_LEGAL_TYPES[row.legalType as keyof typeof COUNTERPARTY_LEGAL_TYPES] ?? row.legalType} · `
                    : ""}
                  {row.aliases.length ? `${row.aliases.length} написаний` : "без написаний"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <StatusBadge dict={ENTITY_STATUSES} value={row.status} />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  title="Настройки контрагента"
                  onClick={() => setEditing(row)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <CounterpartyDialog
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          executors={toOptions(executors)}
          clients={toOptions(clients)}
          bankAccounts={toOptions(bankAccounts)}
          lockLink={{ kind: linkKind, id: linkId }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            mutate();
          }}
        />
      )}
    </div>
  );
}

function toOptions(
  rows: Array<{ id: string; name: string; status?: string; type?: string }> | undefined
): LinkOption[] {
  return (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status ?? "active",
    type: r.type,
  }));
}
