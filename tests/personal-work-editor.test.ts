import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalWorkEditDialog, type PersonalWorkEditValues } from "@/components/ui-custom/PersonalWorkEditDialog";
import {
  canEditPersonalWork, editPersonalWorkField, personalWorkFields, personalWorkReviewPatch, personalWorkSourcePatch,
} from "@/components/ui-custom/PersonalWorkFields";

// Render the actual controls without the browser-only portal; observe SWR keys rather
// than relying on the absence of effects during a server render.
vi.mock("@/components/ui/dialog", async (load) => ({
  ...await load<typeof import("@/components/ui/dialog")>(),
  DialogContent: ({ children }: { children: ReactNode }) => children,
}));
const options = vi.hoisted(() => vi.fn(() => ({ data: [] })));
vi.mock("swr", () => ({ default: options }));

const work: PersonalWorkEditValues = {
  id: "work", projectId: "p", project: { id: "p", name: "Сохранённый проект" },
  workTypeId: "t", workType: { id: "t", name: "Сохранённый вид работ" },
  executionYear: 2022, executionMonth: 4, techTask: "Полное задание\nСм. https://example.com/task",
  volume: 3, rate: 7, amount: 1250.75, plannedPayAt: null, paymentId: null,
  link: "https://example.com/a\nhttp://example.com/b", report: "Итог: https://example.com/report",
  workStatus: "submitted", responsibleExecutorId: "archived",
  responsibleExecutor: { id: "archived", name: "Архивный ответственный" }, comment: "Прежний комментарий",
};

function render(props: Partial<ComponentProps<typeof PersonalWorkEditDialog>> = {}) {
  return renderToStaticMarkup(createElement(PersonalWorkEditDialog, {
    work, executorId: "executor", executorName: "Исполнитель из строки", permanentExecutors: [],
    isAdmin: true, onClose: vi.fn(), onSaved: vi.fn(), ...props,
  }));
}

beforeEach(() => options.mockClear());

