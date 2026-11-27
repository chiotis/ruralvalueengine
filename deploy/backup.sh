#!/usr/bin/env bash
# Nightly database backup for the engine. Keeps 14 days.
# Cron (as the postgres user): 30 3 * * * /opt/rve/deploy/backup.sh
set -euo pipefail
DIR=${BACKUP_DIR:-/var/backups/rve}
DB=${DB_NAME:-rve}
mkdir -p "$DIR"
pg_dump --format=custom --no-owner "$DB" > "$DIR/rve-$(date +%F).dump"
find "$DIR" -name 'rve-*.dump' -mtime +14 -delete
# Restore: pg_restore --clean --no-owner -d rve /var/backups/rve/rve-YYYY-MM-DD.dump
