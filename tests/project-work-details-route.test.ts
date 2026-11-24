import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/projects/[id]/works/route";
import { listIssuedWorks } from "@/lib/views/issuedWorks";

const { session, project, resolveSource, adaptSource, liveDb } = vi.hoisted(() => ({
  session: vi.fn(), project: vi.fn(), resolveSource: vi.fn(), adaptSource: vi.fn(),
  liveDb: { work: { findMany: vi.fn() }, otherExpense: { findMany: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ getSessionUser: session }));
vi.mock("@/lib/db", () => ({ prisma: { ...liveDb, project: { findUnique: project } } }));
vi.mock("@/lib/snapshots/data-source", () => ({
  resolveDataSource: resolveSource, dataSourcePrismaAdapter: adaptSource,
  SnapshotSourceError: class extends Error {},
}));

const formOptions = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/other-expense-form-options", () => ({ loadOtherExpenseFormOptions: formOptions }));

const common = {
  projectId: "p1", project: { id: "p1", name: "Проект", type: "project" },
  executor: { name: "Иван", accessEmail: null }, workType: { name: "Дизайн" }, amount: 1500,
};
const work = { ...common, id: "w1", techTask: "Первая строка\nВторая", link: "https://example.com/task", report: "Готово" };
const expense = { ...common, id: "e1", description: "Бумага для печати" };
const snapshotDb = {
  work: { findMany: vi.fn().mockResolvedValue([work]), findUnique: vi.fn() },
  otherExpense: { findMany: vi.fn().mockResolvedValue([expense]), findUnique: vi.fn() },
};
function getProjectWorks(query = "source=s1") {
  return GET(new NextRequest(`http://localhost/api/projects/p1/works?${query}`), {
    params: Promise.resolve({ id: "p1" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  project.mockResolvedValue({ id: "p1", responsibleUserId: "rp1" });
  resolveSource.mockResolvedValue({ kind: "snapshot", id: "s1" });
  adaptSource.mockReturnValue(snapshotDb);
});

describe("project work details read path", () => {
  it.each([
    { id: "admin1", role: "admin", history: true },
    { id: "rp1", role: "responsible", history: false },
  ])("returns details from the selected project/source for $role", async ({ id, role, history }) => {
    session.mockResolvedValue({ id, role });
    const response = await getProjectWorks();
    expect(response.status).toBe(200);
    const rows = await response.json();
    expect(rows).toMatchObject([
      { sourceType: "personal", sourceId: work.id, executorName: "Иван", workTypeName: "Дизайн", amount: 1500,
        techTask: work.techTask, link: work.link, report: work.report, canViewActivityHistory: history },
      { sourceType: "other-expense", sourceId: expense.id, description: expense.description, canViewActivityHistory: history },
    ]);
    expect(rows[1]).not.toHaveProperty("link");
    expect(rows[1]).not.toHaveProperty("report");
    expect(resolveSource).toHaveBeenCalledWith("s1");
    expect(adaptSource).toHaveBeenCalledWith({ kind: "snapshot", id: "s1" });
    for (const delegate of Object.values(snapshotDb)) {
      expect(delegate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1" } }));
    }
  });

  it("does not read project details for another project's RP", async () => {
    session.mockResolvedValue({ id: "rp2", role: "responsible" });
    expect((await getProjectWorks()).status).toBe(403);
    expect(resolveSource).not.toHaveBeenCalled();
  });

  it("omits link and report from the ordinary issued-work view even with a project filter", async () => {
    liveDb.work.findMany.mockResolvedValue([work]);
    liveDb.otherExpense.findMany.mockResolvedValue([expense]);
    const rows = await listIssuedWorks({ projectId: ["p1"] });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).not.toHaveProperty("link");
      expect(row).not.toHaveProperty("report");
      expect(row).not.toHaveProperty("canViewActivityHistory");
    }
  });
});

describe("полный редактор строки проекта", () => {
  const fields = {
    ...common, executionYear: 2027, executionMonth: 2, executorId: "e1", executor: { id: "e1", name: "GOOGLE" },
    workTypeId: "wt", workType: { id: "wt", name: "Услуги" }, workStatus: "submitted", responsibleExecutorId: "manager",
    responsibleExecutor: { id: "manager", name: "Ответственный" }, plannedPayAt: "2027-03-05T00:00:00.000Z", comment: "Текст",
  };
  beforeEach(() => {
    session.mockResolvedValue({ id: "a1", role: "admin" });
    resolveSource.mockResolvedValue({ kind: "live" });
    snapshotDb.work.findUnique.mockResolvedValue({ ...fields, ...work, volume: 1.5, rate: 200, paymentId: "pay1" });
    snapshotDb.otherExpense.findUnique.mockResolvedValue({ ...fields, ...expense, createdById: "owner", preferredPayMethod: "Бизнес-картой КЗ",
      bankAccountId: "b1", bankAccount: { id: "b1", name: "Казахстан", details: "private" }, paymentAmount: 1550, paymentStatus: null });
    formOptions.mockResolvedValue({ projects: [], executors: [], permanentExecutors: [], workTypes: [], bankAccounts: [] });
  });

  it("opens the full native work record, including a linked payment, without reading the executor's whole estimate", async () => {
    const response = await getProjectWorks("edit=personal:w1");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sourceType: "personal", mode: "source", initial: { id: "w1", volume: 1.5, rate: 200,
      techTask: work.techTask, report: work.report, link: work.link, paymentId: "pay1", plannedPayAt: fields.plannedPayAt,
      executionYear: 2027, executionMonth: 2, responsibleExecutorId: "manager" } });
    expect(snapshotDb.work.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "w1", projectId: "p1" } }));
    expect(snapshotDb.work.findMany).not.toHaveBeenCalled();
    expect(formOptions).not.toHaveBeenCalled();
  });

  it("returns the expense's distinct amounts, payment method and account; references only for native edit", async () => {
    const { initial, mode } = await (await getProjectWorks("edit=other-expense:e1")).json();
    expect(mode).toBe("source");
    expect(initial).toMatchObject({ description: expense.description, amount: 1500, paymentAmount: 1550, preferredPayMethod: "Бизнес-картой КЗ",
      bankAccount: { id: "b1", name: "Казахстан" }, plannedPayAt: fields.plannedPayAt, workStatus: "submitted" });
    expect(initial.bankAccount).not.toHaveProperty("details");
    expect(initial).not.toHaveProperty("createdById");
    expect(formOptions).toHaveBeenCalledOnce();
  });

  it.each(["personal:w1", "other-expense:e1"])("keeps project-only review rights for %s", async (id) => {
    session.mockResolvedValue({ id: "rp1", role: "responsible" });
    expect(await (await getProjectWorks(`edit=${id}`)).json()).toMatchObject({ mode: "review", isAdmin: false });
    expect(formOptions).not.toHaveBeenCalled();
  });

  it("a responsible person with native expense edit rights can use the native form", async () => {
    session.mockResolvedValue({ id: "rp1", role: "responsible", executorId: "manager" });
    expect(await (await getProjectWorks("edit=other-expense:e1")).json()).toMatchObject({ mode: "source", isAdmin: false, canRework: true });
  });

  it("never fetches live reference lists or enables writes in snapshot/comparison/paid mode", async () => {
    resolveSource.mockResolvedValueOnce({ kind: "snapshot" });
    for (const query of ["source=s1&edit=other-expense:e1", "view=1&edit=other-expense:e1"]) {
      expect(await (await getProjectWorks(query)).json()).toMatchObject({ mode: "view", options: null });
    }
    snapshotDb.otherExpense.findUnique.mockResolvedValueOnce({ ...fields, id: "other", paymentStatus: "paid", workStatus: "paid" });
    expect(await (await getProjectWorks("edit=other-expense:other")).json()).toMatchObject({ mode: "view", options: null });
    expect(formOptions).not.toHaveBeenCalled();
  });

  it("rejects an invalid source, a row outside the requested project, or a project outside the user's ACL", async () => {
    expect((await getProjectWorks("edit=unknown:w1")).status).toBe(400);
    snapshotDb.work.findUnique.mockResolvedValueOnce(null);
    expect((await getProjectWorks("edit=personal:foreign")).status).toBe(404);
    session.mockResolvedValue({ id: "rp2", role: "responsible" });
    expect((await getProjectWorks("edit=other-expense:e1")).status).toBe(403);
    expect(snapshotDb.otherExpense.findUnique).not.toHaveBeenCalled();
  });
});
