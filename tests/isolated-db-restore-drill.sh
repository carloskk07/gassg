#!/usr/bin/env bash
# Executed only inside the disposable Supabase database container in CI.
# No real customer data, PSP calls, production connection or uploaded dump.
set -Eeuo pipefail
umask 077
[[ "${TAMAO_DISPOSABLE_RESTORE_DRILL:-}" == 1 ]] || exit 3
export PGHOST=127.0.0.1 PGHOSTADDR=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGSSLMODE=prefer PGCONNECT_TIMEOUT=10
unset PGSERVICE PGSERVICEFILE PGDATABASE || true
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
assert_sql() {
  local label="$1" db="$2" sql="$3" expected="$4" actual
  actual="$(psql -XAtq -v ON_ERROR_STOP=1 -d "$db" -c "$sql")"
  if [[ "$actual" != "$expected" ]]; then
    printf 'RESTORE_DRILL_FAILED: %s expected=%q actual=%q\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
  printf 'PASS: %s\n' "$label"
}
source_db=tamao_restore_fixture_source
target_db=tamao_restore_fixture_target
bad_db=tamao_restore_fixture_bad
# createdb refuses an existing database; never drop or overwrite any DB.
createdb --template=template0 "$source_db"
psql -X -v ON_ERROR_STOP=1 -d "$source_db" <<'SQL'
CREATE TABLE public.recovery_ledger (id integer PRIMARY KEY, amount_cents bigint NOT NULL);
INSERT INTO public.recovery_ledger VALUES (1, 500), (2, -125), (3, 1000);
ALTER TABLE public.recovery_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recovery_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.recovery_ledger TO authenticated;
CREATE POLICY recovery_deny_fixture ON public.recovery_ledger FOR SELECT TO authenticated USING (false);
SQL
assert_sql 'source ledger count and sum' "$source_db" 'select count(*),sum(amount_cents) from public.recovery_ledger' '3|1375'
assert_sql 'source RLS and browser grants' "$source_db" "select relrowsecurity, has_table_privilege('anon','public.recovery_ledger','SELECT'), has_table_privilege('authenticated','public.recovery_ledger','SELECT') from pg_class where oid='public.recovery_ledger'::regclass" 't|f|t'
assert_sql 'source authenticated cannot read protected ledger rows' "$source_db" 'set role authenticated; select count(*) from public.recovery_ledger;' 0
archive="$work/fixture.dump"
pg_dump --format=custom --no-owner --file="$archive" "$source_db"
sha256sum "$archive" > "$archive.sha256"
chmod 600 "$archive" "$archive.sha256"
cp "$archive" "$work/bad.dump"
cp "$archive.sha256" "$work/bad.dump.sha256"
printf 'corrupt' >> "$work/bad.dump"
if bash "$1" "$work/bad.dump" "$bad_db" > "$work/bad.log" 2>&1; then
  echo 'RESTORE_DRILL_FAILED: accepted corrupt archive' >&2; exit 1
fi
grep -Fq 'checksum mismatch' "$work/bad.log"
assert_sql 'corrupt archive leaves no database' postgres "select count(*) from pg_database where datname='$bad_db'" 0
bash "$1" "$archive" "$target_db"
assert_sql 'restored ledger count and sum' "$target_db" 'select count(*),sum(amount_cents) from public.recovery_ledger' '3|1375'
assert_sql 'restored RLS and browser grants' "$target_db" "select relrowsecurity, has_table_privilege('anon','public.recovery_ledger','SELECT'), has_table_privilege('authenticated','public.recovery_ledger','SELECT') from pg_class where oid='public.recovery_ledger'::regclass" 't|f|t'
assert_sql 'restored denial policy' "$target_db" "select count(*) from pg_policy where polrelid='public.recovery_ledger'::regclass and polname='recovery_deny_fixture'" 1
assert_sql 'authenticated cannot read protected ledger rows' "$target_db" 'set role authenticated; select count(*) from public.recovery_ledger;' 0
if bash "$1" "$archive" "$target_db" > "$work/repeat.log" 2>&1; then
  echo 'RESTORE_DRILL_FAILED: reused an existing database' >&2; exit 1
fi
grep -Fq 'destination database already exists' "$work/repeat.log"
assert_sql 'restored ledger count and sum' "$target_db" 'select count(*),sum(amount_cents) from public.recovery_ledger' '3|1375'
echo 'PASS: synthetic dump restored, ledger/ACL/RLS preserved, corrupt and duplicate restore rejected. No production backup or RPO/RTO proven.'
