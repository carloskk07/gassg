#!/usr/bin/env bash
# TAMÃO — restore a private custom-format dump only to a NEW local database.
# Never point this helper at Supabase production, a forwarded production port,
# or any database containing real existing data.
set -Eeuo pipefail
umask 077

if [[ "${1:-}" == "--help" || "$#" -ne 2 ]]; then
  echo "Usage: PGHOST=127.0.0.1 PGUSER=<local_user> PGPORT=<local_port> bash scripts/release-db-restore-isolated.sh <archive.dump> <tamao_restore_unique_name>"
  echo "The destination is CREATED from template0 on local PostgreSQL; no existing database is touched."
  if [[ "${1:-}" == "--help" ]]; then exit 0; else exit 2; fi
fi
archive="$1"
target="$2"
[[ "$target" =~ ^tamao_restore_[a-z0-9_]{5,48}$ ]] || { echo "RESTORE_BLOCKED: target name must begin tamao_restore_" >&2; exit 3; }
[[ "${PGHOST:-}" == "127.0.0.1" ]] || { echo "RESTORE_BLOCKED: only explicit PGHOST=127.0.0.1 is allowed" >&2; exit 3; }
[[ "${PGHOSTADDR:-127.0.0.1}" == "127.0.0.1" ]] || { echo "RESTORE_BLOCKED: PGHOSTADDR must remain local" >&2; exit 3; }
[[ "${PGPORT:-5432}" =~ ^[0-9]{1,5}$ ]] || { echo "RESTORE_BLOCKED: invalid local port" >&2; exit 3; }
[[ -n "${PGUSER:-}" ]] || { echo "RESTORE_BLOCKED: provide local PGUSER" >&2; exit 3; }
[[ -f "$archive" && -s "$archive" && ! -L "$archive" ]] || { echo "RESTORE_BLOCKED: missing or symlink archive" >&2; exit 3; }
[[ -f "$archive.sha256" && ! -L "$archive.sha256" ]] || { echo "RESTORE_BLOCKED: missing or symlink checksum" >&2; exit 3; }
for binary in sha256sum pg_restore psql createdb; do
  command -v "$binary" >/dev/null || { echo "RESTORE_BLOCKED: missing $binary" >&2; exit 3; }
done

# Extract only the digest, not a filename supplied in an untrusted sidecar.
expected="$(head -n 1 "$archive.sha256" | awk '{print $1}')"
[[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || { echo "RESTORE_BLOCKED: invalid checksum format" >&2; exit 3; }
actual="$(sha256sum "$archive" | awk '{print $1}')"
[[ "${expected,,}" == "$actual" ]] || { echo "RESTORE_BLOCKED: checksum mismatch" >&2; exit 3; }
pg_restore --list "$archive" >/dev/null || { echo "RESTORE_BLOCKED: unreadable archive catalog" >&2; exit 3; }

# We only CONNECT to localhost. A port-forward to production is NOT an
# isolated destination; the operator must verify their local PostgreSQL.
export PGHOST=127.0.0.1 PGHOSTADDR=127.0.0.1 PGSSLMODE=prefer PGCONNECT_TIMEOUT=10
unset PGSERVICE || true
# Fail if there is an existing database of the same name; never reuse or drop.
if psql -XAtq -d postgres -v ON_ERROR_STOP=1 -v target="$target" \
  -c "select 1 from pg_database where datname=:'target'" 2>/dev/null | grep -qx 1; then
  echo "RESTORE_BLOCKED: destination database already exists" >&2
  exit 3
fi
createdb --template=template0 -- "$target" || { echo "RESTORE_FAILED: could not create fresh isolated target" >&2; exit 4; }
# Leave failed local database untouched for inspection; never perform DROP DATABASE.
if ! pg_restore --exit-on-error --no-owner --dbname="$target" "$archive"; then
  echo "RESTORE_FAILED: isolated target may be partial; do not consider this checkpoint verified" >&2
  exit 4
fi
tables="$(psql -XAtq -d "$target" -v ON_ERROR_STOP=1 -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema')")"
[[ "$tables" =~ ^[0-9]+$ && "$tables" -gt 0 ]] || { echo "RESTORE_FAILED: no application tables found" >&2; exit 4; }
echo "ISOLATED_RESTORE_OK: restored $tables tables to NEW local database $target"
echo "RESTORE_BOUNDARY: application-specific roles, RLS, grants, policies and Supabase extension parity require independent checks before production migration"
