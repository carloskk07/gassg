#!/usr/bin/env bash
# Restore drill in GitHub CI against a disposable, synthetic TLS PostgreSQL.
# It MUST NOT connect to the Supabase project or touch live customer data.
set -Eeuo pipefail
umask 077
[[ "${GITHUB_ACTIONS:-}" == "true" ]] || { echo "SYNTHETIC_ONLY: require CI isolation" >&2; exit 8; }
[[ "${PGHOST:-}" == "127.0.0.1" ]] || { echo "SYNTHETIC_ONLY: localhost required" >&2; exit 8; }
[[ "${PGDATABASE:-}" == "tamao_rc_fixture" ]] || { echo "SYNTHETIC_ONLY: wrong fixture database" >&2; exit 8; }
[[ "${PGSSLMODE:-}" == "require" ]] || { echo "TLS_REQUIRED" >&2; exit 8; }
for executable in pg_dump pg_restore psql createdb; do
 command -v "$executable" >/dev/null || { echo "Missing $executable" >&2; exit 8; }
done
ssl="$(psql -Atq -v ON_ERROR_STOP=1 -c 'select ssl from pg_stat_ssl where pid=pg_backend_pid()')"
[[ "$ssl" == "t" ]] || { echo "TLS_NOT_ACTIVE" >&2; exit 8; }

psql -v ON_ERROR_STOP=1 <<'SQL'
create table public.tamao_backup_smoke (
  seq integer primary key,
  label text not null,
  created_at timestamptz not null default now()
);
insert into public.tamao_backup_smoke(seq,label)
values (1,'fictional-water-delivery'),(2,'fictional-gas-request');
create role tamao_backup_fixture_reader;
grant select on public.tamao_backup_smoke to tamao_backup_fixture_reader;
SQL

source_archive_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/tamao-restore-drill.XXXXXX")"
trap 'rm -rf "$source_archive_root"' EXIT
export TAMAO_BACKUP_DIR="$source_archive_root/private"
bash scripts/release-db-backup-checkpoint.sh --preflight
bash scripts/release-db-backup-checkpoint.sh
archive_count="$(find "$TAMAO_BACKUP_DIR" -maxdepth 1 -name '*.dump' -type f | wc -l)"
[[ "$archive_count" == "1" ]] || { echo "ARCHIVE_COUNT_INVALID" >&2; exit 8; }
archive="$(find "$TAMAO_BACKUP_DIR" -maxdepth 1 -name '*.dump' -type f -print -quit)"
[[ -s "$archive" ]] || { echo "EMPTY_ARCHIVE" >&2; exit 8; }
[[ "$(stat -c %a "$archive")" == "600" ]] || { echo "PRIVATE_MODE_REQUIRED" >&2; exit 8; }
sha256sum -c "$archive.sha256" >/dev/null
# Negative proof: a modified archive must fail its recorded SHA-256 verification.
# Work exclusively on a synthetic, private copy; never alter the original checkpoint.
tampered="$source_archive_root/tampered.dump"
cp -- "$archive" "$tampered"
printf 'tampering-for-negative-test' >> "$tampered"
expected_hash="$(cut -d ' ' -f 1 "$archive.sha256")"
if printf '%s  %s\n' "$expected_hash" "$tampered" | sha256sum -c - >/dev/null 2>&1; then
  echo "TAMPERED_ARCHIVE_ACCEPTED" >&2
  exit 8
fi
echo "TAMPERED_ARCHIVE_REJECTED"

pg_restore --list "$archive" | grep -q 'tamao_backup_smoke'
createdb -T template0 tamao_rc_restored
PGDATABASE=tamao_rc_restored pg_restore --exit-on-error --no-owner --dbname=tamao_rc_restored "$archive"
count="$(PGDATABASE=tamao_rc_restored psql -Atq -v ON_ERROR_STOP=1 -c 'select count(*) from public.tamao_backup_smoke')"
[[ "$count" == "2" ]] || { echo "RESTORE_ROW_COUNT_MISMATCH" >&2; exit 8; }
# Row count is insufficient to prove integrity: verify the expected fixture contents.
rows="$(PGDATABASE=tamao_rc_restored psql -Atq -v ON_ERROR_STOP=1 -c "select string_agg(seq::text || ':' || label, ',' order by seq) from public.tamao_backup_smoke")"
[[ "$rows" == "1:fictional-water-delivery,2:fictional-gas-request" ]] || { echo "RESTORE_CONTENT_MISMATCH" >&2; exit 8; }
# The restored reader must not gain write privileges.
can_insert="$(PGDATABASE=tamao_rc_restored psql -Atq -v ON_ERROR_STOP=1 -c "select has_table_privilege('tamao_backup_fixture_reader','public.tamao_backup_smoke','INSERT')")"
[[ "$can_insert" == "f" ]] || { echo "RESTORE_EXCESSIVE_PRIVILEGE" >&2; exit 8; }
reader="$(PGDATABASE=tamao_rc_restored psql -Atq -v ON_ERROR_STOP=1 -c "select has_table_privilege('tamao_backup_fixture_reader','public.tamao_backup_smoke','SELECT')")"
[[ "$reader" == "t" ]] || { echo "RESTORE_ACL_MISSING" >&2; exit 8; }
echo "SYNTHETIC_TLS_BACKUP_RESTORED: two exact rows, SELECT grant and INSERT denial verified; no production data accessed"
