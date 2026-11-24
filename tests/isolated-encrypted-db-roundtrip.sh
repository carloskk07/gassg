#!/usr/bin/env bash
# CI only: actual PostgreSQL synthetic fixture -> encrypted package -> independent
# decryption keyring -> NEW disposable local PostgreSQL database. Never production.
set -Eeuo pipefail
umask 077
[[ "${CI:-}" == true && "${TAMAO_DISPOSABLE_ENCRYPTED_ROUNDTRIP:-}" == 1 ]] || exit 3
[[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -z "${SUPABASE_DB_PASSWORD:-}" ]] || exit 3
mapfile -t containers < <(docker ps --filter 'name=^/supabase_db_' --format '{{.ID}}')
[[ "${#containers[@]}" == 1 ]] || exit 3
container="${containers[0]}"
[[ "$container" =~ ^[0-9a-f]{12,64}$ ]] || exit 3
work="$(mktemp -d)"
remote=""
cleanup(){
  if [[ "$remote" =~ ^/tmp/tamao-encrypted-restore-[A-Za-z0-9]+$ ]]; then
    docker exec "$container" rm -rf -- "$remote" || true
  fi
  for ring in "$work/encrypt-keyring" "$work/recovery-keyring"; do
    GNUPGHOME="$ring" gpgconf --kill all >/dev/null 2>&1 || true
  done
  rm -rf -- "$work"
}
trap cleanup EXIT
mkdir -m 700 "$work/encrypt-keyring" "$work/recovery-keyring" "$work/source"
db(){
  docker exec -e PGHOST=127.0.0.1 -e PGHOSTADDR=127.0.0.1 -e PGPORT=5432 \
    -e PGUSER=postgres -e PGPASSWORD=postgres -e PGSSLMODE=prefer -e PGCONNECT_TIMEOUT=10 \
    "$container" env -u PGSERVICE -u PGSERVICEFILE "$@"
}
source_db=tamao_restore_fixture_source
target_db=tamao_restore_encrypted_fixture
query(){ db psql -XAtq -v ON_ERROR_STOP=1 -d "$1" -c "$2"; }
[[ "$(query "$source_db" 'select count(*),sum(amount_cents) from public.recovery_ledger')" == '3|1375' ]]
db pg_dump --format=custom --no-owner "$source_db" > "$work/source/fixture.dump"
sha256sum "$work/source/fixture.dump" > "$work/source/fixture.dump.sha256"
# The decryption key stays in a separate ephemeral keyring. Export only the
# public key to the encryption keyring, as an independent operator would do.
export GNUPGHOME="$work/recovery-keyring"
gpg --no-options --batch --pinentry-mode loopback --passphrase '' --quick-generate-key 'TAMAO disposable recovery fixture <fixture@example.org>' ed25519 cert 1d
primary="$(gpg --no-options --batch --with-colons --list-keys | awk -F: '$1=="fpr"{print $10;exit}')"
gpg --no-options --batch --pinentry-mode loopback --passphrase '' --quick-add-key "$primary" cv25519 encr 1d
export TAMAO_BACKUP_RECIPIENT_FPR="$(gpg --no-options --batch --with-colons --list-keys "$primary" | awk -F: '$1=="sub"{subkey=1;next} subkey&&$1=="fpr"{print $10;exit}')"
gpg --no-options --batch --export "$primary" > "$work/public-key.gpg"
export GNUPGHOME="$work/encrypt-keyring"
gpg --no-options --batch --import "$work/public-key.gpg"
[[ -z "$(gpg --no-options --batch --with-colons --list-secret-keys 2>/dev/null)" ]] || exit 3
bash scripts/release-db-encrypt-checkpoint.sh "$work/source/fixture.dump" "$work/fixture.tar.gpg"
# Encryption-only keyring cannot recover the package.
if python3 scripts/release-db-decrypt-checkpoint.py "$work/fixture.tar.gpg" "$work/unauthorized"; then
  echo 'ROUNDTRIP_FAILED: public key alone recovered package' >&2; exit 1
fi
[[ ! -e "$work/unauthorized" ]]
export GNUPGHOME="$work/recovery-keyring"
python3 scripts/release-db-decrypt-checkpoint.py "$work/fixture.tar.gpg" "$work/recovered"
cmp "$work/source/fixture.dump" "$work/recovered/fixture.dump"
(cd "$work/recovered"; sha256sum -c fixture.dump.sha256)
remote="$(docker exec "$container" mktemp -d /tmp/tamao-encrypted-restore-XXXXXXXX)"
[[ "$remote" =~ ^/tmp/tamao-encrypted-restore-[A-Za-z0-9]+$ ]] || exit 3
docker cp "$work/recovered/fixture.dump" "$container:$remote/fixture.dump"
docker cp "$work/recovered/fixture.dump.sha256" "$container:$remote/fixture.dump.sha256"
db bash /tmp/tamao-ci-restore-helper.sh "$remote/fixture.dump" "$target_db"
[[ "$(query "$target_db" 'select count(*),sum(amount_cents) from public.recovery_ledger')" == '3|1375' ]]
[[ "$(query "$target_db" "select relrowsecurity,has_table_privilege('anon','public.recovery_ledger','SELECT'),has_table_privilege('authenticated','public.recovery_ledger','SELECT') from pg_class where oid='public.recovery_ledger'::regclass")" == 't|f|t' ]]
[[ "$(query "$target_db" 'set role authenticated;select count(*) from public.recovery_ledger;')" == 0 ]]
[[ "$(query "$target_db" "select count(*) from pg_policy where polrelid='public.recovery_ledger'::regclass and polname='recovery_deny_fixture'")" == 1 ]]
echo 'PASS: actual synthetic PostgreSQL dump -> public-key-only encryption -> independent private-key recovery -> new isolated database; ledger and access boundaries preserved. No production data or external storage used.'
