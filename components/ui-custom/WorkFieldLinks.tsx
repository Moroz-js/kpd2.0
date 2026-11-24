// The field itself already displays its text. Add only distinct, usable reference links.
const HTTP_LINK = /\bhttps?:\/\/(?:[^\s<>"'«»()]|\([^\s<>"'«»()]*\))+/gi;

export function WorkFieldLinks({ text }: { text?: string | null }) {
  const urls = new Set<string>();
  for (const match of text?.match(HTTP_LINK) ?? []) {
    try {
      const url = new URL(match.replace(/[.,;!?]+$/, ""));
      if (url.protocol === "https:" || url.protocol === "http:") urls.add(url.href);
    } catch { /* An incomplete URL stays plain text in the field. */ }
  }
  if (!urls.size) return null;
  return (
    <div className="min-w-0 space-y-1 text-xs">
      {[...urls].map((href) => (
        <a key={href} href={href} target="_blank" rel="noopener noreferrer"
          className="block w-fit max-w-full text-blue-600 underline [overflow-wrap:anywhere]">{href}</a>
      ))}
    </div>
  );
}
