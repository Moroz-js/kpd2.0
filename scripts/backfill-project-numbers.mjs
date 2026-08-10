import { Prisma, PrismaClient } from "@prisma/client";
import { getDatabaseUrl, isPostgresUrl } from "./database-url.mjs";

const databaseUrl = getDatabaseUrl();
const dryRun = process.argv.includes("--dry-run");

if (!isPostgresUrl(databaseUrl)) {
  console.error("[project-numbers] Бэкфилл разрешён только для PostgreSQL.");
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});
const collator = new Intl.Collator("ru", {
  sensitivity: "base",
  numeric: true,
});

function formatNumber(type, serial) {
  if (type !== "internal" && type !== "client") {
    throw new Error(`Неизвестный тип проекта: ${type}`);
  }
  const prefix = type === "internal" ? "ПВ" : "ПК";
  return `${prefix}.${String(serial).padStart(3, "0")}`;
}

try {
  const activeProjects = await prisma.project.findMany({
    where: { status: "active" },
    select: { id: true, name: true, type: true },
  });
  activeProjects.sort(
    (a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id)
  );

  const assignments = activeProjects.map((project, index) => {
    const serial = index + 1;
    return {
      ...project,
      serial,
      number: formatNumber(project.type, serial),
    };
  });

  console.log(
    `[project-numbers] Активных проектов: ${assignments.length}. ` +
      `Диапазон: ${assignments[0]?.number ?? "—"}…${assignments.at(-1)?.number ?? "—"}`
  );

  if (dryRun) {
    for (const item of assignments) {
      console.log(`${item.number}\t${item.name}`);
    }
    process.exit(0);
  }

  await prisma.$transaction(
    async (tx) => {
      // При первичном вводе нумеруются только активные проекты.
      // Очистка делает повторный запуск идемпотентным и освобождает serial архивных.
      await tx.project.updateMany({
        data: { number: null, numberSerial: null },
      });

      for (const item of assignments) {
        await tx.project.update({
          where: { id: item.id },
          data: {
            number: item.number,
            numberSerial: item.serial,
          },
        });
      }

      await tx.numberCounter.upsert({
        where: { scope_year: { scope: "project", year: 0 } },
        create: {
          scope: "project",
          year: 0,
          lastValue: assignments.length,
        },
        update: { lastValue: assignments.length },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 120_000,
    }
  );

  console.log(
    `[project-numbers] Готово: пронумеровано ${assignments.length} активных проектов.`
  );
} finally {
  await prisma.$disconnect();
}