describe("personal work form", () => {
  it("defaults to the native source form, with private plan options and admin history above Save", () => {
    const html = render();
    expect(options.mock.calls.map(([key]: [string?]) => key)).toEqual([
      "/api/executors/executor/plan-projects", "/api/executors/executor/plan-work-types?projectId=p",
    ]);
    for (const label of ["Год", "Месяц", "Проект", "Вид работ", "Ответственный", "Техническое задание", "Объём", "Ставка", "Сумма", "Дата оплаты план", "Статус", "Ссылка", "Отчёт", "Комментарий"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain("История");
    expect(html.indexOf("История")).toBeLessThan(html.indexOf('data-slot="dialog-footer"'));
  });

  it("shows full stored values and safe reference links to reviewers, without private options", () => {
    const html = render({ mode: "review", isAdmin: false, onReviewSave: vi.fn() });
    expect(options.mock.calls).toEqual([[null, expect.any(Function)], [null, expect.any(Function)]]);
    for (const value of [work.project.name, work.workType.name, work.responsibleExecutor!.name, "Исполнитель из строки", work.techTask!, work.link!, work.report!]) {
      expect(html).toContain(value);
    }
    expect(html.match(/Полное задание/g)).toHaveLength(1);
    for (const href of ["https://example.com/task", "https://example.com/a", "http://example.com/b", "https://example.com/report"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html.match(/<(?:input|textarea|button)\b[^>]*\bid="[^"]*-(?:year|month|project|work-type|task|volume|rate|amount|date|link|report)"[^>]*>/g))
      .toHaveLength(11);
    const controls = (html.match(/<(?:input|textarea|button)\b[^>]+>/g) ?? []).filter((tag) => /\bid="[^"]*-(?:year|month|project|work-type|task|volume|rate|amount|date|link|report)"/.test(tag));
    for (const tag of controls) expect(tag).toMatch(/\bdisabled=/);
    for (const field of ["responsible", "comment", "status"]) {
      const tag = html.match(new RegExp(`<(?:input|button)\\b[^>]*\\bid="[^"]*-${field}"[^>]*>`))?.[0];
      expect(tag).toBeDefined();
      expect(tag).not.toMatch(/\bdisabled=/);
    }
    expect(html).not.toContain("История");
  });

  it("never reads live history or plan options or offers Save in view mode", () => {
    const html = render({ mode: "view" });
    expect(html).toContain("Просмотр работы");
    expect(html).not.toMatch(/Сохранить|История|type="submit"/);
    expect(options.mock.calls).toEqual([[null, expect.any(Function)], [null, expect.any(Function)]]);
  });

  it.each(["source", "review", "view"] as const)("hides payment date and status for linked work in %s", (mode) => {
    const html = render({ mode, onReviewSave: vi.fn(), work: { ...work, paymentId: "payment" } });
    expect(html).toContain("статус и даты управляются выплатой");
    expect(html).not.toMatch(/>Статус<|>Дата оплаты план<|type="date"/);
  });

  it("preserves owner eligibility and reserves manual source status changes for admins", () => {
    expect(canEditPersonalWork("submitted", false, false)).toBe(false);
    expect(canEditPersonalWork("submitted", false, true)).toBe(true);
    expect(canEditPersonalWork("checked", false, true)).toBe(false);
    expect(canEditPersonalWork("paid", true, false)).toBe(true);
    expect(render({ isAdmin: false })).not.toMatch(/>Статус<|История/);
    expect(render({ isAdmin: false, work: { ...work, workStatus: "paid" } })).not.toContain("Сохранить");
  });
});

describe("personal work PATCH fields", () => {
  it("does not replace a manual amount, missing date, status, or multiline links on an unrelated edit", () => {
    const original = personalWorkFields(work);
    expect(original.amount).toBe("1250.75");
    expect(original.plannedPayAt).toBeNull();
    expect(personalWorkSourcePatch(work, {}, true)).toEqual({});
    const edits = editPersonalWorkField(original, {}, "comment", "Принято", true);
    // Even if a refresh picked up a concurrent change, a comment edit does not send an old status.
    expect(personalWorkSourcePatch({ ...work, workStatus: "checked" }, edits, true)).toEqual({ comment: "Принято" });
    expect(editPersonalWorkField(original, edits, "comment", work.comment, true)).toEqual({});
  });

  it("recalculates only on a factor edit, using the same decimal input as the native estimate", () => {
    const original = personalWorkFields(work);
    const edits = editPersonalWorkField(original, {}, "rate", "1 000,5", true);
    expect(personalWorkSourcePatch(work, edits, true)).toEqual({ rate: 1000.5, amount: 3001.5 });
    const manual = editPersonalWorkField(original, edits, "amount", "100,55", true);
    expect(personalWorkSourcePatch(work, manual, true)).toEqual({ rate: 1000.5, amount: 100.55 });
    expect(personalWorkSourcePatch(work, { rate: "" }, true)).toEqual({ rate: null });
    expect(() => personalWorkSourcePatch(work, { amount: "" }, true)).toThrow();
    expect(() => personalWorkSourcePatch(work, { rate: "-" }, true)).toThrow();
  });

  it("lets source users clear a date deliberately, but never sends payment-managed fields or an owner's status", () => {
    const dated = { ...work, plannedPayAt: "2026-04-05" };
    expect(personalWorkFields(dated).plannedPayAt).toBe("2026-04-05");
    const edits = { plannedPayAt: null, workStatus: "checked" };
    expect(personalWorkSourcePatch(dated, edits, true)).toEqual(edits);
    expect(personalWorkSourcePatch(dated, edits, false)).toEqual({ plannedPayAt: null });
    expect(personalWorkSourcePatch({ ...dated, paymentId: "payment" }, edits, true)).toEqual({});
    expect(personalWorkSourcePatch({ ...dated, workStatus: "paid" }, { amount: "3", comment: "!" }, true)).toEqual({ comment: "!" });
  });

  it("allowlists only touched review fields, including explicit clears, and drops payment-controlled status", () => {
    expect(personalWorkReviewPatch({}, true)).toEqual({});
    expect(personalWorkReviewPatch({ comment: null }, true)).toEqual({ comment: null });
    const edits = { workStatus: "checked", responsibleExecutorId: null, comment: "ok", projectId: "other", amount: "20", link: null, plannedPayAt: null };
    expect(personalWorkReviewPatch(edits, true)).toEqual({ workStatus: "checked", responsibleExecutorId: null, comment: "ok" });
    expect(personalWorkReviewPatch(edits, false)).toEqual({ responsibleExecutorId: null, comment: "ok" });
    expect(personalWorkReviewPatch({ workStatus: "paid" }, true)).toEqual({});
  });
});
