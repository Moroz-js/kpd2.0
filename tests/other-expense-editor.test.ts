import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OtherExpenseFormDialog, type OtherExpenseEditValues } from "@/components/ui-custom/OtherExpenseFormDialog";
import {
  expenseDraft, fetchWorkTypeIds, referenceOptions, reviewPatch, sourceBody, statusOptions,
} from "@/components/ui-custom/other-expense-editor";

// Render the real controls inline instead of portalling them into a browser document.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: "section", DialogContent: "div", DialogHeader: "header", DialogTitle: "h2", DialogFooter: "footer",
}));

const row: OtherExpenseEditValues = {
  id: "expense", projectId: "p", project: { id: "p", name: "Архивный проект" },
  executorId: "e", executor: { id: "e", name: "Архивный исполнитель" },
  workTypeId: "w", workType: { id: "w", name: "Старый вид работ" },
  responsibleExecutorId: "r", responsibleExecutor: { id: "r", name: "Бывший ответственный" },
  bankAccountId: "b", bankAccount: { id: "b", name: "Закрытый счёт" },
  executionYear: 2020, executionMonth: 10, description: "См. https://example.org/report.",
  amount: 90, paymentAmount: null, preferredPayMethod: "Старый способ", plannedPayAt: null,
  workStatus: "submitted", paymentStatus: null, comment: null,
};
const checked = { ...row, workStatus: "checked", paymentStatus: "planned", paymentAmount: 90 };
const paid = { ...checked, workStatus: "paid", paymentStatus: "paid" };

function render(props: Partial<ComponentProps<typeof OtherExpenseFormDialog>>) {
  return renderToStaticMarkup(createElement(OtherExpenseFormDialog, {
    initial: row, isAdmin: true, canRework: true,
    projects: [], executors: [], workTypes: [], permanentExecutors: [], bankAccounts: [],
    onClose: vi.fn(), onSaved: vi.fn(), onReviewSave: vi.fn(), ...props,
  }));
}
function control(html: string, field: string) {
  const tag = html.match(new RegExp(`<(?:input|button)\\b[^>]*\\bid="[^"]*-${field}"[^>]*>`));
  expect(tag, field).not.toBeNull();
  return tag![0];
}
const disabled = /\bdisabled=""|aria-disabled="true"/;
const sourceOnly = ["year", "month", "project", "executor", "work-type", "description", "method", "amount", "payment", "date", "payment-status", "bank"];

describe("OtherExpenseFormDialog", () => {
  it("shows all saved labels, links and controls in view without save or live history", () => {
    const html = render({ mode: "view", initial: paid });
    for (const field of [...sourceOnly, "responsible", "comment", "status"]) expect(control(html, field)).toMatch(disabled);
    for (const name of [row.project.name, row.executor.name, row.workType.name, row.responsibleExecutor!.name, row.bankAccount!.name, row.preferredPayMethod, "2020 год"]) {
      expect(html).toContain(name);
    }
    expect(html).toContain('href="https://example.org/report"');
    expect(html).not.toMatch(/Сохранить|История/);
  });

  it("exposes only the three review controls, locking responsible and status once checked", () => {
    const html = render({ mode: "review", isAdmin: false });
    for (const field of sourceOnly) expect(control(html, field)).toMatch(disabled);
    for (const field of ["responsible", "comment", "status"]) expect(control(html, field)).not.toMatch(disabled);
    const locked = render({ mode: "review", initial: checked });
    for (const field of ["responsible", "status", "payment-status"]) expect(control(locked, field)).toMatch(disabled);
    expect(control(locked, "comment")).not.toMatch(disabled);
  });

  it("defaults to native source editing with admin history above the footer", () => {
    const html = render({ initial: checked });
    expect(control(html, "description")).not.toMatch(disabled);
    expect(control(html, "date")).not.toMatch(disabled);
    expect(control(html, "responsible")).toMatch(disabled);
    expect(html).toMatch(/История[\s\S]*<footer>[\s\S]*Сохранить/);
    expect(render({ isAdmin: false })).not.toContain("История");
  });
});

