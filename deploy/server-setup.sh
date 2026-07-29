#!/usr/bin/env bash
# ============================================================================
# KPD — разовый setup продакшн-сервера (Ubuntu 22.04/24.04, root).
#
# Что делает (идемпотентно, ничего не удаляет):
#   1. Ставит Node.js 22, git, PostgreSQL 16 (нативно, без Docker)
#   2. Создаёт БД kpd + роль kpd
#   3. Клонирует репозиторий в /opt/kpd/app (ветка main)
#   4. (опция) Импортирует дамп с Neon, если задан NEON_DATABASE_URL (всегда перезаливает)
#   5. Собирает приложение, применяет схему Prisma
#   6. Создаёт systemd-юнит kpd-frontend (Next.js на 127.0.0.1:3000)
#   7. Подключает домен kpd.kpd.moscow через существующий Traefik
#      (только добавляет dynamic-конфиг, конфиги n8n не трогает)
#   8. Настраивает ежедневный pg_dump-бэкап
#   9. Генерирует SSH-ключ для CI-деплоя и выводит приватный ключ
#
# Запуск:
#   NEON_DATABASE_URL='postgresql://...' bash deploy/server-setup.sh
# ============================================================================
set -euo pipefail

# ── Параметры ───────────────────────────────────────────────────────────────
DOMAIN="${DOMAIN:-kpd.kpd.moscow}"
REPO_URL="${REPO_URL:-https://github.com/Moroz-js/kpd-front.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="/opt/kpd/app"
BACKUP_DIR="/opt/kpd/backups"
DB_NAME="kpd"
DB_USER="kpd"
APP_PORT="3000"
SERVICE_NAME="kpd-frontend"
SNAPSHOT_USER="kpd-app"
SNAPSHOT_SERVICE="kpd-snapshot.service"
SNAPSHOT_TIMER="kpd-snapshot.timer"
DEPLOY_KEY="/root/.ssh/kpd_deploy_ed25519"

log()  { echo -e "\033[1;32m[setup]\033[0m $*"; }
warn() { echo -e "\033[1;33m[setup]\033[0m $*"; }
err()  { echo -e "\033[1;31m[setup]\033[0m $*" >&2; }

[ "$(id -u)" -eq 0 ] || { err "Запускать под root"; exit 1; }

