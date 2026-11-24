import { Fragment } from "react";
import { formatMoneyRub } from "@/lib/format";
import type { IssuedWorkRow } from "@/lib/views/issuedWorks";

export type ProjectWorkDetailsRow = Pick<
  IssuedWorkRow,
  "executorName" | "workTypeName" | "amount" | "techTask" | "description"
> & (
  | { sourceType: "personal"; link?: string | null; report?: string | null }
  | { sourceType: "other-expense" }
);

// Keep surrounding prose (including punctuation) as text, not part of the href.
const HTTP_LINK = /(\bhttps?:\/\/(?:[^\s<>"'«»()]|\([^\s<>"'«»()]*\))+)/gi;

function textWithLinks(text: string) {
  return text.split(HTTP_LINK).map((part, index) => {
    if (index % 2 === 0) return part;
    const label = part.replace(/[.,;!?]+$/, "");
    let url: URL;
    try {
      url = new URL(label);
    } catch {
      return part;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return part;
    return (
      <Fragment key={index}>
        <a href={url.href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
          {label}
        </a>
        {part.slice(label.length)}
      </Fragment>
    );
  });
}

function Detail({ label, value, longText = false }: {
  label: string;
  value: string | null | undefined;
  longText?: boolean;
}) {
  return (
    <div className={longText ? "col-span-full min-w-0" : "min-w-0"}>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">
        {value?.trim() ? (longText ? textWithLinks(value) : value) : "—"}
      </dd>
    </div>
  );
}

export function ProjectWorkDetails({ row }: { row: ProjectWorkDetailsRow }) {
  return (
    <section className="min-w-0 rounded-md border p-3">
      <h3 className="mb-2 text-sm font-medium">Сведения о работе</h3>
      <dl className="grid max-h-[40dvh] grid-cols-1 gap-2 overflow-y-auto text-sm sm:grid-cols-3">
        <Detail label="Исполнитель" value={row.executorName} />
        <Detail label="Вид работ" value={row.workTypeName} />
        <Detail label="Сумма" value={formatMoneyRub(row.amount)} />
        {row.sourceType === "personal" ? (
          <>
            <Detail label="Техническое задание" value={row.techTask} longText />
            <Detail label="Ссылка" value={row.link} longText />
            <Detail label="Отчёт" value={row.report} longText />
          </>
        ) : (
          <Detail label="Описание" value={row.description} longText />
        )}
      </dl>
    </section>
  );
}
