import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkFieldLinks } from "@/components/ui-custom/WorkFieldLinks";

const render = (text: string | null) => renderToStaticMarkup(createElement(WorkFieldLinks, { text }));

it("keeps HTTP(S) references accessible beside editable text, without duplicating links or prose", () => {
  const html = render("Материалы https://docs.example/a\nОтчёт (http://files.example/b). https://docs.example/a");
  expect(html.match(/<a\b/g)).toHaveLength(2);
  for (const href of ["https://docs.example/a", "http://files.example/b"]) expect(html).toContain(`href="${href}"`);
  expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
  expect(html).not.toContain("Материалы");
});

it("does not create links for missing, malformed, relative or non-HTTP references", () => {
  for (const text of [null, "", "Текст без ссылки", "javascript:alert(1) data:text/html,test ftp://host //host https://[invalid"]) {
    expect(render(text)).toBe("");
  }
});