# ── 0. Проверка DNS ─────────────────────────────────────────────────────────
SERVER_IP=$(curl -fsS4 --max-time 10 https://ifconfig.me || hostname -I | awk '{print $1}')
DNS_IP=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
if [ -z "$DNS_IP" ]; then
  warn "DNS: $DOMAIN не резолвится. Пропиши A-запись → $SERVER_IP. SSL не выпустится, пока DNS не заработает."
elif [ "$DNS_IP" != "$SERVER_IP" ]; then
  warn "DNS: $DOMAIN → $DNS_IP, а IP сервера $SERVER_IP. Проверь A-запись."
else
  log "DNS ок: $DOMAIN → $SERVER_IP"
fi

# ── 1. Пакеты ───────────────────────────────────────────────────────────────
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  log "Устанавливаю Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
else
  log "Node.js уже установлен: $(node -v)"
fi

apt-get install -y -qq git curl

if ! command -v psql >/dev/null 2>&1; then
  log "Устанавливаю PostgreSQL 16..."
  apt-get install -y -qq postgresql-16 postgresql-client-16 2>/dev/null || apt-get install -y -qq postgresql postgresql-client
else
  log "PostgreSQL уже установлен: $(psql --version)"
fi
systemctl enable --now postgresql

# ── 2. База данных ──────────────────────────────────────────────────────────
DB_PASS_FILE="/opt/kpd/.db_password"
mkdir -p /opt/kpd
if [ -f "$DB_PASS_FILE" ]; then
  DB_PASS=$(cat "$DB_PASS_FILE")
  log "Пароль БД уже сгенерирован ранее"
else
  DB_PASS=$(openssl rand -hex 24)
  echo "$DB_PASS" > "$DB_PASS_FILE"
  chmod 600 "$DB_PASS_FILE"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  log "Создаю роль $DB_USER..."
  sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'"
else
  log "Роль $DB_USER уже существует — обновляю пароль"
  sudo -u postgres psql -c "ALTER ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  log "Создаю базу $DB_NAME..."
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
else
  log "База $DB_NAME уже существует"
fi

LOCAL_DB_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"

# ── 3. Код ──────────────────────────────────────────────────────────────────
if [ ! -d "$APP_DIR/.git" ]; then
  log "Клонирую $REPO_URL ($BRANCH) в $APP_DIR..."
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  log "Репозиторий уже клонирован — обновляю..."
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
fi
# Репо принадлежит root (setup/CI), но git pull могут делать и другие пользователи
if ! git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$APP_DIR"; then
  git config --system --add safe.directory "$APP_DIR"
  log "git safe.directory: $APP_DIR"
fi

# ── 4. Импорт дампа с Neon (всегда при заданном NEON_DATABASE_URL) ───────────
pg_bin_dir() { ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1; }
install_pg17_client() {
  warn "Ставлю свежий postgresql-client из PGDG..."
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get install -y -qq postgresql-client-17
}

wipe_db() {
  log "Очищаю базу $DB_NAME перед импортом..."
  sudo -u postgres psql -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  sudo -u postgres psql -d "$DB_NAME" -c \
    "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION $DB_USER; GRANT ALL ON SCHEMA public TO $DB_USER; GRANT ALL ON SCHEMA public TO public;"
}

if [ -n "${NEON_DATABASE_URL:-}" ]; then
  TABLE_COUNT=$(sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  if [ "$TABLE_COUNT" != "0" ]; then
    warn "База $DB_NAME не пуста ($TABLE_COUNT таблиц) — перезаливаю дамп с Neon"
  fi
  log "Снимаю свежий дамп с Neon и импортирую..."
  wipe_db
  mkdir -p "$BACKUP_DIR"
  NEON_URL_CLEAN=$(echo "$NEON_DATABASE_URL" | sed 's/[?&]channel_binding=[^&]*//')
  DUMP_FILE="$BACKUP_DIR/neon-initial.dump"
  PGBIN=$(pg_bin_dir)
  if ! "$PGBIN/pg_dump" --no-owner --no-privileges --format=custom --file="$DUMP_FILE" "$NEON_URL_CLEAN" 2>/tmp/pgdump.err; then
    if grep -qi "server version mismatch\|aborting because of server version" /tmp/pgdump.err; then
      install_pg17_client
      PGBIN=$(pg_bin_dir)
      "$PGBIN/pg_dump" --no-owner --no-privileges --format=custom --file="$DUMP_FILE" "$NEON_URL_CLEAN"
    else
      cat /tmp/pgdump.err >&2
      err "pg_dump с Neon не удался"
      exit 1
    fi
  fi
  # pg_restore той же (или более новой) версии, что делал дамп.
  # Некритичные ошибки (SET transaction_timeout из PG17, COMMENT ON SCHEMA)
  # игнорируем — важен фактический результат (таблицы с данными).
  run_restore() {
    set +e
    "$PGBIN/pg_restore" --no-owner --no-privileges --no-comments --dbname="$LOCAL_DB_URL" "$DUMP_FILE" 2>/tmp/pgrestore.err
    RESTORE_RC=$?
    set -e
  }
  run_restore
  if [ "$RESTORE_RC" -ne 0 ] && grep -qi "unsupported version" /tmp/pgrestore.err; then
    install_pg17_client
    PGBIN=$(pg_bin_dir)
    run_restore
  fi
  IMPORTED_TABLES=$(sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  if [ "$IMPORTED_TABLES" -gt 0 ]; then
    if [ "$RESTORE_RC" -ne 0 ]; then
      warn "pg_restore сообщил о некритичных ошибках (полный лог: /tmp/pgrestore.err):"
      grep -i "error" /tmp/pgrestore.err | head -n 5 >&2 || true
    fi
    log "Дамп импортирован: $IMPORTED_TABLES таблиц (файл: $DUMP_FILE)"
  else
    cat /tmp/pgrestore.err >&2
    err "Импорт не удался — таблицы не созданы"
    exit 1
  fi
else
  TABLE_COUNT=$(sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  [ "$TABLE_COUNT" = "0" ] && warn "NEON_DATABASE_URL не задан — база будет пустой (схема применится через prisma db push)"
fi

# ── 5. .env.local + сборка ──────────────────────────────────────────────────
ENV_FILE="$APP_DIR/.env.local"
ensure_env() {
  local key="$1" val="$2"
  if [ ! -f "$ENV_FILE" ]; then return; fi
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then return; fi
  echo "${key}=${val}" >> "$ENV_FILE"
}

if [ ! -f "$ENV_FILE" ]; then
  log "Создаю $ENV_FILE..."
  NEXTAUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
  cat > "$ENV_FILE" <<EOF
# Продакшн-сервер (создано server-setup.sh $(date -Iseconds))
DATABASE_URL=$LOCAL_DB_URL
NEXTAUTH_URL=https://$DOMAIN
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
AUTH_SECRET=$NEXTAUTH_SECRET
AUTH_URL=https://$DOMAIN
AUTH_TRUST_HOST=true
EOF
  chmod 600 "$ENV_FILE"
else
  log "$ENV_FILE уже существует — дополняю недостающие переменные"
  # AUTH_* — для NextAuth v5; AUTH_TRUST_HOST обязателен за reverse-proxy (Traefik)
  SECRET=$(grep -m1 '^NEXTAUTH_SECRET=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
  [ -z "$SECRET" ] && SECRET=$(grep -m1 '^AUTH_SECRET=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
  [ -z "$SECRET" ] && SECRET=$(openssl rand -base64 48 | tr -d '\n')
  ensure_env "NEXTAUTH_SECRET" "$SECRET"
  ensure_env "AUTH_SECRET" "$SECRET"
  ensure_env "NEXTAUTH_URL" "https://$DOMAIN"
  ensure_env "AUTH_URL" "https://$DOMAIN"
  ensure_env "AUTH_TRUST_HOST" "true"
  for key in NEXTAUTH_URL AUTH_URL; do
    if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^${key}=.*|${key}=https://$DOMAIN|" "$ENV_FILE"
    fi
  done
fi

ensure_env "SNAPSHOT_STORAGE_MODE" "${SNAPSHOT_STORAGE_MODE:-local}"
ensure_env "SNAPSHOT_LOCAL_DIR" "${SNAPSHOT_LOCAL_DIR:-/opt/kpd/snapshots}"
for key in SNAPSHOT_S3_BUCKET SNAPSHOT_S3_REGION SNAPSHOT_S3_ENDPOINT SNAPSHOT_S3_FORCE_PATH_STYLE SNAPSHOT_ALERT_WEBHOOK_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  value="${!key:-}"
  [ -n "$value" ] && ensure_env "$key" "$value"
done
if [ "${SNAPSHOT_STORAGE_MODE:-local}" = "local" ]; then
  warn "Snapshot storage: локальный каталог $SNAPSHOT_LOCAL_DIR"
elif [ "${SNAPSHOT_STORAGE_MODE:-local}" = "s3" ]; then
  warn "Snapshot storage: S3."
else
  warn "Snapshot storage: db (Postgres snapshot_objects)."
fi

log "npm ci..."
cd "$APP_DIR"
npm ci --no-audit --no-fund

log "Применяю схему Prisma (db push)..."
npm run db:migrate

log "next build..."
npm run build

# ── 6. systemd ──────────────────────────────────────────────────────────────
log "Настраиваю systemd-юнит $SERVICE_NAME..."
cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=KPD frontend (Next.js)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
EnvironmentFile=-$ENV_FILE
ExecStart=$(command -v npx) next start -p $APP_PORT -H 127.0.0.1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
log "Сервис $SERVICE_NAME запущен (127.0.0.1:$APP_PORT)"

log "Настраиваю ежедневный snapshot worker..."
if ! id "$SNAPSHOT_USER" >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin "$SNAPSHOT_USER"
fi
install -d -o "$SNAPSHOT_USER" -g "$SNAPSHOT_USER" -m 0750 /opt/kpd/snapshots
chgrp "$SNAPSHOT_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"
install -m 0644 "$APP_DIR/deploy/systemd/$SNAPSHOT_SERVICE" "/etc/systemd/system/$SNAPSHOT_SERVICE"
install -m 0644 "$APP_DIR/deploy/systemd/$SNAPSHOT_TIMER" "/etc/systemd/system/$SNAPSHOT_TIMER"
systemctl daemon-reload
runuser -u "$SNAPSHOT_USER" -- /bin/bash -c \
  'set -a; source "$1"; set +a; exec /usr/bin/node "$2/scripts/snapshot-worker.mjs" --check' \
  snapshot-check "$ENV_FILE" "$APP_DIR"
systemctl enable --now "$SNAPSHOT_TIMER"
systemctl is-enabled --quiet "$SNAPSHOT_TIMER"
systemctl is-active --quiet "$SNAPSHOT_TIMER"
systemctl list-timers --all "$SNAPSHOT_TIMER" --no-legend | grep -q "$SNAPSHOT_TIMER"
log "Snapshot timer включён: 00:01 Europe/Moscow, Persistent=true"

# ── 7. Traefik ──────────────────────────────────────────────────────────────
# Включает file-provider у traefik в docker-compose (n8n): +2 аргумента, +1 volume.
# Compose-файл бэкапится, пересоздаётся только контейнер traefik.
patch_docker_traefik() {
  local CONTAINER="$1"
  local COMPOSE_FILE SERVICE PROJECT_DIR HOST_DYN="/opt/kpd/traefik-dynamic"

  COMPOSE_FILE=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' 2>/dev/null | cut -d, -f1)
  SERVICE=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.service"}}' 2>/dev/null)
  PROJECT_DIR=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null)

  if [ -z "$COMPOSE_FILE" ] || [ ! -f "$COMPOSE_FILE" ] || [ -z "$SERVICE" ]; then
    err "Не нашёл compose-файл traefik (labels compose отсутствуют)."
    return 1
  fi

  # Traefik со статическим конфиг-файлом (не CLI-args) — патчить надо иначе, не рискуем
  if ! docker inspect "$CONTAINER" --format '{{join .Args " "}}' | grep -q 'certificatesresolvers\|entrypoints'; then
    err "Traefik настроен статическим файлом, а не CLI-аргументами — включи file-provider вручную."
    return 1
  fi

  log "Патчу $COMPOSE_FILE: file-provider для traefik (бэкап рядом)..."
  cp "$COMPOSE_FILE" "$COMPOSE_FILE.bak.$(date +%s)"
  mkdir -p "$HOST_DYN"

  command -v python3 >/dev/null || apt-get install -y -qq python3
  python3 -c "import yaml" 2>/dev/null || apt-get install -y -qq python3-yaml

  python3 - "$COMPOSE_FILE" "$SERVICE" "$HOST_DYN" <<'PYEOF'
import sys, yaml

path, service, host_dyn = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    data = yaml.safe_load(f)

svc = data["services"][service]
args = ["--providers.file.directory=/etc/traefik/dynamic", "--providers.file.watch=true"]
cmd = svc.get("command", [])
if isinstance(cmd, str):
    if "providers.file.directory" not in cmd:
        svc["command"] = cmd + " " + " ".join(args)
else:
    if not any("providers.file.directory" in str(c) for c in cmd):
        svc["command"] = list(cmd) + args

vols = svc.get("volumes", [])
mount = f"{host_dyn}:/etc/traefik/dynamic:ro"
if not any("/etc/traefik/dynamic" in str(v) for v in vols):
    vols.append(mount)
    svc["volumes"] = vols

with open(path, "w") as f:
    yaml.safe_dump(data, f, default_flow_style=False, sort_keys=False, allow_unicode=True)
print("compose patched")
PYEOF

  local DC="docker compose"
  command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1 && DC="docker-compose"
  if ! (cd "$PROJECT_DIR" && $DC up -d "$SERVICE"); then
    err "docker compose up не удался — откатываю compose-файл из бэкапа"
    cp "$(ls -t "$COMPOSE_FILE".bak.* | head -1)" "$COMPOSE_FILE"
    (cd "$PROJECT_DIR" && $DC up -d "$SERVICE") || true
    return 1
  fi
  log "Traefik пересоздан с file-provider (dynamic-каталог: $HOST_DYN)"
  DYNAMIC_DIR="$HOST_DYN"
}

setup_traefik() {
  local DYNAMIC_DIR="" CERT_RESOLVER="" TARGET_IP="127.0.0.1" TRAEFIK_CONTAINER=""

  if command -v docker >/dev/null 2>&1; then
    TRAEFIK_CONTAINER=$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk 'tolower($2) ~ /traefik/ {print $1; exit}')
  fi

  if [ -n "$TRAEFIK_CONTAINER" ]; then
    log "Traefik найден в Docker: $TRAEFIK_CONTAINER"
    TARGET_IP=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || echo "172.17.0.1")

    # certresolver: ищем в лейблах контейнеров (n8n) или в аргументах traefik
    CERT_RESOLVER=$(docker ps -q | xargs -r docker inspect --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}' 2>/dev/null \
      | grep -oP 'tls\.certresolver=\K\S+' | head -n1 || true)
    if [ -z "$CERT_RESOLVER" ]; then
      CERT_RESOLVER=$(docker inspect "$TRAEFIK_CONTAINER" --format '{{join .Args " "}}' 2>/dev/null \
        | grep -oP 'certificatesresolvers\.\K[^.]+' | head -n1 || true)
    fi

    # Каталог dynamic-конфигов: смонтированный providers.file.directory
    local FILE_DIR_IN_CONTAINER
    FILE_DIR_IN_CONTAINER=$(docker inspect "$TRAEFIK_CONTAINER" --format '{{join .Args " "}}' 2>/dev/null \
      | grep -oP 'providers\.file\.directory=\K\S+' | head -n1 || true)
    if [ -n "$FILE_DIR_IN_CONTAINER" ]; then
      DYNAMIC_DIR=$(docker inspect "$TRAEFIK_CONTAINER" --format \
        "{{range .Mounts}}{{if eq .Destination \"$FILE_DIR_IN_CONTAINER\"}}{{.Source}}{{end}}{{end}}" 2>/dev/null || true)
    fi

    if [ -z "$DYNAMIC_DIR" ]; then
      warn "File-provider у traefik не включён — включаю автоматически (патч compose + пересоздание traefik)..."
      patch_docker_traefik "$TRAEFIK_CONTAINER" || {
        err "Автопатч не удался. Включи file-provider вручную и перезапусти скрипт (повторный запуск безопасен)."
        return 1
      }
    fi
  elif [ -d /etc/traefik ]; then
    log "Traefik найден нативный (/etc/traefik)"
    DYNAMIC_DIR="/etc/traefik/dynamic"
    local STATIC=""
    for f in /etc/traefik/traefik.yml /etc/traefik/traefik.yaml; do
      [ -f "$f" ] && STATIC="$f" && break
    done
    if [ -n "$STATIC" ]; then
      CERT_RESOLVER=$(grep -A5 'certificatesResolvers' "$STATIC" 2>/dev/null | grep -oP '^\s{2}\K\w+' | head -n1 || true)
      if ! grep -qE '^\s*file:' "$STATIC"; then
        cp "$STATIC" "$STATIC.bak.$(date +%s)"
        mkdir -p "$DYNAMIC_DIR"
        printf '\nproviders:\n  file:\n    directory: %s\n    watch: true\n' "$DYNAMIC_DIR" >> "$STATIC"
        warn "Включил file-provider в $STATIC (бэкап рядом). Перезапускаю traefik..."
        systemctl restart traefik || true
      fi
    fi
  else
    err "Traefik не найден (ни в Docker, ни в /etc/traefik). Настрой роутинг $DOMAIN → 127.0.0.1:$APP_PORT вручную."
    return 1
  fi

  [ -z "$CERT_RESOLVER" ] && { warn "certresolver не определён — использую 'letsencrypt' (проверь при необходимости)"; CERT_RESOLVER="letsencrypt"; }

  mkdir -p "$DYNAMIC_DIR"
  local CONF="$DYNAMIC_DIR/kpd-app.yml"
  log "Пишу dynamic-конфиг Traefik: $CONF (certresolver=$CERT_RESOLVER, backend=$TARGET_IP:$APP_PORT, SSL + redirect)"
  cat > "$CONF" <<EOF
# kpd.kpd.moscow → KPD frontend (server-setup.sh; конфиги n8n не затронуты)
http:
  routers:
    kpd-app:
      rule: "Host(\`$DOMAIN\`)"
      entryPoints:
        - websecure
      service: kpd-app
      tls:
        certResolver: $CERT_RESOLVER
    kpd-app-http:
      rule: "Host(\`$DOMAIN\`)"
      entryPoints:
        - web
      middlewares:
        - kpd-app-redirect
      service: kpd-app
  middlewares:
    kpd-app-redirect:
      redirectScheme:
        scheme: https
        permanent: true
  services:
    kpd-app:
      loadBalancer:
        servers:
          - url: "http://$TARGET_IP:$APP_PORT"
EOF

  # Приложение слушает 127.0.0.1 — для docker-traefik нужно слушать gateway-IP
  if [ -n "$TRAEFIK_CONTAINER" ] && [ "$TARGET_IP" != "127.0.0.1" ]; then
    sed -i "s/-H 127.0.0.1/-H 0.0.0.0/" "/etc/systemd/system/$SERVICE_NAME.service"
    systemctl daemon-reload
    systemctl restart "$SERVICE_NAME"
    if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
      ufw deny "$APP_PORT/tcp" >/dev/null 2>&1 || true
      log "ufw: порт $APP_PORT закрыт снаружи (изнутри docker-сети доступен)"
    else
      warn "Приложение слушает 0.0.0.0:$APP_PORT — закрой порт извне файрволом (например: ufw deny $APP_PORT/tcp)"
    fi
  fi
}
setup_traefik || warn "Traefik-шаг не завершён — см. сообщения выше. Остальной setup продолжен."

# ── 8. Бэкапы ───────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
cat > /etc/cron.d/kpd-backup <<EOF
30 3 * * * root pg_dump --format=custom --file=$BACKUP_DIR/kpd-\$(date +\%Y\%m\%d).dump "$LOCAL_DB_URL" && find $BACKUP_DIR -name 'kpd-*.dump' -mtime +14 -delete
EOF
chmod 644 /etc/cron.d/kpd-backup
log "Ежедневный бэкап настроен: $BACKUP_DIR (03:30, хранение 14 дней)"

# ── 9. SSH-ключ для CI ──────────────────────────────────────────────────────
# CI вызывает деплой прямо из репо: bash /opt/kpd/app/deploy/server-deploy.sh
if [ ! -f "$DEPLOY_KEY" ]; then
  log "Генерирую SSH-ключ для CI..."
  mkdir -p /root/.ssh
  ssh-keygen -t ed25519 -N "" -C "kpd-ci-deploy" -f "$DEPLOY_KEY" -q
fi
touch /root/.ssh/authorized_keys
grep -qF "$(cat "$DEPLOY_KEY.pub")" /root/.ssh/authorized_keys || cat "$DEPLOY_KEY.pub" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

# ── Итог ────────────────────────────────────────────────────────────────────
echo
log "════════════════════════════════════════════════════════════"
log "Setup завершён. Приложение: https://$DOMAIN"
log "Статус сервиса:  systemctl status $SERVICE_NAME"
log "Логи:            journalctl -u $SERVICE_NAME -f"
echo
log "GitHub Secrets (repo → Settings → Secrets and variables → Actions):"
log "  SSH_HOST = $SERVER_IP"
log "  SSH_USER = root"
log "  SSH_KEY  = приватный ключ ниже (целиком, включая BEGIN/END):"
echo "────────────────────────────────────────────────────────────"
cat "$DEPLOY_KEY"
echo "────────────────────────────────────────────────────────────"
