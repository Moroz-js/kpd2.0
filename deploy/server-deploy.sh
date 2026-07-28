#!/usr/bin/env bash
# ============================================================================
# KPD — обновление приложения на сервере (вызывается CI или вручную).
# Установлен в /opt/kpd/deploy.sh скриптом server-setup.sh.
# ============================================================================
set -euo pipefail

APP_DIR="/opt/kpd/app"
BRANCH="${BRANCH:-main}"
SERVICE_NAME="kpd-frontend"
APP_ENV="$APP_DIR/.env.local"
SNAPSHOT_USER="kpd-app"
SNAPSHOT_SERVICE="kpd-snapshot.service"
SNAPSHOT_TIMER="kpd-snapshot.timer"

echo "[deploy] Обновляю код ($BRANCH)..."
cd "$APP_DIR"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "[deploy] npm ci..."
npm ci --no-audit --no-fund

echo "[deploy] Применяю схему Prisma..."
npm run db:migrate

echo "[deploy] next build..."
npm run build

echo "[deploy] Проверяю snapshot worker и timer..."
if [ ! -f "$APP_DIR/scripts/snapshot-worker.mjs" ]; then
  echo "[deploy] FAIL: отсутствует scripts/snapshot-worker.mjs" >&2
  exit 1
fi
if [ ! -f "$APP_ENV" ]; then
  echo "[deploy] FAIL: отсутствует production env $APP_ENV" >&2
  exit 1
fi
if ! id "$SNAPSHOT_USER" >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin "$SNAPSHOT_USER"
fi
install -d -o "$SNAPSHOT_USER" -g "$SNAPSHOT_USER" -m 0750 /opt/kpd/snapshots
if grep -q '^SNAPSHOT_STORAGE_MODE=local$' "$APP_ENV" &&
   ! grep -q '^SNAPSHOT_LOCAL_DIR=' "$APP_ENV"; then
  echo 'SNAPSHOT_LOCAL_DIR=/opt/kpd/snapshots' >> "$APP_ENV"
fi
chgrp "$SNAPSHOT_USER" "$APP_ENV"
chmod 0640 "$APP_ENV"

UNITS_CHANGED=0
for unit in "$SNAPSHOT_SERVICE" "$SNAPSHOT_TIMER"; do
  source_unit="$APP_DIR/deploy/systemd/$unit"
  target_unit="/etc/systemd/system/$unit"
  if [ ! -f "$source_unit" ]; then
    echo "[deploy] FAIL: отсутствует шаблон $source_unit" >&2
    exit 1
  fi
  if [ ! -f "$target_unit" ] || ! cmp -s "$source_unit" "$target_unit"; then
    install -m 0644 "$source_unit" "$target_unit"
    UNITS_CHANGED=1
  fi
done
if [ "$UNITS_CHANGED" -eq 1 ]; then
  systemctl daemon-reload
fi

runuser -u "$SNAPSHOT_USER" -- /bin/bash -c \
  'set -a; source "$1"; set +a; exec /usr/bin/node "$2/scripts/snapshot-worker.mjs" --check' \
  snapshot-check "$APP_ENV" "$APP_DIR"
systemctl enable --now "$SNAPSHOT_TIMER"
[ "$UNITS_CHANGED" -eq 1 ] && systemctl restart "$SNAPSHOT_TIMER"

if ! systemctl is-enabled --quiet "$SNAPSHOT_TIMER"; then
  echo "[deploy] FAIL: $SNAPSHOT_TIMER не включён" >&2
  exit 1
fi
if ! systemctl is-active --quiet "$SNAPSHOT_TIMER"; then
  echo "[deploy] FAIL: $SNAPSHOT_TIMER не активен" >&2
  exit 1
fi
if ! systemctl list-timers --all "$SNAPSHOT_TIMER" --no-legend | grep -q "$SNAPSHOT_TIMER"; then
  echo "[deploy] FAIL: у $SNAPSHOT_TIMER нет следующего запуска" >&2
  exit 1
fi
if ! grep -qF "OnCalendar=*-*-* 00:01:00 Europe/Moscow" "/etc/systemd/system/$SNAPSHOT_TIMER" ||
   ! grep -qF "Persistent=true" "/etc/systemd/system/$SNAPSHOT_TIMER"; then
  echo "[deploy] FAIL: расписание snapshot timer не соответствует 00:01 Europe/Moscow/Persistent" >&2
  exit 1
fi

echo "[deploy] Перезапускаю $SERVICE_NAME..."
systemctl restart "$SERVICE_NAME"

sleep 3
if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "[deploy] OK: $SERVICE_NAME запущен ($(git rev-parse --short HEAD))"
else
  echo "[deploy] FAIL: сервис не поднялся, смотри: journalctl -u $SERVICE_NAME -n 50" >&2
  exit 1
fi
