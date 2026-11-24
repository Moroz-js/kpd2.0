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

const common = {
  projectId: "p1", project: { id: "p1", name: "Проект", type: "project" },
  executor: { name: "Иван", accessEmail: null }, workType: { name: "Дизайн" }, amount: 1500,
};
const work = { ...common, id: "w1", techTask: "Первая строка\nВторая", link: "https://example.com/task", report: "Готово" };
const expense = { ...common, id: "e1", description: "Бумага для печати" };
const snapshotDb = {
  work: { findMany: vi.fn().mockResolvedValue([work]) },
  otherExpense: { findMany: vi.fn().mockResolvedValue([expense]) },
};
function getProjectWorks() {
  return GET(new NextRequest("http://localhost/api/projects/p1/works?source=s1"), {
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
