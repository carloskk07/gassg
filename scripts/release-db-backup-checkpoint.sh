#!/usr/bin/env bash
# TAMÃO — local, permission-restricted PostgreSQL backup checkpoint.
# Never upload this archive to GitHub Actions, an issue, a PR, or a public URL.
set -Eeuo pipefail
umask 077

if [[ "${1:-}" == "--preflight" ]]; then
  for utility in pg_dump pg_restore sha256sum mktemp; do
    command -v "$utility" >/dev/null || { echo "MISSING_TOOL: $utility"; exit 2; }
  done
  echo "TOOLS_READY_ONLY: no database contacted, no backup created"
  exit 0
fi

: "${TAMAO_BACKUP_DIR:?Set TAMAO_BACKUP_DIR to a secure directory outside the repository}"
: "${PGHOST:?Set PGHOST using a secure Supabase connection string}"
: "${PGDATABASE:?Set PGDATABASE}"
: "${PGUSER:?Set PGUSER}"
: "${PGPASSWORD:?Set PGPASSWORD in a secure environment, never in shell history}"
for utility in pg_dump pg_restore sha256sum mktemp; do
  command -v "$utility" >/dev/null || { echo "MISSING_TOOL: $utility"; exit 2; }
done

mkdir -p "$TAMAO_BACKUP_DIR"
backups_dir="$(cd "$TAMAO_BACKUP_DIR" && pwd -P)"
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
case "$backups_dir/" in
  "$repo_dir/"*) echo "BACKUP_BLOCKED: backup directory must be outside the repository" >&2; exit 3 ;;
esac
if [[ -L "$TAMAO_BACKUP_DIR" ]]; then
  echo "BACKUP_BLOCKED: symlink backup directory is not allowed" >&2
  exit 3
fi
export PGSSLMODE=require PGCONNECT_TIMEOUT=15
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$backups_dir/tamao-prod-before-v1-164-$stamp.dump"
if [[ -e "$target" ]]; then
  echo "BACKUP_BLOCKED: refusing to overwrite an existing checkpoint" >&2
  exit 3
fi
temp="$(mktemp "$backups_dir/.tamao-pgdump-XXXXXXXX")"
chmod 600 "$temp"
cleanup(){ [[ -e "$temp" ]] && rm -f "$temp"; }
trap cleanup EXIT
# Uses libpq PG* environment instead of writing credentials to argv or logs.
pg_dump --format=custom --no-owner --no-acl --file="$temp"
pg_restore --list "$temp" >/dev/null
[[ -s "$temp" ]] || { echo "BACKUP_FAILED: empty database archive" >&2; exit 4; }
mv -n "$temp" "$target"
chmod 600 "$target"
sha256sum "$target" >"$target.sha256"
chmod 600 "$target.sha256"
trap - EXIT
echo "BACKUP_CHECKPOINT_CREATED: $target"
echo "BACKUP_CHECKSUM: $target.sha256"
echo "VERIFY_ARCHIVE_AND_RESTORE_TO_ISOLATED_DATABASE_BEFORE_PRODUCTION_MIGRATION"
