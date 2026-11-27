#!/usr/bin/env bash
# One-command install of the Rural Value Engine on a fresh Ubuntu 24.04 (or Debian 12) VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/chiotis/ruralvalueengine/main/deploy/install.sh -o install.sh
#   sudo DOMAIN=engine.ruralgreece.gr EMAIL=admin@example.gr bash install.sh
#
# Before running: point DOMAIN's DNS (A record) at this server, so HTTPS can be issued.
# Running it again updates the code and keeps the existing settings and secrets.
#
# Optional variables:
#   REPO       git URL to install from (default: the GitHub repo)
#   BRANCH     branch to install (default: main)
#   SMTP_URL   e.g. smtps://user%40domain:password@mail.host:465 (login codes go to the log until set)
#   MAIL_FROM  e.g. "Rural Greece <no-reply@ruralgreece.gr>"
#   NO_TLS=1   skip certbot (e.g. DNS not ready yet; run `certbot --nginx -d $DOMAIN` later)
set -euo pipefail

DOMAIN=${DOMAIN:?Set DOMAIN, e.g. DOMAIN=engine.ruralgreece.gr}
EMAIL=${EMAIL:?Set EMAIL for Let\'s Encrypt notices}
REPO=${REPO:-https://github.com/chiotis/ruralvalueengine.git}
BRANCH=${BRANCH:-main}
APP_DIR=/opt/rve
ENV_FILE=/etc/rve/engine.env
PORT=8080

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
secret() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)."; exit 1; }
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "DOMAIN looks wrong: $DOMAIN"; exit 1; }
. /etc/os-release
case "$ID" in ubuntu | debian) ;; *) echo "Tested on Ubuntu and Debian only (found $ID)."; exit 1 ;; esac

log "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq sudo ca-certificates curl git openssl postgresql nginx certbot python3-certbot-nginx ufw unattended-upgrades

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  log "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi

log "Firewall (SSH, HTTP, HTTPS only)"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

log "Service user and code"
id rve >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin rve
if [ -d "$APP_DIR/.git" ]; then
  sudo -u rve git -C "$APP_DIR" fetch -q origin "$BRANCH"
  sudo -u rve git -C "$APP_DIR" checkout -q "$BRANCH"
  sudo -u rve git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  mkdir -p "$APP_DIR" && chown rve:rve "$APP_DIR"
  sudo -u rve git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

log "PostgreSQL"
systemctl enable --now postgresql
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'rve'" | grep -q 1; then
  DB_PASSWORD=$(secret)
  sudo -u postgres psql -q -c "CREATE USER rve PASSWORD '$DB_PASSWORD'"
  sudo -u postgres createdb -O rve rve
fi

log "Settings ($ENV_FILE)"
mkdir -p /etc/rve
if [ ! -f "$ENV_FILE" ]; then
  : "${DB_PASSWORD:?The database user exists but $ENV_FILE is missing; restore it or drop the rve role and database}"
  ADMIN_TOKEN=$(secret)
  WP_WEBHOOK_SECRET=$(secret)
  umask 077
  cat >"$ENV_FILE" <<EOF
DATABASE_URL=postgres://rve:${DB_PASSWORD}@localhost:5432/rve
PORT=${PORT}
JWT_SECRET=$(secret)
QR_KEYS={"1":"$(secret)"}
ADMIN_TOKEN=${ADMIN_TOKEN}
NETWORK_TZ=Europe/Athens
RURALGREECE_URL=https://ruralgreece.gr
WP_WEBHOOK_SECRET=${WP_WEBHOOK_SECRET}
SMTP_URL=${SMTP_URL:-}
MAIL_FROM=${MAIL_FROM:-Rural Greece <no-reply@ruralgreece.gr>}
TRUST_PROXY=1
EOF
  umask 022
  FIRST_INSTALL=1
fi
chown root:rve "$ENV_FILE" && chmod 640 "$ENV_FILE"

log "Build"
cd "$APP_DIR/engine"
sudo -u rve npm ci --no-audit --no-fund
sudo -u rve npm run build

log "Service"
cp "$APP_DIR/deploy/rve-engine.service" /etc/systemd/system/rve-engine.service
systemctl daemon-reload
systemctl enable rve-engine >/dev/null
systemctl restart rve-engine
for _ in $(seq 1 30); do curl -fs "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 1; done
curl -fs "http://127.0.0.1:$PORT/health" >/dev/null || { journalctl -u rve-engine -n 50 --no-pager; echo "The engine did not start."; exit 1; }

log "nginx"
sed "s/engine\.ruralgreece\.gr/$DOMAIN/g" "$APP_DIR/deploy/nginx-rve.conf" >/etc/nginx/sites-available/rve
ln -sf /etc/nginx/sites-available/rve /etc/nginx/sites-enabled/rve
rm -f /etc/nginx/sites-enabled/default
nginx -t -q
systemctl reload nginx

if [ "${NO_TLS:-0}" != "1" ]; then
  log "HTTPS certificate"
  certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$DOMAIN"
fi

log "Nightly database backup"
install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/rve-backup
mkdir -p /var/backups/rve && chown postgres /var/backups/rve
echo '30 3 * * * postgres /usr/local/bin/rve-backup' >/etc/cron.d/rve-backup

log "Done"
echo "Engine:       https://$DOMAIN/health"
echo "Admin panel:  https://$DOMAIN/admin"
echo "Logs:         journalctl -u rve-engine -f"
if [ "${FIRST_INSTALL:-0}" = "1" ]; then
  echo
  echo "Keep these somewhere safe (they are also in $ENV_FILE):"
  echo "  ADMIN_TOKEN (admin panel):            $ADMIN_TOKEN"
  echo "  WP_WEBHOOK_SECRET (rve-sync plugin):  $WP_WEBHOOK_SECRET"
fi
[ -n "${SMTP_URL:-}" ] || grep -q '^SMTP_URL=.\+' "$ENV_FILE" || echo "Note: SMTP_URL is empty, so login codes are written to the log. Set it in $ENV_FILE and run: systemctl restart rve-engine"
