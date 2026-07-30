/**
 * TaskService — CRUD для Task + онбординг (TDNB-15 §Вкладка 5).
 */
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/audit/log";

const ONBOARDING_TASKS: { title: string; comment: string }[] = [
  {
    title: "Научиться заполнять личную смету",
    comment: "Самоконтроль. У кого спросить: Анна Ерёмина @AnnaAlexEremina",
  },
  {
    title: "Завести корпоративную почту",
    comment: "Написать Дмитрию, представиться, попросить создать корпоративный ящик, получить инструкции и доступы. У кого спросить: Дервук Дмитрий @Fondervuh",
  },
  {
    title: "Оформить подпись в почтовом клиенте/клиентах",
    comment: "Инструкция: https://dcp.bitrix24.ru/knowledge/baza/UFSE9O4CGnNq/ У кого спросить: Елена Рябкина @HeleneRyabkina",
  },
  {
    title: "Поставить в свой аккаунт Zoom корпоративный фон",
    comment: "Инструкция: https://dcp.bitrix24.ru/knowledge/baza/zoom/ У кого спросить: Елена Рябкина @HeleneRyabkina",
  },
  {
    title: "Установить при желании корпоративный эмодзи в Telegram. Компания может оплатить премиум за установку эмодзи",
    comment: "Ссылка на emojipack: https://t.me/addemoji/kpdLogo У кого спросить: Елена Рябкина @HeleneRyabkina",
  },
  {
    title: "Установить при желании корпоративное фото на заставку в Telegram и WhatsApp",
    comment: "У кого спросить: Елена Рябкина @HeleneRyabkina",
  },
  {
    title: "Убедиться, что вас добавили в чат «КПД: Контент-производители»",
    comment: "У кого спросить: Елена Рябкина @HeleneRyabkina",
  },
  {
    title: "Убедиться, что вас добавили в чат «КПД off topic»",
    comment: "У кого спросить: Елена Рябкина @HeleneRyabkina",
  },
  {
    title: "Для руководителей проектов — убедиться, что вас добавили в Телеграм-чат «КПД — руководители»",
    comment: "У кого спросить: Елена Рябкина @HeleneRyabkina",
  },
  {
    title: "Добавить во вкладку браузера ссылку на Базу знаний",
    comment: "Ссылка: https://dcp.bitrix24.ru/knowledge/baza/",
  },
  {
    title: "Убедиться, что в ваш календарь в Битрикс24 добавлены регулярные общие встречи и они видны в вашем календаре (например, Google)",
    comment: "У кого спросить: Елена Рябкина @HeleneRyabkina",
  },
  {
    title: "Изучить перечень услуг КПД",
    comment: "Ссылка: https://dcp.bitrix24.ru/shop/documents-catalog/?STORE_MASTER_HIDE=Y&inventoryManagementSource=inventory&find_section_section=0&SECTION_ID=0&apply_filter=Y У кого спросить: Роман Субботин @dcp_company",
  },
  {
    title: "Изучить презентацию",
    comment: "Ссылка: https://dcp.bitrix24.ru/knowledge/baza/prezentatsiyadrugoydizayn/ У кого спросить: Роман Субботин @dcp_company",
  },
  {
    title: "Для редакторов и авторов — изучить редакционную политику",
    comment: "Ссылка: https://dcp.bitrix24.ru/knowledge/baza/70w1U9P8SDYY/ У кого спросить: Ольга Субботина @olikog",
  },
  {
    title: "Ознакомиться с мотивационной программой",
    comment: "Ссылка: https://docs.google.com/document/d/11MxwjTOryvcNqVmm6kQaoPXSJwMUkXt4fmiE72BBMv0/edit У кого спросить: Роман Субботин @dcp_company",
  },
  {
    title: "Подписать NDA",
    comment: "У кого спросить: Елена Рябкина @HeleneRyabkina",
  },
  {
    title: "Установить в браузере и на телефоне инструмент проверки правописания",
    comment: "Ссылка: https://languagetool.org У кого спросить: Елена Рябкина @HeleneRyabkina",
  },
];

export async function listTasksForExecutor(
  executorId: string,
  db: { task: { findMany: typeof prisma.task.findMany } } = prisma
) {
  return db.task.findMany({
    where: { executorId },
    orderBy: { createdAt: "asc" },
  });
}

export async function countOpenTasks(executorId: string): Promise<number> {
  return prisma.task.count({
    where: { executorId, status: { not: "done" } },
  });
}

export type CreateTaskInput = {
  title: string;
  status?: string;
  plannedDoneAt?: string | null;
  result?: string | null;
  comment?: string | null;
};

export async function createTask(
  executorId: string,
  input: CreateTaskInput,
  userId: string
) {
  const task = await prisma.task.create({
    data: {
      executorId,
      title: input.title,
      status: input.status ?? "pending",
      plannedDoneAt: input.plannedDoneAt ? new Date(input.plannedDoneAt) : null,
      result: input.result ?? null,
      comment: input.comment ?? null,
    },
  });

  await logActivity({
    userId,
    action: "create",
    entityType: "Task",
    entityId: task.id,
    entityLabel: input.title.slice(0, 60),
  });

  return task;
}

export type UpdateTaskInput = {
  status?: string;
  result?: string | null;
  comment?: string | null;
  title?: string;
  plannedDoneAt?: string | null;
};

export async function updateTask(
  taskId: string,
  patch: UpdateTaskInput,
  userId: string
) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.result !== undefined && { result: patch.result }),
      ...(patch.comment !== undefined && { comment: patch.comment }),
      ...(patch.plannedDoneAt !== undefined && {
        plannedDoneAt: patch.plannedDoneAt ? new Date(patch.plannedDoneAt) : null,
      }),
    },
  });

  await logActivity({
    userId,
    action: "update",
    entityType: "Task",
    entityId: taskId,
    entityLabel: task.title.slice(0, 60),
    changes:
      patch.status !== undefined
        ? { status: { from: task.status, to: patch.status } }
        : undefined,
  });

  return updated;
}

export async function deleteTask(taskId: string, userId: string) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  await prisma.task.delete({ where: { id: taskId } });

  await logActivity({
    userId,
    action: "delete",
    entityType: "Task",
    entityId: taskId,
    entityLabel: task.title.slice(0, 60),
  });
}

/**
 * Онбординг — сидит 17 задач при первой выдаче доступа.
 * Проверяет onboardingSeeded, чтобы не дублировать.
 */
export async function seedOnboardingTasks(executorId: string, adminUserId: string) {
  const exec = await prisma.executor.findUnique({
    where: { id: executorId },
    select: { onboardingSeeded: true },
  });

  if (!exec || exec.onboardingSeeded) return;

  await prisma.$transaction(async (tx) => {
    for (const task of ONBOARDING_TASKS) {
      await tx.task.create({
        data: {
          executorId,
          title: task.title,
          comment: task.comment,
          status: "pending",
          isOnboarding: true,
        },
      });
    }

    await tx.executor.update({
      where: { id: executorId },
      data: { onboardingSeeded: true },
    });
  });

  await logActivity({
    userId: adminUserId,
    action: "create",
    entityType: "Task",
    entityId: executorId,
    entityLabel: `Онбординг (${ONBOARDING_TASKS.length} задач)`,

  });
}