describe("source mutation", () => {
  it("creates with the native period, next payout date and positive matching amounts", () => {
    const draft = { ...expenseDraft(undefined, new Date(2026, 1, 21)), projectId: "p", executorId: "e", workTypeId: "w",
      responsibleExecutorId: "r", description: "Печать", amount: "90", paymentAmount: "90" };
    expect(sourceBody(draft, undefined, true, true)).toEqual({ projectId: "p", executorId: "e", workTypeId: "w",
      responsibleExecutorId: "r", description: "Печать", executionYear: 2026, executionMonth: 2,
      plannedPayAt: "2026-03-05", amount: 90, paymentAmount: 90, preferredPayMethod: null, comment: null });
    for (const invalid of [{ paymentAmount: "" }, { paymentAmount: "91" }, { amount: "0", paymentAmount: "0" }, { responsibleExecutorId: "" }]) {
      expect(() => sourceBody({ ...draft, ...invalid }, undefined, true, true)).toThrow();
    }
  });

  it("preserves nulls, timestamps, amounts and archived assignments on comment-only PATCH", () => {
    for (const initial of [row, { ...checked, paymentAmount: null }, { ...paid, plannedPayAt: "2025-02-19T12:13:14.000Z" }]) {
      expect(sourceBody({ ...expenseDraft(initial), comment: "ok" }, initial, true, true)).toEqual({ comment: "ok" });
    }
    const draft = expenseDraft(row);
    expect(draft.plannedPayAt).toBe("");
    expect(draft.paymentAmount).toBe("90"); // Proposed amount for an uncreated payout, as in the source form.
    expect(expenseDraft({ ...checked, paymentAmount: null }).paymentAmount).toBe("");
    expect(sourceBody({ ...draft, plannedPayAt: "2026-05-20" }, row, true, false)).toEqual({ plannedPayAt: "2026-05-20" });
  });

  it("preserves the separate check action, atomic unpaid rollback, and admin paid-to-planned transition", () => {
    expect(statusOptions("source", row, true)).toEqual(["submitted", "rework"]);
    expect(sourceBody({ ...expenseDraft(checked), workStatus: "rework" }, checked, false, true)).toEqual({ workStatus: "rework", paymentStatus: null });
    expect(sourceBody({ ...expenseDraft(checked), workStatus: "rework" }, checked, true, false)).toEqual({});
    expect(sourceBody({ ...expenseDraft(paid), paymentStatus: "planned" }, paid, true, false)).toEqual({ paymentStatus: "planned" });
    expect(sourceBody({ ...expenseDraft(paid), paymentStatus: "planned", workStatus: "rework" }, paid, false, true)).toEqual({});
    expect(sourceBody({ ...expenseDraft(checked), amount: "100", paymentAmount: "100" }, checked, true, true)).toEqual({ amount: 100, paymentAmount: 100 });
  });
});

describe("project review patch", () => {
  it("sends only changed review fields and ignores missing historical source requirements", () => {
    const historical = { ...row, description: "", amount: 0, responsibleExecutorId: null, responsibleExecutor: null };
    expect(reviewPatch(historical, { amount: "999", projectId: "x", paymentStatus: "paid", comment: "ok" })).toEqual({ comment: "ok" });
    expect(reviewPatch(historical, { workStatus: "checked", responsibleExecutorId: "r" })).toEqual({ workStatus: "checked", responsibleExecutorId: "r" });
    expect(reviewPatch(row, { comment: "", responsibleExecutorId: "r", workStatus: "submitted" })).toEqual({});
    expect(reviewPatch({ ...row, comment: "old" }, { comment: "" })).toEqual({ comment: null });
    expect(reviewPatch(row, { workStatus: "paid" })).toEqual({});
  });
  it("never changes an existing payout or its checked/paid assignee in review", () => {
    expect(statusOptions("review", row)).toEqual(["submitted", "rework", "checked"]);
    for (const initial of [checked, paid]) {
      expect(statusOptions("review", initial, true)).toEqual([]);
      expect(reviewPatch(initial, { workStatus: "submitted", responsibleExecutorId: "new", comment: "ok" })).toEqual({ comment: "ok" });
    }
  });
});

describe("scoped options", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps only the current archived value; it cannot be reassigned", () => {
    expect(referenceOptions([], "w", row.workType)).toEqual([{ value: "w", label: row.workType.name, disabled: true }]);
    expect(referenceOptions([], "", row.workType)).toEqual([]);
    expect(referenceOptions([row.workType], "w", row.workType)).toHaveLength(1);
  });
  it("accepts only a successful list of IDs from the selected executor's request", async () => {
    const signal = new AbortController().signal;
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(["w"]))
      .mockResolvedValueOnce(Response.json(["unauthorized"], { status: 403 })).mockResolvedValueOnce(Response.json({ error: "offline" }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchWorkTypeIds("a/b", signal)).toEqual(new Set(["w"]));
    expect(fetch).toHaveBeenCalledWith("/api/executors/a%2Fb/work-type-ids", { signal });
    await expect(fetchWorkTypeIds("a/b", signal)).rejects.toThrow();
    await expect(fetchWorkTypeIds("a/b", signal)).rejects.toThrow();
  });
});
