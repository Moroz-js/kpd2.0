# КПД — frontend

Next.js-приложение для учёта проектов, смет, выплат и кэшфлоу.

## Локальная разработка

```bash
cp .env.example .env
npm install
npm run db:push
npm run db:seed   # демо-данные (SQLite)
npm run dev
```

## База данных

| Команда | Назначение |
|---------|------------|
| `npm run db:push` | Синхронизировать схему (локально SQLite) |
| `npm run db:migrate` | `db push` в Neon (нужен `DATABASE_URL` postgres) |
| `npm run db:reset` | Сброс БД + seed |
| `npm run db:seed` | Заполнить демо-данными |

Импорт из Excel (прод):

```bash
node scripts/migrate-excel.mjs              # preview
node scripts/migrate-excel.mjs --run        # локально
node scripts/migrate-excel.mjs --run --production
```

Доступы после импорта → `scripts/import-credentials.txt` (в gitignore).

## Деплой

### Staging — ветка `dev`

Ветка `dev` — стенд для внутренней проверки. Изменения в ней разворачиваются в
Vercel и используют внутреннюю базу Neon. Перед слиянием в `main` проверьте
функциональность на staging.

### Production — ветка `main`

Ветка `main` — production. При каждом push GitHub Actions:

1. устанавливает зависимости и выполняет TypeScript-проверку;
2. после успешной проверки запускает развёртывание по SSH на сервер КПД.

Не пушьте непроверенные изменения напрямую в `main`.

### База данных

Схему Neon нужно применять отдельно с соответствующим окружению `DATABASE_URL`:

```bash
npm run db:migrate
```

Локальная разработка использует SQLite (`npm run db:push`).
