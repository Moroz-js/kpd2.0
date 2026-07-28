/**
 * Seed для kpd-demo — большой набор реалистичных данных.
 *
 * Содержит:
 *  - 3 активных ответственных (исполнители с isResponsible) + 1 архивный PM, 10+ исполнителей с логином
 *  - 9 клиентов (7 активных + 2 архивных)
 *  - 12 проектов (9 активных + 3 архивных)
 *  - 20 заказов
 *  - ~420 работ (2025 + 2026 янв–июн) по 8 исполнителям
 *  - ~32 прочие траты
 *  - ~22 начисления
 *  - ~300 строк плана расходов
 *  - ~8 отпусков
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "Password123!";

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function md(year: number, month: number, day: number): Date {
  return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}
function nextMD(year: number, month: number, day: number): Date {
  const m = month === 12 ? 1 : month + 1;
  const y = month === 12 ? year + 1 : year;
  return md(y, m, day);
}

type WorkStatus = "paid" | "checked" | "submitted" | "rework";
type WorkSpec = { task: string; amount: number; status?: WorkStatus; vol?: number; rate?: number };
type MonthSpec = { year: number; month: number; works: WorkSpec[] };

/** Создаёт works + payments для одного исполнителя, последовательно по месяцам. */
async function seedMonths(
  executorId: string,
  projectId: string,
  workTypeId: string,
  bankId: string | null,
  months: MonthSpec[],
) {
  for (const m of months) {
    const paid     = m.works.filter(w => (w.status ?? "paid") === "paid");
    const checked  = m.works.filter(w => w.status === "checked");
    const other    = m.works.filter(w => w.status === "submitted" || w.status === "rework");

    if (paid.length > 0) {
      const paidAt  = md(m.year, m.month, 22);
      const planAt  = md(m.year, m.month, 20);
      const pay = await prisma.payment.create({ data: {
        executorId, periodYear: m.year, periodMonth: m.month,
        amount: paid.reduce((s, w) => s + w.amount, 0),
        paymentStatus: "paid", bankAccountId: bankId,
        plannedPayAt: planAt, paidAt,
      }});
      await prisma.work.createMany({ data: paid.map(w => ({
        executorId, projectId, workTypeId,
        executionYear: m.year, executionMonth: m.month,
        techTask: w.task, amount: w.amount, workStatus: "paid" as const,
        volume: w.vol ?? null, rate: w.rate ?? null,
        checkedAt: planAt, plannedPayAt: planAt, paidAt,
        paymentId: pay.id,
      }))});
    }

    if (checked.length > 0) {
      const checkedAt = md(m.year, m.month, 25);
      const planAt    = nextMD(m.year, m.month, 5);
      const pay = await prisma.payment.create({ data: {
        executorId, periodYear: m.year, periodMonth: m.month,
        amount: checked.reduce((s, w) => s + w.amount, 0),
        paymentStatus: "planned", bankAccountId: bankId, plannedPayAt: planAt,
      }});
      await prisma.work.createMany({ data: checked.map(w => ({
        executorId, projectId, workTypeId,
        executionYear: m.year, executionMonth: m.month,
        techTask: w.task, amount: w.amount, workStatus: "checked" as const,
        volume: w.vol ?? null, rate: w.rate ?? null,
        checkedAt, plannedPayAt: planAt,
        paymentId: pay.id,
      }))});
    }

    if (other.length > 0) {
      await prisma.work.createMany({ data: other.map(w => ({
        executorId, projectId, workTypeId,
        executionYear: m.year, executionMonth: m.month,
        techTask: w.task, amount: w.amount, workStatus: (w.status ?? "submitted") as WorkStatus,
        volume: w.vol ?? null, rate: w.rate ?? null,
      }))});
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Справочники
// ─────────────────────────────────────────────────────────────────────────────

async function seedUsers(hash: string) {
  await prisma.user.upsert({
    where: { email: "admin@kpd.local" },
    update: { fullName: "Админ Админов", role: "admin", isSuperAdmin: true, isActive: true },
    create: {
      email: "admin@kpd.local",
      password: hash,
      fullName: "Админ Админов",
      role: "admin",
      isSuperAdmin: true,
      isActive: true,
    },
  });
}

/** Ответственные = исполнители с isResponsible; статус PM ≠ статус исполнителя. */
async function seedResponsibleManagers(hash: string) {
  const opsAcc = await prisma.bankAccount.findFirst({ where: { isDefault: true } });
  const wtMgmt = await prisma.workType.findFirst({ where: { name: "Руководство проектом" } });
  const wtStrategy = await prisma.workType.findFirst({ where: { name: "Стратегия" } });

  const managers = [
    {
      email: "manager.ivanov@kpd.local",
      name: "Иванов Сергей",
      companyStatus: "core",
      responsibleActive: true,
      inTgChat: true,
    },
    {
      email: "manager.petrov@kpd.local",
      name: "Петров Андрей",
      companyStatus: "core",
      responsibleActive: true,
      inTgChat: true,
    },
    {
      email: "manager.sokolova@kpd.local",
      name: "Соколова Марина",
      companyStatus: "orbit",
      responsibleActive: true,
      inTgChat: false,
    },
    {
      email: "manager.archived@kpd.local",
      name: "Сидоров Олег",
      companyStatus: "orbit",
      responsibleActive: false,
      inTgChat: false,
    },
  ] as const;

  for (const m of managers) {
    const user = await prisma.user.upsert({
      where: { email: m.email },
      update: { fullName: m.name, role: "executor", isActive: true },
      create: {
        email: m.email,
        password: hash,
        fullName: m.name,
        role: "executor",
        isActive: true,
      },
    });

    const existingByUser = await prisma.executor.findFirst({ where: { userId: user.id } });
    const existingByName = await prisma.executor.findFirst({ where: { name: m.name } });

    const exec = existingByUser ?? existingByName;
    const executor = exec
      ? await prisma.executor.update({
          where: { id: exec.id },
          data: {
            userId: user.id,
            name: m.name,
            type: "permanent",
            companyStatus: m.companyStatus,
            recipientType: "З/П в РФ налог 30%",
            isResponsible: true,
            responsibleActive: m.responsibleActive,
            status: "active",
            contactEmail: m.email,
            accessEmail: m.email,
            accessRevokedAt: null,
            defaultBankAccountId: opsAcc?.id ?? null,
            inTgChat: m.inTgChat,
            specialty: "Руководитель проектов",
          },
        })
      : await prisma.executor.create({
          data: {
            userId: user.id,
            name: m.name,
            type: "permanent",
            companyStatus: m.companyStatus,
            recipientType: "З/П в РФ налог 30%",
            isResponsible: true,
            responsibleActive: m.responsibleActive,
            status: "active",
            contactEmail: m.email,
            accessEmail: m.email,
            defaultBankAccountId: opsAcc?.id ?? null,
            inTgChat: m.inTgChat,
            specialty: "Руководитель проектов",
            onboardingSeeded: true,
          },
        });

    for (const wt of [wtMgmt, wtStrategy].filter(Boolean)) {
      await prisma.executorWorkType.upsert({
        where: { executorId_workTypeId: { executorId: executor.id, workTypeId: wt!.id } },
        update: {},
        create: { executorId: executor.id, workTypeId: wt!.id },
      });
    }
  }

  console.log(`[seed] responsible managers: ${managers.length} (executor + isResponsible)`);
}

async function loadResponsibleUsers() {
  return Promise.all([
    prisma.user.findUnique({ where: { email: "manager.ivanov@kpd.local" } }),
    prisma.user.findUnique({ where: { email: "manager.petrov@kpd.local" } }),
    prisma.user.findUnique({ where: { email: "manager.sokolova@kpd.local" } }),
  ]);
}

async function seedBankAccounts() {
  const accounts = [
    { name: "Операционный счёт",         isDefault: true,  status: "active"   },
    { name: "ИП Иванов — Тинькофф",      isDefault: false, status: "active"   },
    { name: "ИП Петров — Альфа",         isDefault: false, status: "active"   },
    { name: "Расчётный счёт 4DEV",       isDefault: false, status: "active"   },
    { name: "Старый счёт Сбер",          isDefault: false, status: "archived" },
  ];
  for (const a of accounts) {
    const ex = await prisma.bankAccount.findFirst({ where: { name: a.name } });
    if (ex) {
      await prisma.bankAccount.update({ where: { id: ex.id }, data: a });
    } else {
      await prisma.bankAccount.create({ data: a });
    }
  }
}

async function seedWorkTypes() {
  const types = [
    { name: "Дизайн посадочной",      segment: "Визуал"             },
    { name: "Инфографика",             segment: "Визуал"             },
    { name: "Лонгрид",                 segment: "Текст"              },
    { name: "Email-маркетинг",         segment: "Продвижение"        },
    { name: "Монтаж видео",            segment: "Видео"              },
    { name: "Сценарий ролика",         segment: "Видео"              },
    { name: "SMM-ведение",             segment: "Продвижение"        },
    { name: "Контекстная реклама",     segment: "Продвижение"        },
    { name: "PR-аналитика",            segment: "Аналитика"          },
    { name: "Руководство проектом",    segment: "Менеджмент"         },
    { name: "Стратегия",               segment: "Менеджмент"         },
    { name: "Поддержка сайта",         segment: "IT"                 },
    { name: "Экспертный комментарий",  segment: "Экспертиза"         },
    { name: "Транзит платежа",         segment: "Транзитные платежи", status: "archived" },
  ];
  for (const t of types) {
    await prisma.workType.upsert({
      where:  { name: t.name },
      update: { segment: t.segment, status: (t as { status?: string }).status ?? "active" },
      create: { name: t.name, segment: t.segment, status: (t as { status?: string }).status ?? "active" },
    });
  }
}

async function seedClients() {
  const clients = [
    { company: "Базис",         department: "Контент – PR", status: "active"   },
    { company: "Норникель",     department: "PR",           status: "active"   },
    { company: "X5",            department: "Маркетинг",    status: "active"   },
    { company: "КПД",           department: "Внутренний",   status: "active"   },
    { company: "Сбербанк",      department: "Маркетинг",    status: "active"   },
    { company: "Газпром нефть", department: "PR",           status: "active"   },
    { company: "VK",            department: "Digital",      status: "active"   },
    { company: "Ростелеком",    department: "Контент",      status: "archived" },
    { company: "Старый клиент", department: "Архив",        status: "archived" },
  ];
  for (const c of clients) {
    const name = `${c.department} – ${c.company}`;
    await prisma.client.upsert({
      where:  { name },
      update: { company: c.company, department: c.department, status: c.status },
      create: { name, company: c.company, department: c.department, status: c.status },
    });
  }
}

async function seedProjects() {
  const [ivanov, petrov, sokolova] = await loadResponsibleUsers();
  const clients = await prisma.client.findMany();
  const cl = (dept: string, company: string) =>
    clients.find(c => c.name === `${dept} – ${company}`);

  const toSeed = [
    { shortName: "Контент",               client: cl("Контент – PR", "Базис"),       resp: ivanov,   status: "active"   },
    { shortName: "SMM Q3",                client: cl("PR",           "Норникель"),    resp: ivanov,   status: "active"   },
    { shortName: "Запуск приложения",     client: cl("Маркетинг",    "X5"),           resp: petrov,   status: "active"   },
    { shortName: "База знаний",           client: cl("Внутренний",   "КПД"),          resp: sokolova, status: "active"   },
    { shortName: "Ребрендинг",            client: cl("Маркетинг",    "Сбербанк"),     resp: petrov,   status: "active"   },
    { shortName: "PR-кампания Q4",        client: cl("PR",           "Газпром нефть"),resp: ivanov,   status: "active"   },
    { shortName: "Digital-присутствие",   client: cl("Digital",      "VK"),           resp: sokolova, status: "active"   },
    { shortName: "Видеопроизводство",     client: cl("PR",           "Норникель"),    resp: petrov,   status: "active"   },
    { shortName: "Внутренний портал",     client: cl("Внутренний",   "КПД"),          resp: sokolova, status: "active"   },
    { shortName: "Старый проект",         client: cl("Маркетинг",    "X5"),           resp: petrov,   status: "archived" },
    { shortName: "Проект Ростелеком",     client: cl("Контент",      "Ростелеком"),   resp: ivanov,   status: "archived" },
    { shortName: "Архивный 2",            client: cl("Маркетинг",    "Сбербанк"),     resp: petrov,   status: "archived" },
  ];

  for (const p of toSeed) {
    if (!p.client) continue;
    const name = `${p.shortName} – ${p.client.name}`;
    const type = p.client.name.toLowerCase().includes("кпд") ? "internal" : "client";
    const ex = await prisma.project.findFirst({ where: { clientId: p.client.id, shortName: p.shortName } });
    if (ex) {
      await prisma.project.update({ where: { id: ex.id }, data: { name, type, status: p.status, responsibleUserId: p.resp?.id ?? null } });
    } else {
      await prisma.project.create({ data: { shortName: p.shortName, name, type, status: p.status, clientId: p.client.id, responsibleUserId: p.resp?.id ?? null } });
    }
  }
}

async function seedOrders() {
  const projects = await prisma.project.findMany();
  const descs: Record<string, string[]> = {
    "Контент":              ["Контент-производство Q1 2025", "Контент-производство Q3 2025", "Контент-план Q1 2026"],
    "SMM Q3":               ["SMM-ведение Норникель Q2 2025", "SMM-ведение Q4 2025", "SMM Q1 2026"],
    "Запуск приложения":    ["Маркетинг запуска мобильного приложения", "Поддержка кампании Q3 2025"],
    "Ребрендинг":           ["Ребрендинг Сбербанк — концепция", "Ребрендинг — производство"],
    "PR-кампания Q4":       ["PR-кампания Газпром нефть Q4 2025", "PR-поддержка 2026"],
    "Digital-присутствие":  ["Digital VK — стратегия", "Digital — реализация 2026"],
    "Видеопроизводство":    ["Видеопроизводство Норникель 2025", "Видеосерия 2026"],
    "Внутренний портал":    ["Внутренний портал — разработка"],
    "База знаний":          ["Внутренняя БЗ — поддержка и развитие"],
  };
  const last = await prisma.order.findFirst({ orderBy: { orderNumber: "desc" } });
  const lastNum = last ? (parseInt(last.orderNumber.replace(/\D/g, "")) || 0) : 2999;
  let n = lastNum < 3000 ? 3000 : lastNum + 1;
  for (const p of projects) {
    const descList = descs[p.shortName];
    if (!descList) continue;
    for (const desc of descList) {
      const ex = await prisma.order.findFirst({ where: { projectId: p.id, description: desc } });
      if (ex) continue;
      await prisma.order.create({ data: { orderNumber: `З${n++}`, description: desc, projectId: p.id, status: p.status === "archived" ? "archived" : "active" } });
    }
  }
}

async function seedExecutors(hash: string) {
  const [[ivanov, petrov, sokolova], opsAcc] = await Promise.all([
    loadResponsibleUsers(),
    prisma.bankAccount.findFirst({ where: { isDefault: true } }),
  ]);
  const wts = await prisma.workType.findMany({ where: { status: "active" } });
  const wt  = (name: string) => wts.find(w => w.name === name);

  type SE = {
    name: string;
    type: "permanent" | "external" | "service" | "bank";
    email?: string;
    companyStatus?: string;
    recipientType?: string;
    resp?: typeof ivanov;
    specialty?: string;
    workTypes?: string[];
    status?: string;
    hasAccess?: boolean;
    inTgChat?: boolean;
  };

  const list: SE[] = [
    // ── permanent ────────────────────────────────────────────────────────────
    { name: "Смирнов Алексей",    type: "permanent",       email: "executor.smirnov@kpd.local",
      companyStatus: "core",   recipientType: "З/П в РФ налог 30%",
      resp: ivanov,   specialty: "Дизайнер",      workTypes: ["Дизайн посадочной","Инфографика"],        hasAccess: true, inTgChat: true },
    { name: "Морозова Елена",     type: "permanent",       email: "executor.morozova@kpd.local",
      companyStatus: "orbit",  recipientType: "З/П в РФ налог 15%",
      resp: sokolova, specialty: "Видеомонтажёр",  workTypes: ["Монтаж видео","SMM-ведение"],             hasAccess: true, inTgChat: true },
    { name: "Волков Кирилл",      type: "permanent",       email: "executor.volkov@kpd.local",
      companyStatus: "orbit",  recipientType: "З/П в РФ налог 15%",
      resp: ivanov,   specialty: "Дизайнер",      workTypes: ["Дизайн посадочной","Инфографика"],        hasAccess: true, inTgChat: false },
    // ── external (с логином) ─────────────────────────────────────────────────
    { name: "Козлова Анна",       type: "external", email: "executor.kozlova@kpd.local",
      recipientType: "Самозанятый в РФ",
      resp: ivanov,   specialty: "Копирайтер",    workTypes: ["Лонгрид","Сценарий ролика"],              hasAccess: true, inTgChat: true },
    { name: "Захаров Дмитрий",    type: "external", email: "executor.zakharov@kpd.local",
      recipientType: "Самозанятый в РФ",
      resp: petrov,   specialty: "Аналитик",      workTypes: ["PR-аналитика","Стратегия"],               hasAccess: true, inTgChat: true },
    { name: "Орлова Виктория",    type: "external", email: "executor.orlova@kpd.local",
      recipientType: "Самозанятый в РФ",
      resp: sokolova, specialty: "Копирайтер",    workTypes: ["Лонгрид","Email-маркетинг"],              hasAccess: true, inTgChat: false },
    { name: "Петров Иван",        type: "external", email: "executor.petrov@kpd.local",
      recipientType: "Самозанятый в РФ",
      resp: petrov,   specialty: "Видеомонтаж",   workTypes: ["Монтаж видео"],                           hasAccess: false },
    { name: "Сидорова Наталья",   type: "external", email: "executor.sidorova@kpd.local",
      recipientType: "Физлицо на карту РФ",
      resp: ivanov,   specialty: "PR-специалист", workTypes: ["PR-аналитика","Экспертный комментарий"],  hasAccess: true, inTgChat: true },
    // ── external (без логина) ────────────────────────────────────────────────
    { name: "Рога и Копыта ООО",  type: "external",
      recipientType: "Юрлицо в РФ", resp: petrov, workTypes: ["Поддержка сайта"] },
    { name: "Медиа Старт ИП",     type: "external",
      recipientType: "ИП в РФ",     resp: sokolova, workTypes: ["SMM-ведение","Контекстная реклама"] },
    // ── service / bank (без логина) ──────────────────────────────────────────
    { name: "MIDJOURNEY",  type: "service", recipientType: "Сервис заруб." },
    { name: "FIGMA",       type: "service", recipientType: "Сервис заруб." },
    { name: "Тинькофф",    type: "bank",    recipientType: "Юрлицо в РФ" },
    // ── archived ─────────────────────────────────────────────────────────────
    { name: "Старый исполнитель",  type: "external", email: "old.executor@kpd.local",
      recipientType: "Самозанятый в РФ", status: "archived" },
    { name: "Ушедший дизайнер",    type: "permanent", email: "old.designer@kpd.local",
      companyStatus: "core",  recipientType: "З/П в РФ налог 30%",
      specialty: "Дизайнер",  status: "archived" },
  ];

  for (const e of list) {
    const ex = await prisma.executor.findFirst({ where: { name: e.name } });
    if (ex) continue;

    let userId: string | null = null;
    if (e.email && (e.type === "permanent" || e.type === "external")) {
      const u = await prisma.user.upsert({
        where:  { email: e.email },
        update: {},
        create: {
          email: e.email,
          password: hash,
          fullName: e.name,
          role: "executor",
          isActive: e.status !== "archived" && e.hasAccess !== false,
        },
      });
      userId = u.id;
    }

    const exec = await prisma.executor.create({ data: {
      name: e.name, type: e.type, userId,
      companyStatus: e.companyStatus ?? null,
      recipientType: e.recipientType ?? null, specialty: e.specialty ?? null,
      responsibleUserId: e.resp?.id ?? null,
      defaultBankAccountId: opsAcc?.id ?? null,
      inTgChat: e.inTgChat ?? false,
      status: e.status ?? "active",
      contactEmail: e.email ?? null,
      accessEmail:
        e.email && e.hasAccess !== false && e.status !== "archived" ? e.email : null,
      accessRevokedAt: e.hasAccess === false || e.status === "archived" ? new Date() : null,
    }});

    for (const wtName of e.workTypes ?? []) {
      const wtype = wt(wtName);
      if (wtype) await prisma.executorWorkType.create({ data: { executorId: exec.id, workTypeId: wtype.id } });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Работы и выплаты
// ─────────────────────────────────────────────────────────────────────────────

async function seedWorksAndPayments() {
  const already = await prisma.work.count();
  if (already > 0) return;

  // ── resolve lookups ────────────────────────────────────────────────────────
  const [
    smirnov, kozlova, morozova, volkov,
    zakharov, orlova, petrovI, sidorova,
  ] = await Promise.all([
    prisma.executor.findFirst({ where: { name: "Смирнов Алексей" } }),
    prisma.executor.findFirst({ where: { name: "Козлова Анна" } }),
    prisma.executor.findFirst({ where: { name: "Морозова Елена" } }),
    prisma.executor.findFirst({ where: { name: "Волков Кирилл" } }),
    prisma.executor.findFirst({ where: { name: "Захаров Дмитрий" } }),
    prisma.executor.findFirst({ where: { name: "Орлова Виктория" } }),
    prisma.executor.findFirst({ where: { name: "Петров Иван" } }),
    prisma.executor.findFirst({ where: { name: "Сидорова Наталья" } }),
  ]);

  const [
    pContent, pSmm, pRebrand, pPR, pDigital,
    pVideo, pPortal, pApp,
  ] = await Promise.all([
    prisma.project.findFirst({ where: { shortName: "Контент",              status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "SMM Q3",               status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "Ребрендинг",           status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "PR-кампания Q4",       status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "Digital-присутствие",  status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "Видеопроизводство",    status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "Внутренний портал",    status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "Запуск приложения",    status: "active" } }),
  ]);

  const [
    wtDesign, wtInfo, wtLong, wtEmail,
    wtVideo, wtSmm, wtPR, wtStrat, wtIT,
  ] = await Promise.all([
    prisma.workType.findFirst({ where: { name: "Дизайн посадочной" } }),
    prisma.workType.findFirst({ where: { name: "Инфографика"       } }),
    prisma.workType.findFirst({ where: { name: "Лонгрид"           } }),
    prisma.workType.findFirst({ where: { name: "Email-маркетинг"   } }),
    prisma.workType.findFirst({ where: { name: "Монтаж видео"      } }),
    prisma.workType.findFirst({ where: { name: "SMM-ведение"       } }),
    prisma.workType.findFirst({ where: { name: "PR-аналитика"      } }),
    prisma.workType.findFirst({ where: { name: "Стратегия"         } }),
    prisma.workType.findFirst({ where: { name: "Поддержка сайта"   } }),
  ]);

  const bankId = (await prisma.bankAccount.findFirst({ where: { isDefault: true } }))?.id ?? null;

  // helper to upsert project↔executor link
  const link = async (proj: { id: string } | null, exec: { id: string } | null) => {
    if (!proj || !exec) return;
    await prisma.projectExecutor.upsert({
      where:  { projectId_executorId: { projectId: proj.id, executorId: exec.id } },
      update: {}, create: { projectId: proj.id, executorId: exec.id },
    });
  };

  // ── link executors to projects ────────────────────────────────────────────
  await Promise.all([
    link(pContent, smirnov), link(pContent, kozlova),  link(pContent, zakharov),
    link(pSmm,    smirnov),  link(pSmm,    morozova),  link(pSmm, kozlova),
    link(pRebrand, smirnov), link(pRebrand, volkov),   link(pRebrand, zakharov),
    link(pPR,      kozlova), link(pPR,      zakharov), link(pPR, sidorova),
    link(pDigital, volkov),  link(pDigital, orlova),   link(pDigital, morozova),
    link(pVideo,   petrovI), link(pVideo,   morozova),
    link(pPortal,  volkov),  link(pPortal,  orlova),
    link(pApp,     smirnov), link(pApp,     petrovI),
  ]);

  // ── Task-name pools per work type ─────────────────────────────────────────
  const T_DESIGN = [
    "Дизайн главной страницы",           "Дизайн раздела «О компании»",
    "Дизайн карточек продуктов",         "Баннеры для соцсетей (серия)",
    "Редизайн блока FAQ",                "Адаптивный дизайн мобильной версии",
    "Дизайн форм обратной связи",        "Иконки для интерфейса",
    "Обложки для YouTube-канала",        "Дизайн email-шаблона",
    "Иллюстрации для презентации",       "Оформление кейса для портфолио",
    "Дизайн страницы акции",             "Шаблоны для Stories",
    "Ребрендинг логотипа — версия X",    "Редизайн страницы условий",
    "Дизайн лендинга для события",       "Дизайн блока «Команда»",
    "Баннеры для контекстной рекламы",   "Дизайн раздела «Цены»",
  ];
  const T_INFO = [
    "Инфографика «Итоги года»",          "Инфографика процессов производства",
    "Инфографика для отчёта",            "Инфографика KPI команды",
    "Схема бизнес-процесса",             "Визуализация данных аналитики",
    "Инфографика для соцсетей (серия)",  "Диаграмма организационной структуры",
  ];
  const T_LONG = [
    "Лонгрид «Тренды контент-маркетинга»", "Лонгрид «Кейс клиента»",
    "Статья для корпоративного блога",      "Лонгрид «Итоги квартала»",
    "Экспертная статья для СМИ",            "Лонгрид «Обзор рынка»",
    "Лонгрид «Как мы запускали проект»",    "Аналитический материал для PR",
    "Лонгрид «Тренды 2026»",               "Серия экспертных постов (5 шт.)",
    "Гайд для новых клиентов",             "Лонгрид «Наша методология»",
  ];
  const T_EMAIL = [
    "Welcome-цепочка (3 письма)",          "Дайджест за месяц",
    "Письмо об обновлении продукта",       "Реактивационная рассылка",
    "Промо-рассылка события",             "Персонализированный newsletter",
    "Серия писем для онбординга",          "Транзакционное письмо (шаблон)",
  ];
  const T_VIDEO = [
    "Монтаж корпоративного ролика",        "Монтаж интервью (30 мин)",
    "Монтаж серии shorts (5 шт.)",         "Монтаж обучающего видео",
    "Монтаж event-видео",                  "Анимация логотипа (intro/outro)",
    "Монтаж кейс-видео",                   "Монтаж продуктового обзора",
    "Монтаж рекламного ролика 15 сек",    "Color-grading + звук",
  ];
  const T_SMM = [
    "Контент-план на месяц",               "Написание постов (серия 10 шт.)",
    "SMM-ведение Instagram*",              "Управление комьюнити месяц",
    "Анализ и отчёт по охватам",           "Stories-контент (серия)",
    "Ситуативный контент (событие)",       "Reels-серия (4 ролика)",
  ];
  const T_PR = [
    "PR-анализ медиапространства",         "Мониторинг упоминаний (квартал)",
    "Подготовка пресс-релиза",             "Анализ конкурентов — PR",
    "Стратегия присутствия в СМИ",         "Отчёт по публикациям за квартал",
    "Питч медиа (серия)",                  "Комментарий эксперта для СМИ",
  ];
  const T_STRAT = [
    "Стратегия digital-присутствия",       "Коммуникационная стратегия",
    "Дорожная карта проекта",              "Конкурентный анализ",
    "Аудит текущих каналов",               "Медиастратегия на год",
  ];

  function pick<T>(arr: T[], idx: number): T { return arr[idx % arr.length]; }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Смирнов Алексей — дизайн, 2025 (full) + 2026 (янв–июн)
  // ═══════════════════════════════════════════════════════════════════════════
  if (smirnov && pContent && wtDesign) {
    const months2025: MonthSpec[] = Array.from({ length: 12 }, (_, i) => ({
      year: 2025, month: i + 1,
      works: [
        { task: pick(T_DESIGN, i * 3),     amount: 45_000 + (i % 3) * 5_000 },
        { task: pick(T_DESIGN, i * 3 + 1), amount: 30_000 + (i % 4) * 3_000 },
        { task: pick(T_INFO,   i),          amount: 15_000, vol: 1, rate: 15_000 },
      ],
    }));
    const months2026: MonthSpec[] = [
      { year: 2026, month: 1, works: [
          { task: "Дизайн главной страницы",               amount: 50_000 },
          { task: "Дизайн карточек продуктов",             amount: 30_000 },
      ]},
      { year: 2026, month: 2, works: [
          { task: "Редизайн раздела «О компании»",         amount: 40_000 },
          { task: "Баннеры для соцсетей (x5 форматов)",   amount: 20_000 },
          { task: "Инфографика KPI команды",               amount: 12_000, status: "paid" },
      ]},
      { year: 2026, month: 3, works: [
          { task: "Анимация логотипа (intro)",             amount: 35_000 },
          { task: "Дизайн лендинга для события",          amount: 28_000 },
      ]},
      { year: 2026, month: 4, works: [
          { task: "Иллюстрации для презентации Q2",        amount: 32_000 },
          { task: "Дизайн страницы акции",                amount: 22_000 },
      ]},
      { year: 2026, month: 5, works: [
          { task: "Обложки для YouTube (возврат)",         amount: 15_000, status: "rework" },
          { task: "Шаблон email-рассылки",                 amount: 18_000, status: "checked" },
          { task: "Инфографика процессов производства",   amount: 10_000, status: "checked" },
      ]},
      { year: 2026, month: 6, works: [
          { task: "Дизайн кейса для портфолио",           amount: 30_000, status: "submitted", vol: 3, rate: 10_000 },
          { task: "Адаптив мобильной версии сайта",       amount: 22_000, status: "submitted" },
      ]},
    ];
    await seedMonths(smirnov.id, pContent.id, wtDesign.id, bankId, months2025);
    await seedMonths(smirnov.id, pRebrand?.id ?? pContent.id, wtDesign.id, bankId, months2026);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Козлова Анна — тексты, 2025 (мар–дек) + 2026 (янв–июн)
  // ═══════════════════════════════════════════════════════════════════════════
  if (kozlova && pContent && wtLong) {
    const months2025: MonthSpec[] = Array.from({ length: 10 }, (_, i) => ({
      year: 2025, month: i + 3,
      works: [
        { task: pick(T_LONG,  i * 2),     amount: 35_000 + (i % 4) * 5_000, vol: 2, rate: (35_000 + (i % 4) * 5_000) / 2 },
        { task: pick(T_EMAIL, i),          amount: 18_000 + (i % 3) * 2_000 },
      ],
    }));
    const months2026: MonthSpec[] = [
      { year: 2026, month: 1, works: [
          { task: "Лонгрид «Тренды контент-маркетинга 2026»", amount: 45_000, vol: 3, rate: 15_000 },
          { task: "Welcome-цепочка (3 письма)",                amount: 18_000 },
      ]},
      { year: 2026, month: 2, works: [
          { task: "Серия экспертных постов (5 шт.)",           amount: 25_000 },
          { task: "Дайджест за февраль",                       amount: 12_000 },
      ]},
      { year: 2026, month: 3, works: [
          { task: "Сценарий видеоролика для запуска",          amount: 30_000 },
          { task: "Лонгрид «Кейс клиента»",                   amount: 28_000 },
      ]},
      { year: 2026, month: 4, works: [
          { task: "Лонгрид для блога: методология",            amount: 25_000, status: "checked" },
          { task: "Промо-рассылка события",                    amount: 14_000, status: "checked" },
      ]},
      { year: 2026, month: 5, works: [
          { task: "Тексты для лендинга (5 блоков)",           amount: 20_000, status: "submitted" },
          { task: "Email-серия для онбординга",               amount: 15_000, status: "submitted" },
      ]},
      { year: 2026, month: 6, works: [
          { task: "Гайд для новых клиентов",                  amount: 22_000, status: "submitted" },
      ]},
    ];
    await seedMonths(kozlova.id, pContent.id, wtLong.id, bankId, months2025);
    await seedMonths(kozlova.id, pPR?.id ?? pContent.id, wtLong.id, bankId, months2026);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Морозова Елена — видеомонтаж, 2025 (апр–дек) + 2026 (янв–июн)
  // ═══════════════════════════════════════════════════════════════════════════
  if (morozova && wtVideo) {
    const proj = pVideo ?? pSmm ?? pContent!;
    const months2025: MonthSpec[] = Array.from({ length: 9 }, (_, i) => ({
      year: 2025, month: i + 4,
      works: [
        { task: pick(T_VIDEO, i * 2),     amount: 40_000 + (i % 5) * 5_000 },
        { task: pick(T_SMM,   i),          amount: 22_000 + (i % 3) * 2_000 },
      ],
    }));
    const months2026: MonthSpec[] = [
      { year: 2026, month: 1, works: [
          { task: "Монтаж корпоративного ролика Q1",     amount: 55_000 },
      ]},
      { year: 2026, month: 2, works: [
          { task: "Монтаж серии shorts (5 шт.)",         amount: 40_000 },
          { task: "Контент-план февраль",                amount: 20_000 },
      ]},
      { year: 2026, month: 3, works: [
          { task: "Монтаж event-видео (конференция)",    amount: 50_000 },
          { task: "Reels-серия (4 ролика)",              amount: 28_000 },
      ]},
      { year: 2026, month: 4, works: [
          { task: "Монтаж кейс-видео",                  amount: 45_000, status: "checked" },
          { task: "Написание постов апрель",            amount: 18_000, status: "checked" },
      ]},
      { year: 2026, month: 5, works: [
          { task: "Монтаж обучающего видео",            amount: 38_000, status: "submitted" },
          { task: "SMM-контент май",                    amount: 20_000, status: "submitted" },
      ]},
      { year: 2026, month: 6, works: [
          { task: "Монтаж рекламного ролика",           amount: 42_000, status: "submitted" },
      ]},
    ];
    await seedMonths(morozova.id, proj.id, wtVideo.id, bankId, months2025);
    if (wtSmm) await seedMonths(morozova.id, pSmm?.id ?? proj.id, wtSmm.id, bankId, [
      { year: 2026, month: 1, works: [{ task: "SMM-ведение январь", amount: 25_000 }] },
    ]);
    await seedMonths(morozova.id, pVideo?.id ?? proj.id, wtVideo.id, bankId, months2026);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Захаров Дмитрий — PR-аналитика, 2025 (full) + 2026 (янв–июн)
  // ═══════════════════════════════════════════════════════════════════════════
  if (zakharov && wtPR) {
    const proj = pPR ?? pContent!;
    const months2025: MonthSpec[] = Array.from({ length: 12 }, (_, i) => ({
      year: 2025, month: i + 1,
      works: [
        { task: pick(T_PR,    i * 2),     amount: 35_000 + (i % 4) * 4_000 },
        { task: pick(T_STRAT, i),          amount: 50_000 + (i % 3) * 5_000 },
      ],
    }));
    const months2026: MonthSpec[] = [
      { year: 2026, month: 1, works: [
          { task: "PR-анализ медиапространства Q1",    amount: 45_000 },
          { task: "Стратегия присутствия в СМИ 2026", amount: 60_000 },
      ]},
      { year: 2026, month: 2, works: [
          { task: "Мониторинг упоминаний февраль",     amount: 30_000 },
          { task: "Коммуникационная стратегия",        amount: 55_000 },
      ]},
      { year: 2026, month: 3, works: [
          { task: "Подготовка пресс-релиза (серия)",   amount: 40_000 },
          { task: "Аудит текущих каналов",             amount: 35_000 },
      ]},
      { year: 2026, month: 4, works: [
          { task: "Анализ конкурентов — PR Q2",        amount: 38_000, status: "checked" },
          { task: "Медиастратегия Q2–Q3",              amount: 55_000, status: "checked" },
      ]},
      { year: 2026, month: 5, works: [
          { task: "Отчёт по публикациям Q1",           amount: 32_000, status: "submitted" },
      ]},
    ];
    await seedMonths(zakharov.id, proj.id, wtPR.id, bankId, months2025);
    await seedMonths(zakharov.id, pRebrand?.id ?? proj.id, wtStrat?.id ?? wtPR.id, bankId, months2026);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Орлова Виктория — email + тексты, 2025 (июн–дек) + 2026 (янв–май)
  // ═══════════════════════════════════════════════════════════════════════════
  if (orlova && wtEmail) {
    const proj = pDigital ?? pContent!;
    const months2025: MonthSpec[] = Array.from({ length: 7 }, (_, i) => ({
      year: 2025, month: i + 6,
      works: [
        { task: pick(T_EMAIL, i * 2),     amount: 20_000 + i * 2_000 },
        { task: pick(T_LONG,  i),          amount: 28_000 + (i % 3) * 3_000 },
      ],
    }));
    const months2026: MonthSpec[] = [
      { year: 2026, month: 1, works: [
          { task: "Welcome-серия (5 писем)",            amount: 25_000 },
          { task: "Лонгрид «Digital-тренды 2026»",     amount: 30_000 },
      ]},
      { year: 2026, month: 2, works: [
          { task: "Email-кампания к запуску",           amount: 22_000 },
          { task: "Контент для блога (серия)",          amount: 28_000 },
      ]},
      { year: 2026, month: 3, works: [
          { task: "Транзакционные шаблоны (набор)",     amount: 20_000, status: "checked" },
          { task: "Лонгрид «Кейс: VK Digital»",        amount: 32_000, status: "checked" },
      ]},
      { year: 2026, month: 4, works: [
          { task: "Персонализированный newsletter",     amount: 18_000, status: "submitted" },
          { task: "Тексты для онбординга",             amount: 24_000, status: "submitted" },
      ]},
      { year: 2026, month: 5, works: [
          { task: "Реактивационная рассылка",          amount: 16_000, status: "submitted" },
      ]},
    ];
    await seedMonths(orlova.id, proj.id, wtEmail.id, bankId, months2025);
    await seedMonths(orlova.id, pPortal?.id ?? proj.id, wtEmail.id, bankId, months2026);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Петров Иван — видеомонтаж, 2025 (июл–дек) + 2026 (янв–апр)
  // ═══════════════════════════════════════════════════════════════════════════
  if (petrovI && wtVideo) {
    const proj = pVideo ?? pContent!;
    const months2025: MonthSpec[] = Array.from({ length: 6 }, (_, i) => ({
      year: 2025, month: i + 7,
      works: [
        { task: pick(T_VIDEO, i * 2 + 1), amount: 45_000 + i * 3_000 },
        { task: pick(T_VIDEO, i * 2 + 2), amount: 28_000 + i * 2_000 },
      ],
    }));
    const months2026: MonthSpec[] = [
      { year: 2026, month: 1, works: [
          { task: "Монтаж продуктового обзора",        amount: 40_000 },
          { task: "Color-grading + звуковое оформление", amount: 25_000 },
      ]},
      { year: 2026, month: 2, works: [
          { task: "Монтаж корпоративного фильма",      amount: 55_000 },
      ]},
      { year: 2026, month: 3, works: [
          { task: "Монтаж интервью CEO (45 мин)",      amount: 48_000, status: "checked" },
      ]},
      { year: 2026, month: 4, works: [
          { task: "Монтаж серии обучающих роликов",    amount: 52_000, status: "submitted" },
      ]},
    ];
    await seedMonths(petrovI.id, proj.id, wtVideo.id, bankId, months2025);
    await seedMonths(petrovI.id, pApp?.id ?? proj.id, wtVideo.id, bankId, months2026);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Волков Кирилл — дизайн, 2025 (сен–дек) + 2026 (янв–май)
  // ═══════════════════════════════════════════════════════════════════════════
  if (volkov && wtDesign) {
    const proj = pRebrand ?? pContent!;
    const months2025: MonthSpec[] = Array.from({ length: 4 }, (_, i) => ({
      year: 2025, month: i + 9,
      works: [
        { task: pick(T_DESIGN, i * 4 + 2), amount: 40_000 + i * 3_000 },
        { task: pick(T_INFO,   i),          amount: 14_000, vol: 1, rate: 14_000 },
      ],
    }));
    const months2026: MonthSpec[] = [
      { year: 2026, month: 1, works: [
          { task: "Ребрендинг логотипа — версия финал", amount: 55_000 },
          { task: "Фирменный стиль (гайдлайн)",         amount: 35_000 },
      ]},
      { year: 2026, month: 2, works: [
          { task: "Презентационный шаблон (набор)",      amount: 30_000 },
          { task: "Инфографика для отчёта",              amount: 12_000, vol: 1, rate: 12_000 },
      ]},
      { year: 2026, month: 3, works: [
          { task: "Дизайн внутреннего портала — макеты", amount: 48_000 },
          { task: "Схема бизнес-процессов (набор)",      amount: 16_000 },
      ]},
      { year: 2026, month: 4, works: [
          { task: "Редизайн личного кабинета",          amount: 42_000, status: "checked" },
          { task: "Дизайн дашборда аналитики",          amount: 38_000, status: "checked" },
      ]},
      { year: 2026, month: 5, works: [
          { task: "Иконки и иллюстрации для портала",   amount: 22_000, status: "submitted" },
      ]},
    ];
    await seedMonths(volkov.id, proj.id, wtDesign.id, bankId, months2025);
    await seedMonths(volkov.id, pPortal?.id ?? proj.id, wtDesign.id, bankId, months2026);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Сидорова Наталья — PR, 2026 (янв–май)
  // ═══════════════════════════════════════════════════════════════════════════
  if (sidorova && wtPR) {
    const proj = pPR ?? pSmm ?? pContent!;
    const months2026: MonthSpec[] = [
      { year: 2026, month: 1, works: [
          { task: "Комментарий эксперта для Forbes",    amount: 20_000 },
          { task: "Питч медиа — серия контактов",       amount: 25_000 },
      ]},
      { year: 2026, month: 2, works: [
          { task: "Написание пресс-релиза Q1",          amount: 22_000 },
          { task: "Мониторинг и дайджест февраль",      amount: 18_000 },
      ]},
      { year: 2026, month: 3, works: [
          { task: "Отчёт по охвату публикаций",         amount: 20_000 },
          { task: "Экспертный комментарий (серия)",     amount: 28_000 },
      ]},
      { year: 2026, month: 4, works: [
          { task: "Стратегия медиаприсутствия Q2",      amount: 35_000, status: "checked" },
      ]},
      { year: 2026, month: 5, works: [
          { task: "Анализ публикаций апрель–май",       amount: 22_000, status: "submitted" },
          { task: "Питч редакциям (волна 2)",           amount: 18_000, status: "rework" },
      ]},
    ];
    await seedMonths(sidorova.id, proj.id, wtPR.id, bankId, months2026);
  }

  console.log(`[seed] works & payments seeded (total: ${await prisma.work.count()} работ, ${await prisma.payment.count()} выплат)`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Прочие траты
// ─────────────────────────────────────────────────────────────────────────────

async function seedOtherExpenses() {
  const already = await prisma.otherExpense.count();
  if (already > 0) return;

  const [ivanov, petrov, sokolova, admin] = await Promise.all([
    prisma.user.findUnique({ where: { email: "manager.ivanov@kpd.local"   } }),
    prisma.user.findUnique({ where: { email: "manager.petrov@kpd.local"   } }),
    prisma.user.findUnique({ where: { email: "manager.sokolova@kpd.local" } }),
    prisma.user.findFirst({ where: { role: "admin" } }),
  ]);

  const [midjourney, figma, rogaKopyta, mediaStart] = await Promise.all([
    prisma.executor.findFirst({ where: { name: "MIDJOURNEY" } }),
    prisma.executor.findFirst({ where: { name: "FIGMA"      } }),
    prisma.executor.findFirst({ where: { name: "Рога и Копыта ООО" } }),
    prisma.executor.findFirst({ where: { name: "Медиа Старт ИП"   } }),
  ]);

  const [pContent, pSmm, pRebrand, pPR, pDigital, pVideo, pPortal] = await Promise.all([
    prisma.project.findFirst({ where: { shortName: "Контент",             status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "SMM Q3",              status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "Ребрендинг",          status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "PR-кампания Q4",      status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "Digital-присутствие", status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "Видеопроизводство",   status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "Внутренний портал",   status: "active" } }),
  ]);

  const [wtSmm, wtIt, wtVideo, wtLong] = await Promise.all([
    prisma.workType.findFirst({ where: { name: "SMM-ведение"   } }),
    prisma.workType.findFirst({ where: { name: "Поддержка сайта" } }),
    prisma.workType.findFirst({ where: { name: "Монтаж видео"  } }),
    prisma.workType.findFirst({ where: { name: "Лонгрид"       } }),
  ]);

  const bankId = (await prisma.bankAccount.findFirst({ where: { isDefault: true } }))?.id ?? null;

  if (!admin || !ivanov) return;

  type OE = {
    projectId: string; executorId: string; workTypeId: string;
    responsibleUserId: string; createdById: string;
    executionYear: number; executionMonth: number;
    description: string; amount: number;
    workStatus: string; paymentStatus: string | null;
    bankAccountId?: string | null;
    paymentAmount?: number; plannedPayAt?: Date; paidAt?: Date;
    checkedAt?: Date; preferredPayMethod?: string;
  };
  const rows: OE[] = [];

  const mkOE = (
    year: number, month: number,
    proj: { id: string } | null,
    exec: { id: string } | null,
    wt: { id: string } | null,
    resp: { id: string } | null,
    createdBy: { id: string } | null,
    desc: string, amount: number,
    wStatus: string, pStatus: string | null,
    extra?: Partial<OE>,
  ): OE | null => {
    if (!proj || !exec || !wt || !resp || !createdBy) return null;
    return {
      projectId: proj.id, executorId: exec.id, workTypeId: wt.id,
      responsibleUserId: resp.id, createdById: createdBy.id,
      executionYear: year, executionMonth: month,
      description: desc, amount,
      workStatus: wStatus, paymentStatus: pStatus,
      bankAccountId: bankId ?? undefined,
      ...extra,
    };
  };

  // 2025
  rows.push(...[
    mkOE(2025, 3,  pContent, midjourney, wtSmm, ivanov, admin,    "Подписка Midjourney — март 2025",       3_000,   "paid", "paid",    { paymentAmount: 3_000,   plannedPayAt: md(2025, 3,  1), paidAt: md(2025, 3,  1), preferredPayMethod: "4DEV" }),
    mkOE(2025, 3,  pContent, rogaKopyta, wtIt,  petrov, admin,    "Поддержка сайта — март 2025",          80_000,  "paid", "paid",    { paymentAmount: 80_000,  plannedPayAt: md(2025, 3, 31), paidAt: md(2025, 4,  2) }),
    mkOE(2025, 5,  pSmm,     mediaStart, wtSmm, ivanov, ivanov,   "Реклама ВКонтакте — май 2025",         50_000,  "paid", "paid",    { paymentAmount: 50_000,  plannedPayAt: md(2025, 5, 10), paidAt: md(2025, 5, 12), preferredPayMethod: "ИП в РФ" }),
    mkOE(2025, 6,  pContent, midjourney, wtSmm, ivanov, ivanov,   "Подписка Midjourney — июнь 2025",       3_000,   "paid", "paid",    { paymentAmount: 3_000,   plannedPayAt: md(2025, 6,  1), paidAt: md(2025, 6,  1), preferredPayMethod: "4DEV" }),
    mkOE(2025, 6,  pContent, figma,      wtIt,  sokolova, admin,  "Подписка Figma (team) — H1 2025",      15_000,  "paid", "paid",    { paymentAmount: 15_000,  plannedPayAt: md(2025, 6, 15), paidAt: md(2025, 6, 15), preferredPayMethod: "4DEV" }),
    mkOE(2025, 8,  pSmm,     mediaStart, wtSmm, ivanov, ivanov,   "Таргетированная реклама — август",     70_000,  "paid", "paid",    { paymentAmount: 70_000,  plannedPayAt: md(2025, 8, 20), paidAt: md(2025, 8, 22) }),
    mkOE(2025, 9,  pContent, rogaKopyta, wtIt,  petrov, admin,    "Поддержка сайта — Q3 2025",            80_000,  "paid", "paid",    { paymentAmount: 80_000,  plannedPayAt: md(2025, 9, 30), paidAt: md(2025, 10, 2) }),
    mkOE(2025, 9,  pContent, midjourney, wtSmm, ivanov, admin,    "Подписка Midjourney — Q3 2025",         9_000,   "paid", "paid",    { paymentAmount: 9_000,   plannedPayAt: md(2025, 9,  1), paidAt: md(2025, 9,  1), preferredPayMethod: "4DEV" }),
    mkOE(2025, 10, pVideo,   midjourney, wtVideo, petrov, admin,  "Стоковая музыка для видео — Q4",        8_000,   "paid", "paid",    { paymentAmount: 8_000,   plannedPayAt: md(2025, 10, 5), paidAt: md(2025, 10, 6), preferredPayMethod: "4DEV" }),
    mkOE(2025, 11, pRebrand, figma,      wtIt,   petrov, admin,   "Figma (дополнительные слоты) — Q4",    7_500,   "paid", "paid",    { paymentAmount: 7_500,   plannedPayAt: md(2025, 11, 1), paidAt: md(2025, 11, 1), preferredPayMethod: "4DEV" }),
    mkOE(2025, 12, pContent, rogaKopyta, wtIt,   petrov, admin,   "Поддержка сайта — декабрь 2025",      80_000,  "paid", "paid",    { paymentAmount: 80_000,  plannedPayAt: md(2025, 12, 31), paidAt: md(2026, 1, 5) }),
    mkOE(2025, 12, pDigital, mediaStart, wtSmm,  sokolova, admin, "Реклама Digital VK — Q4",             120_000, "paid", "paid",    { paymentAmount: 120_000, plannedPayAt: md(2025, 12, 20), paidAt: md(2025, 12, 22) }),
  ].filter((r): r is OE => r !== null));

  // 2026
  rows.push(...[
    mkOE(2026, 1,  pContent, midjourney, wtSmm, ivanov, admin,    "Подписка Midjourney — январь 2026",     3_000,   "paid", "paid",    { paymentAmount: 3_000,   plannedPayAt: md(2026, 1,  1), paidAt: md(2026, 1,  1), preferredPayMethod: "4DEV" }),
    mkOE(2026, 1,  pPortal,  figma,      wtIt,  sokolova, admin,  "Figma (team) — январь 2026",           15_000,  "paid", "paid",    { paymentAmount: 15_000,  plannedPayAt: md(2026, 1, 15), paidAt: md(2026, 1, 15), preferredPayMethod: "4DEV" }),
    mkOE(2026, 2,  pContent, rogaKopyta, wtIt,  petrov, admin,    "Поддержка сайта — февраль 2026",       80_000,  "paid", "paid",    { paymentAmount: 80_000,  plannedPayAt: md(2026, 2, 28), paidAt: md(2026, 3,  3) }),
    mkOE(2026, 2,  pSmm,     mediaStart, wtSmm, ivanov, ivanov,   "Реклама ВКонтакте — февраль 2026",     60_000,  "paid", "paid",    { paymentAmount: 60_000,  plannedPayAt: md(2026, 2, 15), paidAt: md(2026, 2, 17) }),
    mkOE(2026, 3,  pContent, midjourney, wtSmm, ivanov, admin,    "Подписка Midjourney — март 2026",       3_000,   "paid", "paid",    { paymentAmount: 3_000,   plannedPayAt: md(2026, 3,  1), paidAt: md(2026, 3,  1), preferredPayMethod: "4DEV" }),
    mkOE(2026, 3,  pRebrand, rogaKopyta, wtIt,  petrov, admin,    "Разработка сайта ребрендинг",         150_000,  "paid", "paid",    { paymentAmount: 150_000, plannedPayAt: md(2026, 3, 31), paidAt: md(2026, 4,  2) }),
    mkOE(2026, 4,  pContent, midjourney, wtSmm, ivanov, ivanov,   "Подписка Midjourney — апрель 2026",    3_000,   "checked", "planned", { paymentAmount: 3_000, plannedPayAt: md(2026, 5, 1), preferredPayMethod: "4DEV" }),
    mkOE(2026, 4,  pPortal,  rogaKopyta, wtIt,  sokolova, admin,  "Поддержка портала — апрель 2026",     80_000,  "checked", "planned", { paymentAmount: 80_000, plannedPayAt: md(2026, 5, 5) }),
    mkOE(2026, 4,  pDigital, mediaStart, wtSmm, sokolova, sokolova, "Контекстная реклама — апрель",      90_000,  "checked", "planned", { paymentAmount: 90_000, plannedPayAt: md(2026, 5, 10) }),
    mkOE(2026, 5,  pSmm,     mediaStart, wtSmm, ivanov, ivanov,   "Реклама ВКонтакте — май 2026",        70_000,  "submitted", null),
    mkOE(2026, 5,  pContent, figma,      wtIt,  sokolova, admin,  "Figma (team) — май 2026",             15_000,  "submitted", null),
    mkOE(2026, 5,  pVideo,   midjourney, wtVideo, petrov, admin,  "Стоковые материалы для видео",         12_000,  "submitted", null),
  ].filter((r): r is OE => r !== null));

  for (const row of rows) {
    await prisma.otherExpense.create({ data: row });
  }
  console.log(`[seed] other expenses seeded: ${rows.length} строк`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Начисления
// ─────────────────────────────────────────────────────────────────────────────

async function seedCharges() {
  const already = await prisma.charge.count();
  if (already > 0) return;

  const orders = await prisma.order.findMany({ where: { status: "active" }, include: { project: true } });
  const bankAccounts = await prisma.bankAccount.findMany({ where: { status: "active" } });
  if (!orders.length || !bankAccounts.length) return;

  const bankId = (bankAccounts.find(b => b.isDefault) ?? bankAccounts[0]).id;

  type Charge = {
    chargeNumber: string; bankAccountId: string; invoiceNumber: string;
    orderId: string; amount: number;
    issuedPlanAt?: Date; issuedAt?: Date; paidPlanAt?: Date; paidAt?: Date;
    status: string; paymentPurpose: string;
  };

  const byProject: Record<string, { id: string; description: string | null }[]> = {};
  for (const o of orders) {
    if (!byProject[o.project.shortName]) byProject[o.project.shortName] = [];
    byProject[o.project.shortName].push({ id: o.id, description: o.description });
  }

  const charges: Charge[] = [];
  let num = 1;
  const h = () => `H${String(num++).padStart(3, "0")}`;
  const sc = (n: number) => `СЧ-2025-${String(n).padStart(3, "0")}`;
  const sc6 = (n: number) => `СЧ-2026-${String(n).padStart(3, "0")}`;

  const addOrder = (shortName: string, idx: number = 0) =>
    byProject[shortName]?.[idx]?.id ?? orders[0].id;

  // 2025
  const c2025: Charge[] = [
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc(1),  orderId: addOrder("Контент",    0), amount: 500_000, issuedPlanAt: md(2025,2,1), issuedAt: md(2025,2,3),  paidPlanAt: md(2025,2,20), paidAt: md(2025,2,19), status: "paid",     paymentPurpose: "Контент Q1 2025 — партия 1" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc(2),  orderId: addOrder("Контент",    1), amount: 450_000, issuedPlanAt: md(2025,4,1), issuedAt: md(2025,4,5),  paidPlanAt: md(2025,5,5),  paidAt: md(2025,5,6),  status: "paid",     paymentPurpose: "Контент Q2 2025" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc(3),  orderId: addOrder("Контент",    2), amount: 600_000, issuedPlanAt: md(2025,7,1), issuedAt: md(2025,7,10), paidPlanAt: md(2025,8,10), paidAt: md(2025,8,9),  status: "paid",     paymentPurpose: "Контент Q3 2025" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc(4),  orderId: addOrder("SMM Q3",     0), amount: 350_000, issuedPlanAt: md(2025,3,1), issuedAt: md(2025,3,5),  paidPlanAt: md(2025,4,1),  paidAt: md(2025,3,31), status: "paid",     paymentPurpose: "SMM-ведение Q2 2025" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc(5),  orderId: addOrder("SMM Q3",     1), amount: 350_000, issuedPlanAt: md(2025,7,1), issuedAt: md(2025,7,8),  paidPlanAt: md(2025,8,5),  paidAt: md(2025,8,4),  status: "paid",     paymentPurpose: "SMM-ведение Q3 2025" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc(6),  orderId: addOrder("SMM Q3",     2), amount: 350_000, issuedPlanAt: md(2025,10,1),issuedAt: md(2025,10,8), paidPlanAt: md(2025,11,5), paidAt: md(2025,11,3), status: "paid",     paymentPurpose: "SMM-ведение Q4 2025" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc(7),  orderId: addOrder("Запуск приложения", 0), amount: 800_000, issuedPlanAt: md(2025,5,1), issuedAt: md(2025,5,15), paidPlanAt: md(2025,6,15), paidAt: md(2025,6,14), status: "paid",     paymentPurpose: "Маркетинг запуска — аванс" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc(8),  orderId: addOrder("Запуск приложения", 1), amount: 600_000, issuedPlanAt: md(2025,9,1), issuedAt: md(2025,9,10), paidPlanAt: md(2025,10,10),paidAt: md(2025,10,9),status: "paid",     paymentPurpose: "Маркетинг запуска — финал" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc(9),  orderId: addOrder("Ребрендинг",  0), amount: 1_200_000,issuedPlanAt:md(2025,11,1),issuedAt:md(2025,11,15),paidPlanAt:md(2025,12,15),paidAt:md(2025,12,14),status:"paid",     paymentPurpose: "Ребрендинг — концепция и гайдлайн" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc(10), orderId: addOrder("Видеопроизводство", 0), amount: 900_000, issuedPlanAt: md(2025,8,1), issuedAt: md(2025,8,20), paidPlanAt: md(2025,9,20), paidAt: md(2025,9,19), status: "paid",   paymentPurpose: "Видеосерия Норникель 2025" },
  ];

  // 2026
  const c2026: Charge[] = [
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc6(1),  orderId: addOrder("Контент",    2), amount: 550_000, issuedPlanAt: md(2026,1,15),issuedAt: md(2026,1,18), paidPlanAt: md(2026,2,20), paidAt: md(2026,2,18), status: "paid",     paymentPurpose: "Контент-план Q1 2026 — аванс" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc6(2),  orderId: addOrder("SMM Q3",     2), amount: 380_000, issuedPlanAt: md(2026,1,20),issuedAt: md(2026,1,25), paidPlanAt: md(2026,3,5),  paidAt: md(2026,3,4),  status: "paid",     paymentPurpose: "SMM Q1 2026" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc6(3),  orderId: addOrder("PR-кампания Q4", 0), amount: 700_000, issuedPlanAt: md(2026,2,1),issuedAt: md(2026,2,10),paidPlanAt: md(2026,3,10),paidAt: md(2026,3,8),  status: "paid",     paymentPurpose: "PR-кампания Q4 — старт 2026" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc6(4),  orderId: addOrder("Digital-присутствие", 0), amount: 950_000, issuedPlanAt: md(2026,3,1),issuedAt: md(2026,3,15),paidPlanAt: md(2026,4,15),paidAt: md(2026,4,14),status:"paid",  paymentPurpose: "Digital VK — стратегия и старт" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc6(5),  orderId: addOrder("Ребрендинг",  1), amount: 1_500_000,issuedPlanAt:md(2026,3,20),issuedAt:md(2026,4,1),  paidPlanAt: md(2026,5,1),  paidAt: md(2026,4,30), status: "paid",     paymentPurpose: "Ребрендинг — производство" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc6(6),  orderId: addOrder("Контент",    2), amount: 600_000, issuedPlanAt: md(2026,4,10),issuedAt: md(2026,4,15),paidPlanAt: md(2026,5,15),                        status: "to_pay",   paymentPurpose: "Контент-план Q2 2026" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc6(7),  orderId: addOrder("SMM Q3",     2), amount: 400_000, issuedPlanAt: md(2026,4,20),issuedAt: md(2026,4,25),paidPlanAt: md(2026,5,25),                        status: "to_pay",   paymentPurpose: "SMM Q2 2026" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc6(8),  orderId: addOrder("PR-кампания Q4", 1), amount: 750_000, issuedPlanAt: md(2026,5,1),                        paidPlanAt: md(2026,6,5),                         status: "planned",  paymentPurpose: "PR-поддержка Q2 2026" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc6(9),  orderId: addOrder("Digital-присутствие", 1), amount: 1_000_000,issuedPlanAt:md(2026,5,10),                paidPlanAt: md(2026,6,10),                        status: "planned",  paymentPurpose: "Digital VK — реализация" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc6(10), orderId: addOrder("Видеопроизводство", 1), amount: 1_100_000,issuedPlanAt:md(2026,5,15),                  paidPlanAt: md(2026,6,20),                        status: "planned",  paymentPurpose: "Видеосерия Норникель 2026" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc6(11), orderId: addOrder("Внутренний портал", 0), amount: 450_000, issuedPlanAt: md(2026,6,1),                   paidPlanAt: md(2026,7,1),                         status: "planned",  paymentPurpose: "Внутренний портал — разработка" },
    { chargeNumber: h(), bankAccountId: bankId, invoiceNumber: sc6(12), orderId: addOrder("База знаний",  0), amount: 200_000, issuedPlanAt: md(2026,6,15),                        paidPlanAt: md(2026,7,15),                        status: "planned",  paymentPurpose: "БЗ — поддержка Q3 2026" },
  ];

  await prisma.charge.createMany({ data: [...c2025, ...c2026] });
  console.log(`[seed] charges seeded: ${c2025.length + c2026.length} начислений`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Строки плана расходов + кэшфлоу
// ─────────────────────────────────────────────────────────────────────────────

async function seedSpendingPlanLines() {
  const already = await prisma.spendingPlanLine.count();
  if (already > 0) return;

  const admin = await prisma.user.findFirst({ where: { role: "admin" } });
  if (!admin) return;

  const [smirnov, kozlova, morozova, volkov, zakharov, orlova] = await Promise.all([
    prisma.executor.findFirst({ where: { name: "Смирнов Алексей" } }),
    prisma.executor.findFirst({ where: { name: "Козлова Анна"    } }),
    prisma.executor.findFirst({ where: { name: "Морозова Елена"  } }),
    prisma.executor.findFirst({ where: { name: "Волков Кирилл"   } }),
    prisma.executor.findFirst({ where: { name: "Захаров Дмитрий" } }),
    prisma.executor.findFirst({ where: { name: "Орлова Виктория" } }),
  ]);

  const [pContent, pSmm, pRebrand, pPR, pDigital, pPortal] = await Promise.all([
    prisma.project.findFirst({ where: { shortName: "Контент",             status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "SMM Q3",              status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "Ребрендинг",          status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "PR-кампания Q4",      status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "Digital-присутствие", status: "active" } }),
    prisma.project.findFirst({ where: { shortName: "Внутренний портал",   status: "active" } }),
  ]);

  const [wtDesign, wtLong, wtVideo, wtPR, wtEmail] = await Promise.all([
    prisma.workType.findFirst({ where: { name: "Дизайн посадочной" } }),
    prisma.workType.findFirst({ where: { name: "Лонгрид"           } }),
    prisma.workType.findFirst({ where: { name: "Монтаж видео"      } }),
    prisma.workType.findFirst({ where: { name: "PR-аналитика"      } }),
    prisma.workType.findFirst({ where: { name: "Email-маркетинг"   } }),
  ]);

  const lines: Array<{
    projectId: string; executorId: string; workTypeId: string;
    year: number; week: number; amount: number;
    sourceType: "personal" | "other"; createdById: string;
  }> = [];

  type PlanCombo = {
    proj: typeof pContent;
    exec: typeof smirnov;
    wt:   typeof wtDesign;
    src:  "personal" | "other";
    base: number; variance: number;
    weekStart: number; weekEnd: number; years: number[];
  };

  const combos: PlanCombo[] = [
    { proj: pContent,  exec: smirnov,  wt: wtDesign, src: "personal", base: 40_000, variance: 15_000, weekStart: 1, weekEnd: 52, years: [2025, 2026] },
    { proj: pContent,  exec: kozlova,  wt: wtLong,   src: "personal", base: 30_000, variance: 10_000, weekStart: 1, weekEnd: 52, years: [2025, 2026] },
    { proj: pSmm,      exec: morozova, wt: wtVideo,  src: "personal", base: 35_000, variance: 12_000, weekStart: 14, weekEnd: 52, years: [2025, 2026] },
    { proj: pRebrand,  exec: smirnov,  wt: wtDesign, src: "personal", base: 45_000, variance: 10_000, weekStart: 1, weekEnd: 30, years: [2026] },
    { proj: pRebrand,  exec: volkov,   wt: wtDesign, src: "personal", base: 38_000, variance: 12_000, weekStart: 1, weekEnd: 30, years: [2026] },
    { proj: pPR,       exec: zakharov, wt: wtPR,     src: "other",    base: 50_000, variance: 15_000, weekStart: 1, weekEnd: 52, years: [2025, 2026] },
    { proj: pDigital,  exec: orlova,   wt: wtEmail,  src: "personal", base: 22_000, variance: 8_000,  weekStart: 22, weekEnd: 52, years: [2025, 2026] },
    { proj: pPortal,   exec: volkov,   wt: wtDesign, src: "personal", base: 35_000, variance: 10_000, weekStart: 1, weekEnd: 26, years: [2026] },
  ];

  for (const c of combos) {
    if (!c.proj || !c.exec || !c.wt) continue;
    // link executor to project
    await prisma.projectExecutor.upsert({
      where:  { projectId_executorId: { projectId: c.proj.id, executorId: c.exec.id } },
      update: {}, create: { projectId: c.proj.id, executorId: c.exec.id },
    });
    for (const year of c.years) {
      const maxWeek = year === 2026 ? Math.min(c.weekEnd, 26) : c.weekEnd; // 2026 cap at week 26
      for (let week = c.weekStart; week <= maxWeek; week++) {
        // zero-out some weeks to make it realistic
        if (week % 13 === 0) continue; // skip ~4 weeks/year (holidays)
        const amount = Math.round((c.base + (week * 7919 + year * 31) % c.variance) / 1000) * 1000;
        lines.push({ projectId: c.proj.id, executorId: c.exec.id, workTypeId: c.wt.id, year, week, amount, sourceType: c.src, createdById: admin.id });
      }
    }
  }

  if (lines.length > 0) {
    await prisma.spendingPlanLine.createMany({ data: lines });
  }

  // Стартовые балансы кэшфлоу
  await prisma.cashflowOpeningBalance.upsert({ where: { year: 2025 }, update: {}, create: { year: 2025, amount: 2_000_000 } });
  await prisma.cashflowOpeningBalance.upsert({ where: { year: 2026 }, update: {}, create: { year: 2026, amount: 1_500_000 } });

  console.log(`[seed] spending plan lines: ${lines.length} строк`);
  console.log("[seed] cashflow opening balances: 2025, 2026");
}

// ─────────────────────────────────────────────────────────────────────────────
//  Отпуска
// ─────────────────────────────────────────────────────────────────────────────

async function seedVacations() {
  const already = await prisma.vacationEntry.count();
  if (already > 0) return;

  const [smirnov, kozlova, morozova, volkov, zakharov, petrovI] = await Promise.all([
    prisma.executor.findFirst({ where: { name: "Смирнов Алексей" } }),
    prisma.executor.findFirst({ where: { name: "Козлова Анна"    } }),
    prisma.executor.findFirst({ where: { name: "Морозова Елена"  } }),
    prisma.executor.findFirst({ where: { name: "Волков Кирилл"   } }),
    prisma.executor.findFirst({ where: { name: "Захаров Дмитрий" } }),
    prisma.executor.findFirst({ where: { name: "Петров Иван"     } }),
  ]);
  const admin = await prisma.user.findFirst({ where: { role: "admin" } });

  const entries = [
    smirnov  && { executorId: smirnov.id,  startAt: md(2026,7,1),  endAt: md(2026,7,14),  daysCount: 14, status: "approved",      isPaid: true,  approvedById: admin?.id, approvedAt: md(2026,6,20), substituteContacts: "Козлова Анна, @anna_kozlova" },
    kozlova  && { executorId: kozlova.id,  startAt: md(2026,8,15), endAt: md(2026,8,28),  daysCount: 14, status: "need_approval",  isPaid: false },
    morozova && { executorId: morozova.id, startAt: md(2026,7,15), endAt: md(2026,7,28),  daysCount: 14, status: "approved",      isPaid: true,  approvedById: admin?.id, approvedAt: md(2026,7,1),  substituteContacts: "Петров Иван, @petrov_video"  },
    volkov   && { executorId: volkov.id,   startAt: md(2026,9,1),  endAt: md(2026,9,14),  daysCount: 14, status: "need_approval",  isPaid: false },
    zakharov && { executorId: zakharov.id, startAt: md(2025,12,27),endAt: md(2026,1,10),  daysCount: 10, status: "approved",      isPaid: true,  approvedById: admin?.id, approvedAt: md(2025,12,15) },
    petrovI  && { executorId: petrovI.id,  startAt: md(2026,6,15), endAt: md(2026,6,28),  daysCount: 14, status: "need_approval",  isPaid: false },
    smirnov  && { executorId: smirnov.id,  startAt: md(2026,1,2),  endAt: md(2026,1,9),   daysCount: 5,  status: "approved",      isPaid: true,  approvedById: admin?.id, approvedAt: md(2025,12,20) },
    morozova && { executorId: morozova.id, startAt: md(2026,2,20), endAt: md(2026,2,27),  daysCount: 5,  status: "approved",      isPaid: false, approvedById: admin?.id, approvedAt: md(2026,2,10) },
  ].filter((e): e is NonNullable<typeof e> => !!e);

  for (const e of entries) {
    await prisma.vacationEntry.create({ data: e });
  }
  console.log(`[seed] vacations seeded: ${entries.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Backfill «Ответственный» (KPD-284/285): Work → РП проекта, OtherExpense → по
//  responsibleUserId. Заполняет только пустые значения, существующие не трогает.
// ─────────────────────────────────────────────────────────────────────────────

async function backfillResponsibleExecutors() {
  const execByUser = new Map<string, string>();
  for (const e of await prisma.executor.findMany({
    where: { userId: { not: null } },
    select: { id: true, userId: true },
  })) {
    if (e.userId) execByUser.set(e.userId, e.id);
  }

  const projects = new Map<string, string | null>();
  for (const p of await prisma.project.findMany({ select: { id: true, responsibleUserId: true } })) {
    projects.set(p.id, p.responsibleUserId);
  }

  let works = 0;
  for (const w of await prisma.work.findMany({
    where: { responsibleExecutorId: null },
    select: { id: true, projectId: true },
  })) {
    const userId = projects.get(w.projectId) ?? null;
    const execId = userId ? execByUser.get(userId) ?? null : null;
    if (execId) {
      await prisma.work.update({ where: { id: w.id }, data: { responsibleExecutorId: execId } });
      works++;
    }
  }

  let other = 0;
  for (const o of await prisma.otherExpense.findMany({
    where: { responsibleExecutorId: null },
    select: { id: true, responsibleUserId: true },
  })) {
    const execId = o.responsibleUserId ? execByUser.get(o.responsibleUserId) ?? null : null;
    if (execId) {
      await prisma.otherExpense.update({ where: { id: o.id }, data: { responsibleExecutorId: execId } });
      other++;
    }
  }

  console.log(`[seed] backfill responsibleExecutor: works=${works}, otherExpenses=${other}`);
}

function seedEntityNumber(scope: "payout" | "issued-work" | "other-expense", year: number, serial: number) {
  const prefix = scope === "payout" ? "В" : scope === "issued-work" ? "ВР" : "ПТ";
  return `${prefix}${String(year % 100).padStart(2, "0")}.${String(serial).padStart(3, "0")}`;
}

type SeedNumberItem = {
  model: "payment" | "work" | "otherExpense";
  id: string;
  year: number;
  number: string | null;
  serial: number | null;
  paidAt: Date | null;
  plannedPayAt: Date | null;
  createdAt: Date;
};

function compareSeedNumberItems(a: SeedNumberItem, b: SeedNumberItem) {
  const ad = a.paidAt ?? a.plannedPayAt;
  const bd = b.paidAt ?? b.plannedPayAt;
  if (ad && bd && ad.getTime() !== bd.getTime()) return ad.getTime() - bd.getTime();
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

/** Seed использует bulk-create, поэтому синхронизирует номера после заполнения данных. */
async function backfillSeedEntityNumbers() {
  const [payments, works, expenses] = await Promise.all([
    prisma.payment.findMany(),
    prisma.work.findMany(),
    prisma.otherExpense.findMany(),
  ]);
  const scopes: Array<{
    scope: "payout" | "issued-work" | "other-expense";
    prefix: "payout" | "issuedWork" | "otherExpense";
    items: SeedNumberItem[];
  }> = [
    {
      scope: "payout",
      prefix: "payout",
      items: [
        ...payments.map((row) => ({ model: "payment" as const, id: row.id, year: row.payoutNumberYear ?? row.periodYear, number: row.payoutNumber, serial: row.payoutNumberSerial, paidAt: row.paidAt, plannedPayAt: row.plannedPayAt, createdAt: row.createdAt })),
        ...expenses.filter((row) => row.paymentAmount != null).map((row) => ({ model: "otherExpense" as const, id: row.id, year: row.payoutNumberYear ?? row.executionYear, number: row.payoutNumber, serial: row.payoutNumberSerial, paidAt: row.paidAt, plannedPayAt: row.plannedPayAt, createdAt: row.createdAt })),
      ],
    },
    {
      scope: "issued-work",
      prefix: "issuedWork",
      items: [
        ...works.map((row) => ({ model: "work" as const, id: row.id, year: row.issuedWorkNumberYear ?? row.executionYear, number: row.issuedWorkNumber, serial: row.issuedWorkNumberSerial, paidAt: row.paidAt, plannedPayAt: row.plannedPayAt, createdAt: row.createdAt })),
        ...expenses.map((row) => ({ model: "otherExpense" as const, id: row.id, year: row.issuedWorkNumberYear ?? row.executionYear, number: row.issuedWorkNumber, serial: row.issuedWorkNumberSerial, paidAt: row.paidAt, plannedPayAt: row.plannedPayAt, createdAt: row.createdAt })),
      ],
    },
    {
      scope: "other-expense",
      prefix: "otherExpense",
      items: expenses.map((row) => ({ model: "otherExpense" as const, id: row.id, year: row.otherExpenseNumberYear ?? row.executionYear, number: row.otherExpenseNumber, serial: row.otherExpenseNumberSerial, paidAt: row.paidAt, plannedPayAt: row.plannedPayAt, createdAt: row.createdAt })),
    },
  ];

  for (const { scope, prefix, items } of scopes) {
    const years = [...new Set(items.map((row) => row.year))];
    for (const year of years) {
      const yearRows = items.filter((row) => row.year === year);
      const used = new Set(yearRows.flatMap((row) => row.serial == null ? [] : [row.serial]));
      const rows = yearRows.filter((row) => !row.number).sort(compareSeedNumberItems);
      await prisma.$transaction(async (tx) => {
        let serial = 1;
        for (const row of rows) {
          while (used.has(serial)) serial += 1;
          const data = {
            [`${prefix}Number`]: seedEntityNumber(scope, year, serial),
            [`${prefix}NumberYear`]: year,
            [`${prefix}NumberSerial`]: serial,
          };
          if (row.model === "payment") await tx.payment.update({ where: { id: row.id }, data });
          else if (row.model === "work") await tx.work.update({ where: { id: row.id }, data });
          else await tx.otherExpense.update({ where: { id: row.id }, data });
          used.add(serial);
          serial += 1;
        }
        const maxSerial = used.size ? Math.max(...used) : 0;
        const counter = await tx.numberCounter.findUnique({
          where: { scope_year: { scope, year } },
          select: { lastValue: true },
        });
        const lastValue = Math.max(maxSerial, counter?.lastValue ?? 0);
        await tx.numberCounter.upsert({
          where: { scope_year: { scope, year } },
          create: { scope, year, lastValue },
          update: { lastValue },
        });
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[seed] start — large dataset");
  const hash = await bcrypt.hash(SEED_PASSWORD, 10);

  await seedUsers(hash);
  await seedBankAccounts();
  await seedWorkTypes();
  await seedResponsibleManagers(hash);
  await seedClients();
  await seedProjects();
  await seedOrders();
  await seedExecutors(hash);
  await seedWorksAndPayments();
  await seedOtherExpenses();
  await seedCharges();
  await seedSpendingPlanLines();
  await seedVacations();
  await backfillResponsibleExecutors();
  await backfillSeedEntityNumbers();

  const [works, payments, expenses, charges, plan] = await Promise.all([
    prisma.work.count(),
    prisma.payment.count(),
    prisma.otherExpense.count(),
    prisma.charge.count(),
    prisma.spendingPlanLine.count(),
  ]);

  console.log("\n[seed] ──────────────────────────────────");
  console.log(`[seed]  Работы:       ${works}`);
  console.log(`[seed]  Выплаты:      ${payments}`);
  console.log(`[seed]  Прочие траты: ${expenses}`);
  console.log(`[seed]  Начисления:   ${charges}`);
  console.log(`[seed]  Строк плана:  ${plan}`);
  console.log("[seed] ──────────────────────────────────");
  console.log(`[seed]  admin@kpd.local / ${SEED_PASSWORD}`);
  console.log(`[seed]  PM (исполнитель+isResponsible): manager.ivanov@, manager.petrov@, manager.sokolova@ / ${SEED_PASSWORD}`);
  console.log(`[seed]  PM в архиве (responsibleActive=false): manager.archived@kpd.local / ${SEED_PASSWORD}`);
  console.log(`[seed]  executor.smirnov@kpd.local / ${SEED_PASSWORD}`);
  console.log("[seed] done.");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
