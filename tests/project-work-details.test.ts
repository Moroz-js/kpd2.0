import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectWorkDetails, type ProjectWorkDetailsRow } from "@/components/ui-custom/ProjectWorkDetails";

const common = { executorName: "Иван", workTypeName: "Дизайн", amount: 1250.5, techTask: null, description: null };
const render = (row: ProjectWorkDetailsRow) => renderToStaticMarkup(createElement(ProjectWorkDetails, { row }));

describe("ProjectWorkDetails", () => {
  it("renders full read-only personal details, preserving newlines and linking URLs in prose", () => {
    const task = `Сверстать макет\n  Примечание: ${"а".repeat(600)}`;
    const html = render({ ...common, sourceType: "personal", techTask: task,
      link: "https://docs.example/a\nhttp://files.example/b",
      report: "Готово.\nСм. (https://docs.example/report).",
    });
    for (const value of ["Сведения о работе", "Иван", "Дизайн", "1\u00a0250,50 руб.", task, "Готово.\nСм."]) {
      expect(html).toContain(value);
    }
    const anchors = html.match(/<a\b[^>]*>/g) ?? [];
    expect(anchors).toHaveLength(3);
    for (const [i, url] of ["https://docs.example/a", "http://files.example/b", "https://docs.example/report"].entries()) {
      expect(anchors[i]).toContain(`href="${url}"`);
      expect(anchors[i]).toContain('target="_blank"');
      expect(anchors[i]).toContain('rel="noopener noreferrer"');
    }
    expect(html).not.toMatch(/<(?:input|textarea|select)\b/);
  });

  it("leaves other schemes, malformed URLs, relative paths and markup inert", () => {
    const html = render({ ...common, sourceType: "personal", link: "javascript:alert(1)\n//example.com/path",
      report: "data:text/html,test ftp://example.com https://[invalid <b>текст</b>",
    });
    expect(html).not.toContain("href=");
    expect(html).toContain("javascript:alert(1)");
    expect(html).toContain("&lt;b&gt;текст&lt;/b&gt;");
  });

  it("renders the expense description instead of personal-only fields", () => {
    const html = render({ ...common, sourceType: "other-expense", description: "Печать\nА3" });
    for (const value of ["Иван", "Дизайн", "1\u00a0250,50 руб.", "Описание", "Печать\nА3"]) {
      expect(html).toContain(value);
    }
    expect(html).not.toMatch(/Техническое задание|Ссылка|Отчёт/);
  });

  it("shows placeholders for missing or blank fields, but keeps zero amounts", () => {
    const html = render({ ...common, sourceType: "personal", amount: 0, link: " \n\t" });
    expect(html).toContain("0,00 руб.");
    expect(html.match(/>—<\/dd>/g)).toHaveLength(3);
    expect(html).not.toContain("href=");
    expect(render({ ...common, sourceType: "other-expense", description: "  " })).toContain(">—</dd>");
  });
});
